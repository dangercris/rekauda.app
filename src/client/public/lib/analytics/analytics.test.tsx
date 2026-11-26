import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentBanner } from "../../components/ConsentBanner";
import { CONSENT_KEY, CONSENT_VERSION, getConsentState, openPreferences, readConsent, resetConsentForTests, setConsent } from "./consent";
import { EVENT_PARAM_KEYS, track, type AnalyticsEventName } from "./events";
import { resetGtagForTests, sendPageView } from "./gtag";

vi.mock("./config", () => ({ GA_MEASUREMENT_ID: "G-TEST1234" }));

const scripts = () => document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]');
const calls = (): unknown[][] => (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
const events = (name: string) => calls().filter((c) => c[0] === "event" && c[1] === name);

beforeEach(() => {
  localStorage.clear();
  resetConsentForTests();
  resetGtagForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  scripts().forEach((s) => s.remove());
  delete window.dataLayer;
  delete window.gtag;
  Reflect.deleteProperty(window, "ga-disable-G-TEST1234");
});

describe("consent storage", () => {
  it("returns null with no stored choice", () => {
    expect(readConsent()).toBeNull();
  });

  it("stores the choice with the policy version", () => {
    setConsent("denied");
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null")).toEqual({ choice: "denied", version: CONSENT_VERSION });
    expect(readConsent()).toBe("denied");
  });

  it("asks again when the stored version is outdated", () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: "granted", version: CONSENT_VERSION - 1 }));
    expect(readConsent()).toBeNull();
  });

  it("ignores corrupt values", () => {
    localStorage.setItem(CONSENT_KEY, "granted");
    expect(readConsent()).toBeNull();
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: "maybe", version: CONSENT_VERSION }));
    expect(readConsent()).toBeNull();
  });

  it("does not throw when storage throws, and keeps the choice in memory", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readConsent()).toBeNull();
    expect(() => setConsent("denied")).not.toThrow();
    expect(getConsentState().choice).toBe("denied");
  });
});

describe("track facade", () => {
  it("is a no-op before consent and after denial", () => {
    track("share_click", { collection: "musical" });
    expect(window.dataLayer).toBeUndefined();
    setConsent("denied");
    track("share_click", { collection: "musical" });
    expect(events("share_click")).toHaveLength(0);
    expect(scripts()).toHaveLength(0);
  });

  it("sends events once granted and stops after the visitor switches to denied", () => {
    setConsent("granted");
    track("share_click", { collection: "musical" });
    expect(events("share_click")).toHaveLength(1);
    setConsent("denied");
    track("share_click", { collection: "musical" });
    expect(events("share_click")).toHaveLength(1);
    expect(Reflect.get(window, "ga-disable-G-TEST1234")).toBe(true);
  });

  it("uses Consent Mode v2 defaults with only analytics storage granted and no automatic page_view", () => {
    setConsent("granted");
    const all = calls();
    expect(all[0]).toEqual([
      "consent",
      "default",
      { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
    ]);
    expect(all[1]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(all.find((c) => c[0] === "config")).toEqual(["config", "G-TEST1234", { send_page_view: false }]);
  });

  it("sends page_view with the hash tab path and the document title", () => {
    document.title = "Vestuario";
    setConsent("granted");
    sendPageView("/r/musical#pagar", document.title);
    expect(events("page_view")[0]?.[2]).toMatchObject({ page_path: "/r/musical#pagar", page_title: "Vestuario" });
  });

  it("only forwards allowlisted keys (no PII can leak through extra params)", () => {
    setConsent("granted");
    const leaky = { collection: "musical", students: 2, parentName: "Ana Pérez", phone: "0991234567", code: "ABC-234", amount: 1400 };
    track("payment_submitted", leaky);
    expect(Object.keys(events("payment_submitted")[0]?.[2] as object).sort()).toEqual(["collection", "students"]);
  });

  it("declares only non-personal keys for every event", () => {
    const personal = /name|phone|code$|amount|receipt|email|reference|cedula|id$/i;
    const names = Object.keys(EVENT_PARAM_KEYS) as AnalyticsEventName[];
    expect(names.sort()).toEqual(["deuna_click", "pay_step_view", "payment_failed", "payment_submitted", "share_click", "status_lookup"]);
    for (const name of names) {
      for (const key of EVENT_PARAM_KEYS[name]) expect(key === "error_code" || !personal.test(key)).toBe(true);
    }
  });
});

describe("consent banner", () => {
  it("never appears on its own, even on a first visit with no choice", () => {
    render(<ConsentBanner />);
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
    expect(scripts()).toHaveLength(0);
  });

  it("opens from preferences and offers both buttons", () => {
    render(<ConsentBanner />);
    act(() => openPreferences());
    expect(screen.getByRole("region", { name: "Preferencias de cookies" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "¿Nos ayudas a mejorar el sitio?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceptar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No, gracias" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("stays hidden when a choice is stored", () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice: "denied", version: CONSENT_VERSION }));
    resetConsentForTests();
    render(<ConsentBanner />);
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
  });

  it("loads the gtag script exactly once on accept, even after reopening and accepting again", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    act(() => openPreferences());
    expect(scripts()).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Aceptar" }));
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.getAttribute("src")).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST1234");
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
    act(() => openPreferences());
    await user.click(screen.getByRole("button", { name: "Aceptar" }));
    expect(scripts()).toHaveLength(1);
  });

  it("never loads the script on deny and closes", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    act(() => openPreferences());
    await user.click(screen.getByRole("button", { name: "No, gracias" }));
    expect(scripts()).toHaveLength(0);
    expect(readConsent()).toBe("denied");
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
  });

  it("reopens from preferences even with a stored choice", () => {
    setConsent("denied");
    render(<ConsentBanner />);
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
    act(() => openPreferences());
    expect(screen.getByRole("region", { name: "Preferencias de cookies" })).toBeInTheDocument();
  });
});

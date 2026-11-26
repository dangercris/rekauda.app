import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../../components/Analytics";
import { ConsentBanner } from "../../components/ConsentBanner";
import { GA_MEASUREMENT_ID } from "./config";
import { resetConsentForTests, setConsent } from "./consent";
import { isAnalyticsEnabled } from "./enabled";
import { track } from "./events";

// A real ID is usually configured; this suite checks the kill switch (placeholder ID turns everything off).
vi.mock("./config", () => ({ GA_MEASUREMENT_ID: "G-XXXXXXXXXX" }));

beforeEach(() => {
  localStorage.clear();
  resetConsentForTests();
});

describe("placeholder Measurement ID", () => {
  it("treats the placeholder as disabled", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-XXXXXXXXXX");
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("never shows the banner", () => {
    render(
      <>
        <Analytics />
        <ConsentBanner />
      </>,
    );
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
  });

  it("loads nothing even if consent is granted", () => {
    setConsent("granted");
    track("share_click", { collection: "musical" });
    expect(document.querySelector("script[src*='googletagmanager']")).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });
});

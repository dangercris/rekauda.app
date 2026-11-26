import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithConfig } from "../../../test/renderWithConfig";
import { tenantA, tenantB } from "../../../test/tenants";
import { Analytics } from "../../components/Analytics";
import { ConsentBanner } from "../../components/ConsentBanner";
import { resetConsentForTests, setConsent } from "./consent";
import { isAnalyticsEnabled } from "./enabled";
import { track } from "./events";

// Tenant B has no Measurement ID: null is the kill switch (placeholder or malformed ids turn everything off too).
const OFF = tenantB.analytics.gaMeasurementId;

beforeEach(() => {
  localStorage.clear();
  resetConsentForTests();
});

describe("analytics id from the tenant config", () => {
  it("is disabled for null, the placeholder and malformed ids, enabled for a real one", () => {
    expect(isAnalyticsEnabled(OFF)).toBe(false);
    expect(isAnalyticsEnabled("G-XXXXXXXXXX")).toBe(false);
    expect(isAnalyticsEnabled("UA-123")).toBe(false);
    expect(isAnalyticsEnabled(tenantA.analytics.gaMeasurementId)).toBe(true);
  });
});

describe("tenant without a Measurement ID", () => {
  it("never shows the banner", () => {
    renderWithConfig(
      <>
        <Analytics />
        <ConsentBanner />
      </>,
      tenantB,
    );
    expect(screen.queryByRole("region", { name: "Preferencias de cookies" })).toBeNull();
  });

  it("loads nothing even if consent is granted", () => {
    setConsent("granted", OFF);
    track("share_click", { collection: "musical" });
    expect(document.querySelector("script[src*='googletagmanager']")).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });
});

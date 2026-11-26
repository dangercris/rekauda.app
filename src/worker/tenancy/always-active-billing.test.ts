import { describe, expect, it } from "vitest";
import { AlwaysActive } from "./always-active-billing";
import type { BillingStatus } from "./billing-status";
import type { Tenant } from "./tenant";

const tenant = (id: string): Tenant => ({ id, slug: `slug-${id}`, r2Prefix: `t/${id}/`, source: "cloud" });

describe("AlwaysActive", () => {
  const billing: BillingStatus = new AlwaysActive();

  it.each(["a", "b"])("reports tenant %s as in good standing", async (id) => {
    expect(await billing.isActive(tenant(id))).toBe(true);
  });
});

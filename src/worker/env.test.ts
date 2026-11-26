import { describe, expectTypeOf, it } from "vitest";
import type { BaseEnv, CloudEnv, MultiEnv, SingleEnv } from "./env";

describe("Env typing by tenancy mode", () => {
  it("narrows on the TENANCY discriminant", () => {
    const pick = (env: CloudEnv): string => {
      if (env.TENANCY === "multi") {
        expectTypeOf(env).toEqualTypeOf<MultiEnv>();
        return env.ROOT_DOMAIN + env.INBOUND_DOMAIN;
      }
      expectTypeOf(env).toEqualTypeOf<SingleEnv>();
      return env.FORWARD_TO;
    };
    expectTypeOf(pick).toBeFunction();
  });

  it("requires cloud-only bindings in multi mode and makes them optional in single mode", () => {
    expectTypeOf<MultiEnv["MAIL_ARCHIVE"]>().toEqualTypeOf<R2Bucket>();
    expectTypeOf<MultiEnv["SEND_EMAIL"]>().toEqualTypeOf<SendEmail>();
    expectTypeOf<SingleEnv["MAIL_ARCHIVE"]>().toEqualTypeOf<R2Bucket | undefined>();
    expectTypeOf<SingleEnv["SEND_EMAIL"]>().toEqualTypeOf<SendEmail | undefined>();
    expectTypeOf<SingleEnv["ROOT_DOMAIN"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SingleEnv["SESSION_SECRET"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<BaseEnv["DB"]>().toEqualTypeOf<D1Database>();
  });
});

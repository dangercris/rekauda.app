import { describe, expect, it } from "vitest";
import { reviewerLabel } from "./reviewer-label";

describe("reviewerLabel", () => {
  it("labels the shared admin session as treasury", () => {
    expect(reviewerLabel("admin")).toBe("tesorería");
  });

  it("labels a real user id as treasury", () => {
    expect(reviewerLabel("0b1c2d3e-0000-4000-8000-00000000abcd")).toBe("tesorería");
  });

  it("labels the Deuna notification", () => {
    expect(reviewerLabel("deuna")).toBe("notificación de Deuna");
  });

  it("labels the script as automatic review", () => {
    expect(reviewerLabel("script")).toBe("revisión automática");
  });

  it("returns no label for null or empty values", () => {
    expect(reviewerLabel(null)).toBeNull();
    expect(reviewerLabel("")).toBeNull();
  });
});

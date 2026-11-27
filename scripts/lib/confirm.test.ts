import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module without types
import { confirmTyped } from "./confirm.mjs";

describe("confirmTyped", () => {
  const io = (readLine: () => string) => ({ isTTY: true, readLine, write: () => undefined });

  it("accepts only the exact phrase on a TTY", () => {
    expect(confirmTyped("GO", io(() => "GO"))).toBe(true);
    expect(confirmTyped("GO", io(() => "go"))).toBe(false);
    expect(confirmTyped("GO", { ...io(() => "GO"), isTTY: false })).toBe(false);
  });

  it.each(["EAGAIN", "EIO", "EBADF"])("refuses cleanly, without throwing, when reading stdin fails with %s", (code) => {
    const read = () => {
      throw Object.assign(new Error(code), { code });
    };
    expect(confirmTyped("GO", io(read))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc.mjs";

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    expect(parseJsonc('{"a":1,"b":[true,null]}')).toEqual({ a: 1, b: [true, null] });
  });

  it("strips line and block comments", () => {
    const text = `{
      // line comment
      "a": 1, /* block
      comment */ "b": 2
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: 2 });
  });

  it("allows trailing commas in objects and arrays", () => {
    expect(parseJsonc('{"a":[1,2,],"b":{"c":3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it("keeps comment-like text and escaped quotes inside strings", () => {
    const parsed = parseJsonc('{"url":"https://example.com/*x*/","q":"say \\"//hi\\"," }');
    expect(parsed).toEqual({ url: "https://example.com/*x*/", q: 'say "//hi",' });
  });

  it("throws on invalid input", () => {
    expect(() => parseJsonc('{"a": ')).toThrow();
    expect(() => parseJsonc("")).toThrow();
  });

  it("treats a block comment as whitespace, not as nothing", () => {
    expect(() => parseJsonc("[1/**/2]")).toThrow();
    expect(parseJsonc("[1/**/,2]")).toEqual([1, 2]);
  });

  it("strips a leading BOM", () => {
    expect(parseJsonc('\uFEFF{"a":1}')).toEqual({ a: 1 });
  });
});

describe("parseJsonc with rejectDuplicates", () => {
  const strict = (text: string) => parseJsonc(text, { rejectDuplicates: true });

  it("keeps last-wins by default and refuses a duplicate key in strict mode", () => {
    expect(parseJsonc('{"a":1,"a":2}')).toEqual({ a: 2 });
    expect(() => strict('{"a":1,"a":2}')).toThrow(/duplicate/i);
  });

  it("detects duplicates in nested objects, across comments and through escapes", () => {
    expect(() => strict('{"o":{"b":1,/* c */"b":2}}')).toThrow(/duplicate/i);
    expect(() => strict('{"name":1,"na\\u006de":2}')).toThrow(/duplicate/i);
    expect(() => strict('{"l":[{"k":1,"k":2}]}')).toThrow(/duplicate/i);
  });

  it("accepts the same key in different objects and keys that look like values", () => {
    expect(strict('{"a":{"x":1},"b":{"x":2},"l":[{"x":1},{"x":2}],"s":"a","t":"a"}')).toEqual({ a: { x: 1 }, b: { x: 2 }, l: [{ x: 1 }, { x: 2 }], s: "a", t: "a" });
    expect(strict('{"a":"x","b":"x"}')).toEqual({ a: "x", b: "x" });
  });
});

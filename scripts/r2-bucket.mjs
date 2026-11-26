#!/usr/bin/env node
// Prints the R2 bucket_name of the RECEIPTS binding from wrangler.jsonc (JSONC: comments and trailing commas allowed).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));

/** Removes // and /* *\/ comments and trailing commas without touching string contents. */
function stripJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) throw new Error("unterminated comment in wrangler.jsonc");
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const config = JSON.parse(stripJsonc(readFileSync(file, "utf8")));
const bucket = (config.r2_buckets ?? []).find((b) => b.binding === "RECEIPTS")?.bucket_name;
if (!bucket) {
  console.error("No r2_buckets entry with binding RECEIPTS in wrangler.jsonc");
  process.exit(1);
}
console.log(bucket);

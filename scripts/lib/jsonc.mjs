// Minimal JSONC parser (comments and trailing commas), no dependencies.
// Scans character by character so comment markers inside strings are preserved.

/** Removes // and /* *\/ comments outside of strings. */
function stripComments(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw new Error("Unterminated block comment");
      i = end + 1;
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** Removes commas that directly precede a closing bracket (ignoring whitespace), outside of strings. */
function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== "}" && text[j] !== "]") out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripComments(text.replace(/^\uFEFF/, ""))));
}

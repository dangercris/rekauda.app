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

/** Throws when any object of the (comment-free) JSON text repeats a key. Keys are compared after decoding escapes. */
function assertNoDuplicateKeys(text) {
  const stack = []; // a Set of keys per open object, null per open array
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") stack.push(new Set());
    else if (ch === "[") stack.push(null);
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const token = text.slice(i, j + 1);
      i = j;
      let k = j + 1;
      while (/\s/.test(text[k] ?? "")) k++;
      const keys = stack[stack.length - 1];
      if (text[k] === ":" && keys) {
        const key = JSON.parse(token);
        if (keys.has(key)) throw new Error("Duplicate key in JSONC");
        keys.add(key);
      }
    }
  }
}

/** Parses JSONC. With { rejectDuplicates: true } a repeated key in any object is an error (no last-wins ambiguity). */
export function parseJsonc(text, { rejectDuplicates = false } = {}) {
  const clean = stripTrailingCommas(stripComments(text.replace(/^\uFEFF/, "")));
  const value = JSON.parse(clean);
  if (rejectDuplicates) assertNoDuplicateKeys(clean);
  return value;
}

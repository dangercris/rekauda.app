// Renders one JS value as a SQLite literal for generated INSERT files. Strict on purpose: anything that cannot be
// represented exactly (NaN, unsafe integers, NUL, lone surrogates, objects) throws a generic error with no value in it.
export function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "string") {
    if (value.includes("\u0000") || !value.isWellFormed()) throw new Error("text cannot be rendered as a literal");
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return String(value);
  throw new Error("value cannot be rendered as a literal");
}

/** Joins class names, keeping only non-empty strings (so `cond && "name"` works with any condition type). */
export function cx(...names: unknown[]): string {
  let out = "";
  for (const name of names) {
    if (typeof name === "string" && name) out = out ? `${out} ${name}` : name;
  }
  return out;
}

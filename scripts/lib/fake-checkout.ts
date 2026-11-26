import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("../../", import.meta.url).pathname;

/**
 * Builds a throwaway checkout (scripts plus the committed examples) so tests never read or write the real
 * repo files, including a developer's local wrangler.jsonc or .pilot-resources.json.
 */
export function fakeCheckout(base: string, files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), `${base}-`));
  cpSync(repo + "scripts", join(root, "scripts"), { recursive: true, filter: (src) => !src.endsWith(".test.ts") });
  for (const file of ["rekauda.config.example.ts", "wrangler.example.jsonc", "wrangler.cloud.example.jsonc"]) cpSync(repo + file, join(root, file));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

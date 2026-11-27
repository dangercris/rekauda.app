// pilot:demo-workdir: a private workdir holding two identical INVENTED exports, in the exact format and manifest shape that
// pilot:export writes. It exists so the rehearsal (provision, plan, import, validate, undo) never needs a real export. It
// makes no remote call, reads no pilot reference and prints only the workdir path and counts. The data is the test fixture
// (invented families and amounts): Node loads it by type stripping, so that file has no runtime imports.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTables } from "./import/pilot-fixture.ts";
import { canonicalHash, EXPORT_TABLES } from "./pilot-export.mjs";
import { createWorkdir, openWorkdir, writeManifest } from "./private-workdir.mjs";

export function runDemoWorkdir(args, { root, log = console, tmp = tmpdir(), now = () => new Date().toISOString() }) {
  if (args.length !== 0) {
    log.error("[demo-workdir] REFUSED: it takes no arguments.");
    return 1;
  }
  let dir;
  try {
    dir = createWorkdir({ root, tmp, now });
    const { manifest } = openWorkdir(dir, { root, tmp });
    const tables = makeTables();
    const counts = Object.fromEntries(EXPORT_TABLES.map((t) => [t, tables[t].length]));
    const hash = canonicalHash(tables);
    for (const n of [1, 2]) {
      const file = `export-${n}.json`;
      writeFileSync(join(dir, file), JSON.stringify({ version: 1, tables }), { mode: 0o600 });
      manifest.exports.push({ file, hash, counts, at: now(), matchesFirst: n === 1 ? null : true });
    }
    writeManifest(dir, manifest);
    log.log(`[demo-workdir] workdir=${dir}`);
    log.log(`[demo-workdir] two identical invented exports: ${EXPORT_TABLES.map((t) => `${t}=${counts[t]}`).join(" ")}`);
    log.log("[demo-workdir] INVENTED data for a rehearsal only. Remove it with pilot:cleanup when you are done.");
    return 0;
  } catch {
    log.error("[demo-workdir] FAILED: nothing was created (no details are shown on purpose).");
    return 1;
  }
}

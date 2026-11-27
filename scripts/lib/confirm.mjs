// Typed confirmation for production commands. Refuses without a TTY (no piped "yes"), needs the exact phrase, and
// never echoes what was typed. Sync on purpose: the wrapper is sync. No dependencies.
import { readSync } from "node:fs";

/** Reads one line from stdin (fd 0) byte by byte so nothing past the newline is consumed. */
function readStdinLine() {
  const byte = Buffer.alloc(1);
  let line = "";
  while (readSync(0, byte, 0, 1, null) === 1 && byte[0] !== 10) line += String.fromCharCode(byte[0]);
  return line.replace(/\r$/, "");
}

export function confirmTyped(phrase, { isTTY = process.stdin.isTTY, readLine = readStdinLine, write = (m) => process.stderr.write(m) } = {}) {
  if (!isTTY) return false;
  write(`Type exactly "${phrase}" and press Enter to continue: `);
  try {
    return readLine() === phrase;
  } catch {
    // EAGAIN on a non-blocking stdin, EIO, a closed descriptor: all of them are a refusal, never a crash or a pass.
    return false;
  }
}

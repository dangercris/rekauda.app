#!/usr/bin/env bash
# Records the verification of a receipt (run by a person or an assistant). Never touches rows already marked pagado or anulado.
# Usage: scripts/review.sh <CODE> <recibido|observado> "<verification details>" ["<note shown to the family>"] [--local]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$ROOT/node_modules/.bin/wrangler"

CODE="${1:?code required}"
STATUS="${2:?status required}"
VERIFICATION="${3:?verification details required}"
NOTE="${4:-}"
TARGET="--remote"
[[ "${5:-}" == "--local" ]] && TARGET="--local"

[[ "$CODE" =~ ^[2-9A-Z]{3}-[2-9A-Z]{3}$ ]] || { echo "invalid code: $CODE" >&2; exit 1; }
case "$STATUS" in recibido | observado) ;; *) echo "status must be recibido or observado" >&2; exit 1 ;; esac
if [[ "$STATUS" == "observado" && -z "$NOTE" ]]; then
  echo "observado requires a note for the family" >&2
  exit 1
fi

sql_quote() {
  local q="'"
  local v="${1//$q/$q$q}"
  printf "'%s'" "$v"
}

NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
NOTE_SQL="review_note"
[[ -n "$NOTE" ]] && NOTE_SQL="$(sql_quote "$NOTE")"

SQL="UPDATE payments SET status = '$STATUS', verification = $(sql_quote "$VERIFICATION"), review_note = $NOTE_SQL,
  reviewed_by = 'script', reviewed_at = '$NOW', updated_at = '$NOW'
  WHERE code = '$CODE' AND status IN ('en_revision', 'recibido', 'observado')"

OUT="$(cd "$ROOT" && "$W" d1 execute DB "$TARGET" --json --command "$SQL" 2>&1 || true)"
if ! echo "$OUT" | jq -e 'type == "array" and .[0].success == true' >/dev/null 2>&1; then
  echo "update failed for $CODE:" >&2
  echo "$OUT" >&2
  exit 1
fi

CHECK_SQL="SELECT code, status, reviewed_by FROM payments WHERE code = '$CODE'"
(cd "$ROOT" && "$W" d1 execute DB "$TARGET" --json --command "$CHECK_SQL" 2>/dev/null) | jq -c '.[0].results[0] // "code not found"'

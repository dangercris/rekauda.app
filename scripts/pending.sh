#!/usr/bin/env bash
# Lists receipts waiting for review (status en_revision) and downloads them to receipts-inbox/.
# Usage: scripts/pending.sh [--local] [--collection <slug>]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$ROOT/node_modules/.bin/wrangler"
TARGET="--remote"
COLLECTION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) TARGET="--local"; shift ;;
    --collection) COLLECTION="${2:?--collection needs a slug}"; shift 2 ;;
    *) echo "usage: scripts/pending.sh [--local] [--collection <slug>]" >&2; exit 1 ;;
  esac
done
[[ -z "$COLLECTION" || "$COLLECTION" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "invalid collection slug: $COLLECTION" >&2; exit 1; }
FILTER=""
[[ -n "$COLLECTION" ]] && FILTER="AND c.slug = '$COLLECTION'"
BUCKET="$(node "$ROOT/scripts/r2-bucket.mjs")"
INBOX="$ROOT/receipts-inbox"
mkdir -p "$INBOX"

SQL="SELECT c.slug AS collection, p.code, p.parent_name, p.amount_cents, p.expected_cents, p.transfer_date, p.bank, p.reference,
  p.receipt_key, p.receipt_sha256, p.created_at,
  (SELECT group_concat(s.given_names || ' ' || s.surnames || ' [' || s.option_key || ']', '; ')
     FROM students s WHERE s.payment_id = p.id) AS students,
  (SELECT count(*) FROM payments d WHERE d.receipt_sha256 = p.receipt_sha256 AND d.id != p.id AND d.status != 'anulado') AS same_file,
  (SELECT count(*) FROM payments d WHERE p.reference IS NOT NULL AND d.reference = p.reference AND d.id != p.id AND d.status != 'anulado') AS same_reference
FROM payments p LEFT JOIN collections c ON c.id = p.collection_id
WHERE p.status = 'en_revision' $FILTER ORDER BY p.created_at"

JSON="$(cd "$ROOT" && "$W" d1 execute DB "$TARGET" --json --command "$SQL" 2>/dev/null)"
echo "$JSON" | jq '.[0].results'

echo "$JSON" | jq -r '.[0].results[] | "\(.code) \(.receipt_key)"' | while read -r code key; do
  ext="${key##*.}"
  if (cd "$ROOT" && "$W" r2 object get "$BUCKET/$key" "$TARGET" --file "$INBOX/$code.$ext" >/dev/null 2>&1); then
    echo "downloaded $INBOX/$code.$ext"
  else
    echo "FAILED to download $key" >&2
  fi
done

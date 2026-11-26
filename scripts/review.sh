#!/usr/bin/env bash
# Disabled on feat/cloud: this script targets the pilot database and bucket. The pilot version lives on main.
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/cloud-guard.mjs" --refuse-branch

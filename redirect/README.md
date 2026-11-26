# Redirect Worker (optional, legacy)

This folder holds a tiny Worker that permanently redirected the first URL shared with families of the original instance to its current site. It is not needed for a new school and is not part of the main deploy.

Its `wrangler.jsonc` contains account-specific values, so it is untracked (`.gitignore`) and only exists on the original owner's machine. If you ever need something similar, create your own `redirect/wrangler.jsonc` with a `name`, `main: "index.js"` and a `compatibility_date`, then run `wrangler deploy` from this folder.

# CLAUDE.md

Guidance for AI coding agents (Claude Code and others) working in this repository. Human docs live in `README.md`, `CONTRIBUTING.md` and `docs/` (Spanish); this file is the short, binding version for agents.

## What this is

Rekauda: an open-source (MIT) web app for Ecuadorian school classes / parent committees to collect payments (Deuna or bank transfer) with receipts, a public progress board and a treasurer admin. Each school runs its own instance on its own Cloudflare account.

- Cloudflare Worker (`src/worker/`) serves `/api/*` and `/r/*`; everything else is static assets built by Vite into `dist/` (SPA fallback).
- React 19 + TypeScript strict client (`src/client/`): public app (`index.html`) and admin (`admin.html`, hash routes like `/admin#pagos`, `#movimientos`).
- D1 (binding `DB`), R2 (binding `RECEIPTS`: `receipts/` private, `covers/` public, `og/` generated cards), Images binding (OG card JPEG), rate limiters, Email Routing to the Worker's `email()` handler.
- Shared HTTP contract: `src/shared/api.ts`. The Worker types every JSON response with `satisfies` against it.

Deep dive: `docs/ARQUITECTURA.md`. Deploy runbook: `docs/DESPLIEGUE-CLOUDFLARE.md`. Deuna email runbook: `docs/CORREO-DEUNA.md`. Treasurer ops: `docs/OPERACION.md`. Design system: `DESIGN.md`. Product intent: `PRODUCT.md`.

## Commands

```bash
pnpm install
pnpm db:migrate:local      # local D1
pnpm dev:api               # Worker on http://localhost:8799 (needs .dev.vars)
pnpm dev:web               # Vite, proxies /api to :8799
pnpm typecheck             # worker + client tsc
pnpm test                  # vitest (client: jsdom, worker: node)
pnpm build                 # vite build -> dist/
pnpm types                 # regenerate worker-configuration.d.ts after wrangler.jsonc changes
pnpm run deploy            # remote migrations -> build -> wrangler deploy
```

- Use `pnpm run deploy`, never `pnpm deploy` (a pnpm builtin).
- `typecheck`, `test` and `build` must all pass before you report work as done.
- `.dev.vars` (gitignored) holds local `ADMIN_PASSWORD`, `SESSION_SECRET`, `FORWARD_TO`. Never put real secrets there, never print or log secret values.

## Per-instance configuration (critical)

- All per-school values live in `rekauda.config.ts` (gitignored). Template: `rekauda.config.example.ts`. Types: `src/shared/instance-config.ts`; fail-fast validation: `src/shared/instance-validation.ts`; resolved values: `src/shared/instance.ts`.
- Cloudflare settings live in `wrangler.jsonc` (gitignored). Template: `wrangler.example.jsonc`. `public/deuna-qr.png` and `redirect/wrangler.jsonc` are local only too.
- `scripts/ensure-config.mjs` runs before dev/build/test/typecheck/deploy/migrate and copies the examples when files are missing.
- Vitest aliases `rekauda.config` to the EXAMPLE, so tests are deterministic and never depend on a real instance. Tests and fixtures must use example values.
- Never commit `rekauda.config.ts`, `wrangler.jsonc`, `redirect/wrangler.jsonc`, `public/deuna-qr.png`, `.dev.vars`, receipts or `.eml` files.
- Adding a config field: type it in `instance-config.ts`, validate it in `instance-validation.ts`, add it to the example, document it in `docs/DESPLIEGUE-CLOUDFLARE.md`.
- Scripts and package.json use the D1 binding name `DB`, never a database name.

## Non-negotiable rules

1. **Privacy.** No real personal data anywhere tracked: no names of parents/students, account numbers, ID numbers (cédula), emails, phone numbers, transaction numbers, Cloudflare account/database ids or secret inbox addresses. Use invented data (`tesoreria@ejemplo.com`, `0000000000`, fictional names). Before committing, grep the staged diff for anything that looks real.
2. **Automation never sets `pagado`.** Scripts and the Deuna email pipeline may set `recibido` (with a note) or `observado`; only a human admin marks `pagado` or `anulado`. Never touch rows already `pagado`/`anulado`.
3. **Language.** All UI copy and human docs: neutral Spanish (Ecuador), no voseo, no em dashes. Code identifiers and comments: English.
4. **Contract first.** API changes start in `src/shared/api.ts`, then Worker (`satisfies`) and client.
5. **Money** is always integer cents. Calendar dates are `YYYY-MM-DD` in Ecuador time (UTC-5, no DST).
6. **Migrations** are new numbered files in `migrations/`. Never edit an applied migration's behavior. D1 SQL comments must not contain `;` or unbalanced quotes.
7. **Security headers.** The CSP exists in both `public/_headers` and `src/worker/og.ts`; keep them identical (a test checks this). The admin keeps a strict CSP without analytics hosts. Never loosen CSP beyond what a feature strictly needs.
8. **Logs** are one structured JSON line with a `message`; never include emails, family names, secrets or the FORWARD_TO address.
9. **Analytics** loads only after consent (footer "Preferencias de cookies"); never in the admin. `analytics.gaMeasurementId: null` disables it.
10. **Commits**: conventional commits (`feat:`, `fix(ui):`, `docs:`...), small reviewable units, no AI co-author or attribution lines. Do not commit or push unless the user asks.

## Deuna email pipeline (high risk area)

- The treasurer's Deuna account email is a secret Email Routing address routed to this Worker. `email()` buffers the raw message (max 1 MB), **forwards to `FORWARD_TO` first, always**, then processes.
- Processing (`processDeunaRaw` in `src/worker/email/handler.ts`): exact From `notificaciones@deunaapp.com` + in-Worker DKIM verification (`src/worker/email/dkim.ts`, `d` must be exactly `deunaapp.com`). Deuna's DMARC is `p=none`, so DKIM is the only anti-spoofing defense; never weaken it.
- Real Deuna mail comes via Amazon SES: `s=s1`, `c=relaxed/simple`, and a DKIM-Signature folded over several lines (tags separated by CRLF + tab). Tag parsing must tolerate folding white space.
- The parser (`src/worker/email/deuna.ts`) reads the "Los detalles de tu pago" block by label sequence; Motivo is payer-controlled free text, so labels after it are anchored from the end and the intro amount/name must match.
- Matching (`src/shared/match.ts`): equal amount mandatory, date window, at least 2 name tokens for auto-link, unambiguous winner only. Otherwise the movement stays unmatched for the admin (`#movimientos`), where `.eml` import also exists.
- Debug with the Cloudflare dashboard (Workers > the worker > Observability, search `deuna_mail`). `wrangler tail` connects late and often misses `email()` events.

## Frontend conventions

- CSS Modules + design tokens (`src/client/design/tokens.css`); follow `DESIGN.md` (liquid glass, Geist, per-event tone). No hardcoded colors or spacing outside tokens.
- The global list reset in `src/client/design/base.css` uses `:where()` (zero specificity) so component list padding wins; keep it that way.
- Hero overlap spacing uses `--hero-overlap` and `--hero-overlap-gap` in `src/client/ui/Hero.module.css`; do not reintroduce magic numbers.
- Accessible markup: real buttons/links/labels, `aria-label` on icon-only buttons, 4.5:1 text contrast.
- Validate forms like the server does (shared rules); show errors in Spanish.

## Cloudflare gotchas

- Adding `routes` with `custom_domain` disables `workers.dev` unless `workers_dev: true` is explicit.
- The Cache API does nothing on `workers.dev`; generated OG cards are stored in R2 (`og/<slug>/<version>.jpg`).
- Rerun `pnpm types` after changing bindings or `secrets.required` in `wrangler.jsonc`.
- Deploys occasionally fail with a transient Cloudflare API error; retry once before investigating.

## Brand assets

Logo files live in `.github/assets/` (`logo.svg`, `logo-dark.svg`, `mark.svg`, `icon.svg`, `social-preview.png`): a "K" of three round strokes, blue `#2D5BFF` (treasury), coral `#FF6A4D` and teal `#14B8A6` (families' contributions), blended with multiply on light and screen on dark, plus the wordmark "rekauda" in Geist Bold (text converted to outlines).

## Author

Christian Segovia ([@danger_cris](https://x.com/danger_cris)). License: MIT.

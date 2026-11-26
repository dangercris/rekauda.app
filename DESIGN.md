# Design

Visual source of truth: the "Recaudo Escolar" canvas (Sistema visual, Evento claro/oscuro, Subir comprobante, Comprobante enviado, Tesorería). Code source of truth: `src/client/design/` (tokens, materials, tone math) and `src/client/ui/` (components). The living style guide is `pnpm dev:web` then `/gallery` (dev only, never built).

## Principles

- A neutral liquid-glass base that does not compete. Each collection ("evento") brings the personality through its **tone** and **cover**: they tint the ambient light, the primary buttons and progress.
- **60 / 30 / 10**: the tone goes on buttons, progress and accents; the derived secondary and accent colors only appear as diffuse light behind the glass, never as text.
- Money needs certainty: tabular figures, exact amounts, copy buttons with confirmation, status always as label + icon (never color alone).
- One thumb: the next action lives in a sticky bottom bar; touch targets are at least 44px; inputs are 16px (no iOS zoom).

## Themes

Light by default (`--bg #EEF0F4`, ink `#0E1117`), dark follows `prefers-color-scheme` (`--bg #07080B`). `<html data-theme="light|dark">` forces one; any element can force a scheme for its subtree (the gallery does; put it on an ancestor of the theme provider). Tokens live in `design/tokens.css`:

| Group | Tokens |
|---|---|
| Surfaces / text | `--bg --fg --fg-2 --muted --line --line-strong --surface-solid --switch-off` |
| Glass | `--glass --glass-strong --glass-solid --edge --hi --sheen --shadow --shadow-float --sheet --selected` |
| Neutral action | `--ink --ink-fg` |
| Status | `--ok --warn --bad --info --void`, each with `-bg` (tint) and most with `-solid` (fill) |
| Event tone | `--ev --ev-rgb --ev-ink --ev-soft --ev-text --ev-glass --ev-ring --ev-bar --ev2 --ev3` (set at runtime) |
| Type | Geist / Geist Mono; `--fs-micro` 11 ... `--fs-amount` 46 (rem), `--fw-*`, `--tracking-*` |
| Shape / space | `--r-xs` 8 ... `--r-hero` 34, `--r-pill`; `--sp-*` (4px grid); `--touch` 44, `--control-h` 50 |
| Motion | `--ease-out` (ease-out-quint), `--dur-fast` 150, `--dur` 200, `--dur-slow` 250 |

## Materials (`design/materials.css`, global `m-*` classes)

| Class | Recipe | Use |
|---|---|---|
| `m-glass` | fill white 56% / dark 50%, `blur(28px) saturate(190%)`, 1px edge, 1px top highlight, 155deg sheen | Panels, chips, bars |
| `m-glass-strong` | dense fill + hairline | Inner groups and fields on glass |
| `m-glass-dark` | dark 36% fill, `blur(18px)`, white text | Chips and buttons over photos |
| `m-sheet` | stronger fill, `blur(40px) saturate(200%)`, upward shadow | Bottom sheets |
| `m-ev` / `m-ink` / `m-ok` / `m-bad` | solid fill + inner light + colored glow | Buttons |

Without `backdrop-filter` support the fills get denser; with `prefers-reduced-transparency` every glass becomes a solid surface and the ambient light becomes a flat tint.

## Event tone math (`design/tone.ts`)

Same as the canvas `vars()` function, with two safety nets:

- `L` = WCAG relative luminance of the tone.
- `--ev-ink` (text on tone fills) = `L > 0.36 ? #0E1117 : #FFFFFF`; if that pick is under 4.5:1 (tones with 0.19 < L <= 0.36) the higher-contrast option is used instead.
- `--ev-text` (tone as text) = dark ? `mix(tone, white, .45)` : `L > 0.18 ? mix(tone, black, .42) : tone`, then pushed toward black/white until it reaches 4.5:1 on the page (`#EEF0F4`) or on dark glass (`#22242E`).
- `--ev-soft` = tone at 12% (light) / 22% (dark). `--ev-glass` = tone at 66% (price tag over photos). `--ev-bar` = tone (light) / `--ev-text` (dark).
- `--ev2` / `--ev3` are derived by hue rotation (warm tones: +45deg golden secondary, +165deg deep accent; cool tones: complementary warm secondary, +28deg light accent). Ambient only.

Apply a tone with `<EventThemeProvider tone coverUrl>` (page) or `<ToneScope tone>` / `<ListRow tone>` (per row in multi-event admin lists). Invalid tones fall back to `#3D4FA3`.

## Ambient light and covers

`<AmbientBackground>`: the cover blurred 90px and saturated (opacity `--amb`), plus two 120px-blurred blobs of `--ev2` and `--ev3`. No cover: a tone glow. `<Hero>`: cover photo (or tone artwork when `coverUrl` is null) with a top scrim for the chips and a scrim sized to the text block, so white text stays at 4.5:1 or more even over a white photo.

## Typography

| Role | Size / weight | Notes |
|---|---|---|
| Event title | 40 / 700, -0.04em | Hero, balanced wrap |
| Amount | 46 / 700, cents at about 48% in `--muted` | `<Money variant="display">` "$1.696,00" |
| Admin page title | 34 / 700 | `PageHeader` |
| Section | 19 / 650, -0.02em | `SectionHeader` |
| Body | 15 / 400, 1.45 | Inputs 16 |
| Captions | 12-13 / 500-600, `--muted` | Labels, meta |
| Codes | Geist Mono 500 | Tracking codes, transaction numbers |

## Status palette

| API status | Label | Tone | Icon |
|---|---|---|---|
| `en_revision` | En revisión | warn (amber) | clock |
| `recibido` | Recibido | info (calm blue, not the event tone, so it reads the same across events) | mail |
| `observado` | Con observación | bad (red) | alert-circle |
| `pagado` | Pagado | ok (green) | check |
| `anulado` | Anulado | void (muted) | x |

## Components (`src/client/ui`, import from `../ui`)

- Actions: `Button` (event, ink, glass, soft, ghost, ok, danger, danger-soft, on-image; sm 40 with a 44 hit area, md 50, lg 56; loading keeps the width), `IconButton` (label required), `Link`.
- Surfaces: `Card` (glass, strong, on-image, dashed), `Sheet` + `SheetLayout`, `ActionBar`, `TabBar` (bottom bar on phones, segmented in the header from 960px).
- Data: `Money`, `StatusPill`, `Chip` / `Badge`, `KeyValue` / `CopyRow`, `Timeline`, `ProgressBar` / `SegmentedBar`, `StatTile`, `ListGroup` / `ListRow` / `ListItem`, `Avatar`, `IconTile`, `CheckItem`, `CheckList`, `NumberedSteps`, `InfoNote`.
- Forms: `TextField`, `TextArea`, `SelectField` (native), `Checkbox`, `Toggle` (role switch), `SegmentedControl` (radio group, roving tabindex), `RadioCards`, `Counter`, `Stepper`, `FileDrop`, `SwatchPicker`.
- Feedback: `Notice`, `InlineConfirm` (no modals, ever), `EmptyState`, `Skeleton`, `ToastProvider` / `useToast`, `Spinner`.
- Layout: `Hero`, `AmbientBackground`, `BrandPill`, `PageHeader`, `TopBar`, `SectionHeader`.

## Layout and motion

Mobile first, 16px gutters, checked at 360px without horizontal scroll; desktop enhancement from 960px (forms capped at 34rem). Motion is 150-250ms ease-out-quint on opacity, transform and color only; `prefers-reduced-motion` removes it (the spinner keeps a slow turn).

## Copy

Spanish (Ecuador), neutral register, no voseo, no slang, no em dashes. Code and identifiers in English.

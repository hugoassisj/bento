---
id: DS-11
title: "Design-token import and export (design-tokens JSON)"
epic: 5-design-system
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:design-system"]
depends_on: []
related: [DS-06, DS-12, AI-04, AI-08]
upstream: []
---
## Summary

A deck's tokens can only be typed in by hand, one at a time. A team that already keeps its brand as design tokens in Figma or Penpot cannot bring them in, and a deck's tokens cannot be taken out. Add import and export in the design-tokens JSON format so a brand arrives in one step and stays the user's own.

## What the user experiences

A designer has `brand.tokens.json` exported from Penpot or Figma. In Bento they open the Tokens tab and find **+** per token. Forty colours and a spacing scale means forty-plus manual entries. Going the other way, there is no way to hand a deck's tokens to a colleague or to an agent as a file.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173, left panel ▸ Tokens tab.
2. Look for Import or Export. There is none; the only token actions are **+** per type, rename, delete, and Bind.

## Evidence

- **Confirmed in code now:**
  - `slides/src/editor/tokenspane.ts`: no import or export code path; searching `slides/src` for `importTokens`, `exportTokens`, `$value` or `design-tokens` returns nothing.
  - Token model: `slides/src/model.ts:259-276`. `DesignTokens { modes?, mode?, set: Record<name, { type, values: Record<mode, value> }> }`; `TokenType` is `color | number | fontFamily | fontSize | shadow | opacity`; `ShadowSpec { x?, y?, blur, color }`.
  - Names: `slides/src/tokens.ts:31-34`: a letter, then up to 63 of `[\w.-]`; names that reach `Object.prototype` are refused (`protoName`, `:28`). Dots are already used as groups (`radius.md`).
  - Intake rule every imported value must pass: `slides/src/restoregate.ts:75-103` (`tokens()`): numbers finite and within ±1e6, opacity 0..1, colours and font families through the element gate, at most 500 tokens and 16 modes.
  - Theme palette slots live outside tokens (`slides/src/palette.ts:41`, `PALETTE_SLOTS`).
- **Seen in the running app:** the absence only.
- **Not verified here:** the exact JSON that current Figma and Penpot versions export. Collect one real export from each before writing the mapper, and commit them as fixtures.

## How others do it

- **Penpot:** design tokens are native and import/export as JSON in the Design Tokens Community Group format (`$value`, `$type`, nested groups, `{group.name}` aliases), with sets and themes.
- **Figma:** variables export to and import from JSON; modes are per collection.
- **Tokens Studio:** the de facto multi-set file layout that Penpot reads.
- **PowerPoint:** a theme file (`.thmx`) carries colours and fonts between decks; no token interchange.

## Proposed change

**Export.** Tokens tab header gets a ⋯ menu: **Export tokens…** (download `<deck title>.tokens.json`, and a Copy button). Shape:

- One top-level group per mode (the mode names), each holding the tokens nested by the dots in their names, each leaf `{ "$type": …, "$value": … }`.
- Type mapping: `color` → `color` (hex with alpha); `number` → `dimension` (`"16px"`); `fontSize` → `dimension`; `opacity` → `number`; `fontFamily` → `fontFamily`; `shadow` → `shadow` (`offsetX`, `offsetY`, `blur`, `spread: 0`, `color`).
- The theme palette slots are exported as a `theme` group (`theme.background`, `theme.text`, `theme.accent1` …) so a round trip restores them.
- A `$description` on the root naming the deck and the Bento version.

**Import.** **Import tokens…** accepts a file or pasted JSON and shows a review before anything changes:

- Parse leaves with `$value` (and the older `value` spelling). Infer the type from `$type`, falling back to the value's shape.
- Flatten group paths to dotted names; sanitise to the name rule; on collision after sanitising, suffix.
- **Aliases** (`{group.name}`): resolve to the referenced value and import the literal. Report how many were flattened (DS-12 would keep them).
- **Modes:** if the top level looks like sets (every child is a group of the same shape), offer "each set is a mode"; otherwise import into the active mode.
- **Unsupported types** (typography, border, transition, gradient, …): listed in the review as skipped, never silently dropped.
- Review table: new / changed (old → new) / unchanged / skipped, with a per-row checkbox and "Replace existing" default off. Apply is one undo step. Nothing is rebound: existing bindings keep following the token names they already follow.
- A `theme` group in the file offers to set the theme palette, off by default.

**Safety.** Every imported value passes the same rule as `tokens()` in `restoregate.ts` (reuse it; do not write a second validator). Limits: 500 tokens, 16 modes, 1 MB of JSON. No network: a URL is never fetched.

New strings (all eight catalogs): Export tokens…, Import tokens…, the review headings and counts, the skipped reasons.

No format change.

## Acceptance criteria

- [ ] Export then import into an empty deck reproduces `theme.tokens` exactly (names, types, values per mode).
- [ ] A real Penpot export and a real Figma export (fixtures) import with every supported token present and every unsupported one listed as skipped with its reason.
- [ ] Aliases in the file import as resolved literals, and the review states the count.
- [ ] A hostile file (a `url(...)` colour, `__proto__` as a name, a 10,000-token file, a non-finite number) imports nothing harmful and reports each refusal.
- [ ] Import never changes a token the user left unticked, and never unbinds anything.
- [ ] Import is one undo step; undo restores the previous token set byte for byte.
- [ ] Export contains no document content, no `collab`, no asset data.
- [ ] Works with the network unavailable.

## Tests

- Node: `scripts/test-slides-token-io.ts`: round trip; the two real fixtures under `scripts/fixtures/tokens/`; the hostile cases; the mapping table. Register at the end of the slides slice in `.github/actions/validate-slides/action.yml`.
- Browser: one case in `scripts/test-slides-tokens`-family browser rig (or a new `test-slides-token-io-browser.mjs`): open the dialog, paste a small file, tick a row, Apply, assert on `window.bento.doc.theme.tokens`, then Undo.
- `scripts/test-export-secrets.ts`: add the token export to the list of exports that must not carry live-session keys.

## Out of scope

- Keeping aliases, text styles (DS-12).
- Per-mode theme colours (DS-06); until it lands, a multi-mode file's theme group applies to every mode.
- Syncing with a remote library.

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/tokenspane.ts`, a new pure module (for example `slides/src/tokenio.ts`, DOM-free so the node rig can import it), the eight i18n catalogs, `CHANGELOG.md`.
- Use the kernel dialog primitive for the review (`kernel/src/ui/dialog.ts`, already used by Compress pictures and Export images) so focus trapping and Escape come for free. Calling it is not a kernel change.
- The agent CLI in AI-04 (`inspect`) and compact input in AI-08 should reuse the export shape, so name things once.
- Record the byte cost; a mapper and a review dialog are probably 2–3 KB compressed.

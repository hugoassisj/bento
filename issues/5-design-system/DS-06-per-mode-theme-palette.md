---
id: DS-06
title: "Per-mode theme palette"
epic: 5-design-system
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:design-system", "format-change"]
depends_on: [DS-05]
related: [DS-11, DS-12, F-01, F-02]
upstream: []
---
## Summary

A deck can have token modes (for example Default and Dark), but its theme colours (background, text, accents) have one value for every mode. Since most of a deck's colour follows those theme colours, "Dark mode" cannot actually make a deck dark. Let each mode carry its own theme palette, without breaking how older shells read the file.

## What the user experiences

They add a Dark mode expecting to define dark colours. Number tokens vary by mode; the seven theme colours do not, and editing one changes every mode (DS-05). The headline use of modes, a light and a dark version of the same deck, is not possible.

## Reproduce

See DS-05. In short: add a mode, change Background, switch back, and the first mode has the new Background.

## Evidence

- **Confirmed in code now:**
  - `slides/src/editor/tokenspane.ts:424`: "ponytail: one value in every mode; per-mode theme colours need a format addition."
  - `slides/src/palette.ts:176` (`paletteOf`) reads `theme.background`, `theme.color`, `theme.accent` and `theme.palette`; nothing is keyed by mode.
  - `slides/src/derive.ts:50-51`: when `paletteSignature(doc)` changes, `resolveThemeRefs` rewrites every literal bound to a palette slot.
  - **Old-shell constraint 1:** released shells re-derive a palette-bound literal at boot from the theme's own keys (`docs/DECISIONS.md:15303-15306`, "re-derives a linked literal at BOOT as the bare slot colour"; `scripts/test-slides-alpha-refs.ts` pins it). So whatever is in `theme.background`, `theme.color`, `theme.accent`, `theme.palette` is what an old shell paints.
  - **Old-shell constraint 2:** a 1.3.0 shell normalises `theme.tokens` on open (`slides/src/restoregate.ts:247-252` → `tokens()` at `:75-103`): only `set`, `modes`, `mode` survive under `theme.tokens`. A per-mode palette stored there would be deleted the first time a 1.3.0 shell opens and saves the file.
  - `restoregate.ts:57` (`plainObject`): settings objects keep plain values and one nested level; anything deeper is dropped when a snapshot is restored.
- **Seen in the running app:** only the symptom (DS-05).

## How others do it

- **Figma:** colour variables have a value per mode; a frame or page picks its mode.
- **Penpot:** token themes enable sets; a "dark" theme swaps the colour set.
- **PowerPoint:** one colour set per theme; Variants are alternative themes. No per-mode palette, which is why this is a place Bento can be better.

## Proposed change (format first)

**New optional key:** `theme.paletteModes?: Record<string, string>`, a flat map from `"<mode>/<slot>"` to a colour, for example `{ "Dark/bg1": "#101418", "Dark/tx1": "#F2F0EA" }`. Flat, one level deep, plain strings, outside `theme.tokens`: it survives both gates named above in a 1.3.0 shell.

**Rule: the existing keys always hold the active mode.** `theme.background`, `theme.color`, `theme.accent` and `theme.palette` are the truth every reader already uses. The new map is the memory of the other modes.

- Editing a theme colour writes the base key **and** `paletteModes["<active>/<slot>"]`.
- Switching mode (`switchMode`, `tokenspane.ts:187`): first store the outgoing mode's seven slots into the map (if absent), then copy the incoming mode's entries into the base keys. `paletteSignature` moves, and the existing derive pass repaints bound literals. No new derive step.
- Adding a mode copies the current base palette into the map under the new name.
- Renaming or deleting a mode renames or deletes its map entries (same places that rename `values[...]` today, `tokenspane.ts:361-364`).
- A deck with no `paletteModes` behaves exactly as today (one value in every mode) until the user edits a theme colour while more than one mode exists.

**What an older shell does:** it ignores `paletteModes` and paints the base keys, which hold the mode that was active at save time, matching the token-bound literals in the same file. The picture is consistent. If that shell saves, unknown fields are meant to be preserved (`docs/PLATFORM.md:74`, `CONTRIBUTING.md:65`); verify for this key with a released shell, see Tests.

**Gate:** every value in the map goes through the same colour rule as `theme.background` (`restoregate.ts:243-246`), keys must be `<known mode>/<known slot>`, at most 16 modes × the slot count. Add it to `MODEL_KEYS` via `node scripts/build-modelkeys.mjs` and to the schema via `node scripts/build-schema.mjs`.

**Collaboration:** `mode` and the base keys are separate properties, so two people switching mode at once could briefly leave `mode = A` with B's colours. Decide in review whether to (a) write mode and the base keys in one commit and accept last-writer-wins per key, or (b) make "base keys equal the active mode's entries" a derived invariant enforced in `derive.ts`. Prefer (b) if it stays a fixed point.

**UI:** remove DS-05's "Same in every mode" badge and toast for decks that use the map; the mode-switch summary now counts theme colours as changed.

**Validator:** flag a map entry naming a mode or slot that does not exist (`theme-palette-mode-unknown`).

New strings: none beyond the validator message (validator messages are English-only today; check before adding to catalogs).

## Acceptance criteria

- [ ] Add Dark, set Background and Text in Dark, switch to Default: Default's colours are unchanged; switch back: Dark's are restored. Every bound element repaints both ways.
- [ ] A deck saved in Dark opens in a 1.3.0 shell showing Dark colours consistently (bound literals and theme keys agree), with no gate drops.
- [ ] After a 1.3.0 shell opens and saves that deck, `paletteModes` is still in the file (or the PR states precisely what was lost and why that is acceptable).
- [ ] A deck without `paletteModes` is byte-identical after open and save in the new shell.
- [ ] Renaming and deleting a mode keeps the map consistent; no orphan entries.
- [ ] Undo and redo of a mode switch restore colours and mode together.
- [ ] `window.bento.validate()` flags a dangling map entry.
- [ ] The derive pass is a fixed point after a mode switch.

## Tests

- Node: extend `scripts/test-slides-tokens.ts` and `scripts/test-slides-derive.ts` with the switch, add, rename and delete cases and the fixed-point check.
- Old shell: follow `scripts/test-slides-alpha-refs.ts`, which pins released-shell behaviour: open a deck carrying `paletteModes` under the released regex/shell logic and assert the painted colours and what survives a save.
- Gate: extend `scripts/test-fileopen-gate.ts` and `scripts/test-slides-gate-keys.ts` (the rigs that exercise `restoregate.ts`) with hostile map values (a `url(...)`, a key reaching `__proto__`, 10,000 entries).
- Schema: `node scripts/build-schema.mjs --check` and `scripts/test-schema-frozen.mjs` must pass (released schema twins are never rewritten).

## Out of scope

- Per-slide or per-frame mode (Figma lets a frame choose its mode). One active mode per deck stays.
- Token aliases (DS-12).
- Code and chart palettes (`theme.codePalette`, `theme.chartPalette`) varying by mode: raise separately if wanted.

## Notes for the implementer

- This adds to the document format: propose the key upstream before building for upstream (`needs` the maintainer's answer on the name and on option (a) vs (b)).
- Slides app only if the gate change stays in `slides/src/restoregate.ts`; check whether the shared list in `kernel/src/docfields.ts` is involved. If it is, split that part out (kernel zone).
- Hot files: `slides/src/model.ts` (theme type near `:751-787`), `slides/src/palette.ts`, `slides/src/editor/tokenspane.ts`, `slides/src/restoregate.ts`, generated `modelkeys` and `schema/`.
- The recorded decision this extends: `docs/DECISIONS.md:12062` ("Tokens extend the palette contract … the literal always stays in place"). Append a DECISIONS entry when the key is settled.

---
id: DS-07
title: "Token chips show value and name; usage counts are labelled"
epic: 5-design-system
type: enhancement
priority: P2
size: S
evidence: mixed
labels: [enhancement, "priority:P2", "size:S", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-05, DS-04]
upstream: []
---
## Summary

When a property follows a token or a theme colour, the field is replaced by a chip showing only a name. The value disappears, long names are cut to two letters, and theme slot names read wrongly out of context: a dark slide's **Background** field says "● Text". In the Tokens tab, the usage count is a bare number.

## What the user experiences

- A slide's Background field reads **● Text**. The user asks why their background is "text". (The slide uses the theme's text colour as its fill, which is how a dark slide is made from a light theme.)
- A corner radius bound to `radius.md` shows **● ra…**: neither the name nor the number 14 is visible.
- In the Tokens tab, a row ends in "39". 39 what?

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 (starter deck), slide 1.
2. Click empty canvas so the slide is selected. Format tab ▸ Slide ▸ Background shows a chip reading **Text**.
3. Go to slide 13 ("Frames, components, tokens"), click a card. Its corner radius field shows a chip with a truncated token name and no number.
4. Left panel ▸ Tokens tab. Each row ends in a number with no unit or label.

## Evidence

- **Seen in the running app (design-features journey):** screenshots `22-chip-click.png` (Background reads "● Text") and `22-tile-selected.png` (radius reads "● ra…"); the count is a bare number.
- **Confirmed in code now:**
  - Number and size fields: `slides/src/editor/inspector/tokenbind.ts:71-93`. When bound, the field gets a pill whose text is the token name only (`name.textContent = bound`, `:80`); the value is not rendered.
  - Colour fields: `slides/src/editor/inspector/color.ts:448-457` (`boundPill`): the chip text is `label`, which for a palette slot is `slotLabel(slot)`.
  - Slot labels: `slides/src/editor/inspector/controls.ts:125-135`: `bg1` → "Background", `tx1` → "Text", `bg2`, `tx2`, "Accent n".
  - Usage count: `slides/src/editor/tokenspane.ts:231-239` (`usesButton`): the button's text is `String(used)`; the meaning lives in its `title`.

## How others do it

- **Figma:** a bound field shows the variable's name in a pill and its resolved value on hover; in the variables table every value is visible.
- **Penpot:** a field with a token applied shows the token name with the resolved value beside it, and a detach control.
- **PowerPoint:** theme colours are named by colour and role together ("White, Background 1"; "Black, Text 1"), so the role never reads as the property's meaning.

## Proposed change

1. **Number, size and opacity chips** (`tokenbind.ts`): render `<value> · <name>`, value first because it never truncates usefully from the right. Truncate the name in the middle (`radi…md`) only when needed, and keep the full name in `title`. Example: `14 · radius.md`.
2. **Colour chips** (`color.ts` `boundPill`): keep the swatch (already to the left of the field), and render the name followed by the hex in a muted style when there is room: `Text · 0D1B2E`. For a palette slot, prefix the role so it cannot be read as the property: `Theme: Text`. The leading dot should take the actual colour instead of a fixed accent.
3. **Usage counts** (`tokenspane.ts` `usesButton`): show `39×` with `aria-label` "Used 39 times; select the next use". Keep zero hidden as today (`ed-token-unused`).
4. Widths: the pill currently shares the field's width; check the narrowest panel width the splitter allows, and fall back to name-only with the value in `title` below it.

New strings (all eight catalogs): "Theme: {name}", "Used {n} times", and the `×` count format if it is not pure punctuation in every language (check the Japanese and Chinese catalogs).

No format change.

## Acceptance criteria

- [ ] A bound number field shows both the resolved value and the token name at the default panel width.
- [ ] A bound colour field shows the name and the hex; a palette slot is prefixed so "Background: Theme: Text" cannot be misread as "the background is text".
- [ ] The chip's colour dot matches the resolved colour.
- [ ] No chip truncates to fewer than six visible characters of the name at the default panel width.
- [ ] The usage count reads as a count ("39×") and has an accessible name that says what it counts and what clicking does.
- [ ] Detach and re-pick still work from the chip (click name reopens the picker; the detach icon lets go and keeps the value).
- [ ] Right-to-left UI languages render value and name in a sensible order (use `dir="auto"` or isolate the number).

## Tests

Extend `scripts/test-slides-inspector-look-browser.mjs` (inspector appearance) or `scripts/test-slides-tokens.ts` where the logic is pure:
- bind a radius to a token, assert the pill's text contains both the number and the name;
- open the starter's slide 1, assert the Background chip text contains the slot name and the hex;
- assert the uses button's text matches `/^\d+×$/` and has an `aria-label`.
The text assertions fail on the parent commit. The rig is already registered in `.github/workflows/ci-slides.yml`.

## Out of scope

- Renaming the palette slots in the format (they are `bg1`, `tx1`, … and stay).
- The Tokens tab's layout (DS-04 moves components out of it).

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/inspector/tokenbind.ts`, `inspector/color.ts`, `inspector/controls.ts`, `slides/src/editor/tokenspane.ts`, `slides/src/styles.css`, the eight i18n catalogs.
- `docs/DECISIONS.md` (the 1.3.0 editor entries, line 12040 onward) records that the literal always stays in the model beside the ref; the value is therefore always available to show.
- Colour values reach a style here: route them through `cssColor`, as upstream's post-1.3.0 fix did for the Morph-with swatches and token chips.

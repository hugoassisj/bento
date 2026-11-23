---
id: F-10
title: "Check deck panel: validator findings shown in the editor"
epic: 1-foundations
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:editor"]
depends_on: [F-07]
related: [F-08, F-09, AS-09, AI-14, DT-06, FH-16]
upstream: []
---
## Summary

`window.bento.validate()` knows about text that overflows, tables that run off the slide, dead links, missing assets and effects that can never run. None of it is visible in the editor: you only see findings by typing in the browser console. Add a Check deck panel that lists findings in plain words, jumps to the element, and offers the fix where one exists.

## What the user experiences

- A table with twelve rows runs past its box and off the bottom of the slide. The editor shows nothing; the presenter discovers it on the projector.
- After File ▸ Advanced ▸ Replace from JSON…, the only feedback is a toast: "Loaded: 0 fields dropped, 6 warnings — see console".
- A person who does not open developer tools never learns that a link points at a deleted slide or that a font is not embedded.

## Reproduce

1. Fresh load. Insert a table, add rows until it extends below the slide.
2. Look anywhere in the editor for a warning: there is none.
3. In the console, `window.bento.validate().findings.filter(f => f.code === 'table-overflow')` returns the finding with a full sentence explaining it.

## Evidence

- Observed in the running app during the audit: the data journey found the table overflow silent in the UI while `validate()` reported `table-overflow`; the AI trial recorded the Replace from JSON toast text quoted above.
- Confirmed in code now:
  - Searching `slides/src/editor/**` for `validateDoc` or `.validate(` finds no caller; no panel, badge or menu item surfaces findings. The Replace from JSON path gets its warning count from the compact loader's load report (`slides/src/compactload.ts`), not from an editor-side call.
  - `slides/src/main.ts:416` exposes `validate(target?, opts?)` returning `validateDoc(target ?? store.doc, opts)`; findings are `{ code, severity, message, slide, element, path }` (`slides/src/validate.ts`).
  - The only fix action that exists today is the text inspector's "Fit height to text" (`slides/src/editor/inspector/text.ts:19`).
  - The left panel already hosts tabs (Slides / Layers / Tokens); `toast()` supports an action button (`slides/src/editor/editor.ts:4903`).
- Not verified: the cost of running the measured checks on every edit for a large deck. Measure before choosing live updating over run-on-demand.

## How others do it

- PowerPoint: Review ▸ Check Accessibility opens a pane listing issues grouped by kind; clicking one selects the object and offers recommended actions.
- Figma: plugin and Dev Mode panels list issues with a click-to-focus on the layer.

## Proposed change

1. **Entry points.** A command `check-deck` ("Check deck") in the command list, an item in the File menu, and a small status chip near Slideshow that shows the count of errors and warnings when it is non-zero. No chip when the deck is clean.
2. **Panel.** A sheet or right-side panel (not a new permanent left tab unless it fits the existing tab bar without crowding) listing findings grouped by slide, errors first, `info` collapsed by default. Each row: an icon for severity, the slide number, the element's name, and one sentence.
3. **Words.** Finding messages today are developer English with pixel values. Add a short human sentence per code through `t()` (for example `text-overflow` → "Text does not fit its box"), and keep the precise message as secondary text. Every code needs a mapping; unknown codes fall back to the raw message. All strings in every catalog.
4. **Jump.** Clicking a row goes to the slide and selects the element (`store.goTo`, `store.select`), scrolling it into view.
5. **Fixes, only where safe and obvious**, each one undo step, each stating what it will do:
   - `text-overflow` → Fit box to text (existing behaviour); Shrink text to fit if F-03 landed.
   - `table-overflow` → Fit box to rows.
   - `broken-link` → Remove link.
   - `font-not-embedded` → open the font section.
   - Design choices (contrast, off-canvas bleed, overlap) get **no** automatic fix: jump only.
6. **When it runs.** On open, and re-run after each commit while the panel is open (debounced). Do not run measured checks on every keystroke when the panel is closed; the chip can update on save and on slide change.
7. **Replace from JSON** (and later any agent or assistant edit) opens the panel filtered to the findings the load introduced, instead of "see console". Coordinate with AI-14, which owns that dialog.
8. Accessibility: the panel is a labelled region, rows are buttons or options reachable by keyboard, and the count chip has an accessible name ("3 warnings, check deck").

## Acceptance criteria

- [ ] The table-overflow case above shows a non-zero chip and a row "Slide N · Table · rows run past the box" in the panel.
- [ ] Clicking a row selects that element on its slide.
- [ ] "Fit box to text" on a `text-overflow` row resolves the finding and is one undo step.
- [ ] A clean deck shows no chip; opening the panel says the deck has no issues.
- [ ] `info` findings (deliberate bleeds) are collapsed by default and never counted in the chip.
- [ ] Every finding code in `validate.ts` has a human sentence in all catalogs (a rig enumerates the codes and fails on a missing mapping).
- [ ] With the panel closed, typing in a text box triggers no validator run (assert with a counter in the rig).
- [ ] The panel is fully operable by keyboard and closes with Escape, returning focus to the opener.
- [ ] Read-only and present-only decks show findings without fix buttons.

## Tests

- `scripts/test-slides-check-deck.ts` (node): every code emitted by `validate.ts` has a label mapping.
- `scripts/test-slides-check-deck-browser.mjs` (headless Chromium, real input): chip count, panel rows, jump-to-element, the two fixes and undo, the no-run-while-closed counter, keyboard operation. Register the node rig in `validate-slides/action.yml` and the browser rig under `slides-editor-browser` in `ci-slides.yml`.

## Out of scope

- New findings (F-08, F-09) and the field-measurement fix (F-07): this issue only displays what `validate()` returns.
- An assistant explaining findings and proposing fixes (AS-09).
- Auto-growing tables as you type (DT-06).

## Notes for the implementer

- Order matters: land F-07 first. A panel that opens on the shipped starter with three false warnings teaches people to ignore it. It is much stronger after F-08 and F-09.
- Zone: slides app. No format change. Whether the panel was open is viewer state, never document state (the notes-pane decision recorded for upstream #976 sets that precedent).
- Byte cost: one panel plus about thirty short strings in eight catalogs. Report the shell delta; the maintainer weighs strings carefully (see "The slides shell diet" in `docs/DECISIONS.md`).
- Hot files: `slides/src/editor/editor.ts`, `slides/src/styles.css`, every i18n catalog. Use the kernel dialog primitive (`kernel/src/ui/dialog.ts`) if it is a sheet; do not hand-roll focus trapping.

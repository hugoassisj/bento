---
id: PK-03
title: "Slide long-press menu: Move up and Move down"
epic: 9-parked
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:touch", parked]
depends_on: []
related: [FH-11, F-05, PK-04, MP-16]
upstream: ["nyblnet/bento#20"]
---
## Summary

Reordering slides needs an HTML5 drag, which does not work reliably on touch and competes with the long-press that opens the slide menu. That menu offers New, Duplicate and Delete, and nothing to move a slide. Add "Move up" and "Move down" to it. It is the cheap answer to "I cannot reorder slides on my phone", and it also gives desktop users a non-drag way to reorder.

## What the user experiences

Five minutes before a talk, on a phone, they want slide 7 before slide 6. They open the slide drawer and try to drag a thumbnail: the list scrolls, or after half a second the context menu opens instead. The menu has New slide, Duplicate slide and Delete slide. There is no way to reorder without a mouse.

## Reproduce

Chromium emulation, iPhone 13 profile:

1. Open the Showcase deck and open the Slides drawer.
2. Long-press a thumbnail for about half a second: a menu opens with New slide, Duplicate slide, Delete slide.
3. Try to touch-drag a thumbnail to a new position: no reorder happens.

Desktop: right-click a thumbnail shows the same three items.

## Evidence

Observed in the running app (audit journey 4, emulated touch): the long-press menu's three rows; a touch drag to reorder slides on the iPad profile did nothing.

**Not verified on a real device.** HTML5 drag-and-drop from touch varies by browser; some mobile browsers do start a drag after a long press. Check on hardware.

Confirmed in code at `29b5c80`:

- The slide menu is `slideMenuItems` (`slides/src/editor/editor.ts:4469-4476`): New slide, Duplicate slide, a separator, Delete slide.
- The same function serves right-click and long-press: `openContextMenuAt` routes a thumbnail to it (`slides/src/editor/editor.ts:4195-4198`), and the long-press recogniser calls `openContextMenuAt` after `LONG_PRESS_MS = 500` (`slides/src/editor/editor.ts:99`, and the touch handlers at `slides/src/editor/editor.ts:4265-4296`).
- Reordering exists only as drag and drop: thumbnails are `draggable` (`slides/src/editor/editor.ts:2107`), and the drop is handled by `wireThumbDrop` → `dropSlides` (`slides/src/editor/editor.ts:2370-2399`, `:2410-2425`).
- The move itself is already a pure function that keeps a slide's states with it: `moveBlock(slides, selected, drop)` (`slides/src/editor/slidesel.ts:78-93`), with `expand` giving a parent plus its states (`slides/src/editor/slidesel.ts:48`). `dropSlides` shows the full pattern: one commit, current slide followed by id, thumbnail selection restored.
- There is no move command in the command list (see F-05).

Upstream issue #20 ("Horizontal Slide List on Mobile view") is the nearest request; this is the small part of it.

## How others do it

- **PowerPoint**: right-click a thumbnail ▸ Move Slide Up / Down is not present, but Ctrl+↑ / Ctrl+↓ moves it; mobile uses drag after long-press.
- **Keynote on iPhone**: touch and hold lifts the slide, then drag; the navigator is built for it.
- **Google Slides**: right-click ▸ Move slide ▸ to beginning / to end / up / down. This is the model to copy.

## Proposed change

`slides/src/editor/editor.ts` only; no format change.

1. Add one method, for example `moveSlides(indices: number[], dir: -1 | 1)`, that computes the drop index for "one unit earlier" or "one unit later" and calls the same code path as `dropSlides` (extract its body after payload parsing into a shared helper). A unit is a parent slide plus its states; moving past a neighbour means past that neighbour's whole unit.
2. In `slideMenuItems`, add "Move up" and "Move down" between Duplicate and the separator. Act on the thumbnail selection when the pressed thumbnail is part of it (as `thumbTargets` does for delete), otherwise on the pressed slide. Disable or omit the row at the top or bottom of the list.
3. A state slide's menu does not offer the rows (states are ordered under their parent; reordering states is a separate question).
4. If F-05 or FH-11 has landed the "Move slide earlier / later" commands, call those instead of adding a second implementation, and take the key hints from the command list.

Rejected: making HTML5 drag work on touch with a polyfill. It adds code for a parked area, and the menu rows also help keyboard and mouse users.

New strings: "Move up", "Move down" (check whether the layer-order rows already use these keys before adding new ones), through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] The slide menu (right-click and long-press) offers Move up and Move down.
- [ ] Move down on slide 3 of 5 makes it slide 4; its interactive states move with it and stay directly under it.
- [ ] Moving past a slide that has states places the moved slide after that slide's last state.
- [ ] With several thumbnails selected, the rows move the selection as a block, keeping its internal order.
- [ ] Each move is one undo step; the canvas stays on the same slide by id; the moved thumbnails stay selected.
- [ ] Move up is unavailable on the first unit and Move down on the last.
- [ ] Drag-and-drop reordering with a mouse behaves exactly as before.

## Tests

- Node rig: extend `scripts/test-slides-multiselect.ts` (it covers `slidesel.ts`; registered in `.github/actions/validate-slides/action.yml`) with the drop-index helper: single slide, slide with states, block selection, first and last positions.
- Browser rig: extend `scripts/test-slides-menus-ia-browser.mjs` to assert the slide menu's rows, and add a case that clicks Move down and asserts `window.bento.doc.slides.map(s => s.id)` plus one undo.

## Out of scope

- Touch drag reordering and a horizontal slide strip (PK-04, upstream #20).
- Keyboard focus on thumbnails and Move commands with shortcuts (FH-11, F-05). If those land first this issue shrinks to two menu rows.
- Sections (MP-16).

## Notes for the implementer

- Parked epic, but this one is small and benefits desktop too; fine to take alongside FH-11.
- Hot file: `slides/src/editor/editor.ts`.
- `scripts/test-slides-menus-ia-browser.mjs` pins the menus' contents; update it in the same change or CI fails.

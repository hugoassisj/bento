---
id: FH-11
title: "Slide list: keyboard focus; Move earlier and later"
epic: 8-first-hour
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:a11y", a11y]
depends_on: [F-05]
related: [FH-09, PK-03, MP-16]
upstream: []
---
## Summary

The slide list is the only large surface of the editor that cannot be reached or operated from the keyboard, and reordering slides is possible only with an HTML5 mouse drag. Make each thumbnail focusable with list semantics, and add Move earlier / Move later to the slide menu so reordering has a non-drag path (which also fixes reordering on touch).

## What the user experiences

- Tab never lands on a slide thumbnail. In a Tab walk from the canvas, focus goes panel toggle, inspector, top bar, and skips the whole left list.
- A screen reader announces nothing for the list: the thumbnails are plain `div`s with no role, name, position or selected state.
- The only way to reorder is to drag a thumbnail. There is no keyboard equivalent and no menu item. On a touch device the drag did nothing in the audit (iPad emulation), and the long-press menu offers only New, Duplicate, Delete.
- Right-clicking a thumbnail offers New slide, Duplicate slide, Delete slide. Nothing about order.
- With a slide current and nothing selected on the canvas, Ctrl/⌘+D does nothing.

## Reproduce

1. Open the app (`npm run dev`, http://localhost:5173). The Showcase deck loads.
2. Click an empty part of the canvas, then press Tab about 40 times. Focus never enters the slide list.
3. Right-click the thumbnail of slide 3. The menu has three items: New slide, Duplicate slide, Delete slide.
4. Try to move slide 3 before slide 2 without the mouse. There is no way.
5. Press Escape so nothing is selected, then Ctrl/⌘+D. Nothing happens.

## Evidence

Observed in the running app during the audit: the 40-press Tab walk from the canvas never visited a thumbnail; the slide context menu showed exactly three items (desktop right-click and phone long-press); a touch drag on a thumbnail in iPad emulation did not reorder.

Confirmed in code now:

- `slides/src/editor/editor.ts:2104-2161` `makeThumb` builds `div('ed-thumb')` with `dataset.index` and `draggable`, and no `tabIndex`, `role`, `aria-label`, `aria-selected` or `aria-current`. Selection is click-only (`item.addEventListener('click', …)` at 2145).
- `editor.ts:2342-2357` `wireThumbDrag` and `editor.ts:2370-2401` `wireThumbDrop`: reorder is HTML5 `dragstart` / `dragover` / `drop` only.
- `editor.ts:2410-2425` `dropSlides` is the one place a move is applied: it calls `moveBlock` (`slides/src/editor/slidesel.ts:78`) and commits. A menu or key path should reuse exactly this.
- `editor.ts:4469-4476` `slideMenuItems` returns New slide, Duplicate slide, a separator, Delete slide.
- `editor.ts:4090-4092` `duplicateSelection` returns early when nothing is selected.
- Arrow keys and PageUp/PageDown already walk slides when the canvas is free (`editor.ts:3833-3834`, `3948`), so navigation exists; focus and reordering do not.
- The pattern to copy is the Layers panel: `slides/src/editor/layers.ts:58-59` (`tabIndex = 0`, `role="listbox"`), rows `role="option"` with `aria-selected` (`layers.ts:181`, `213-214`).

Not verified: behaviour with a real screen reader. The claims above are from the DOM, not from VoiceOver or NVDA.

## How others do it

- PowerPoint: the thumbnail pane takes focus (F6 cycles panes), arrows move between slides, Ctrl+Up / Ctrl+Down move the slide, Ctrl+Shift+Up / Down move it to the start or end, and the right-click menu has the same.
- Keynote: the slide navigator is a focusable list; the Arrange menu has move commands, and Tab / Shift+Tab indent slides into groups.
- Figma Slides: the slide strip is keyboard navigable and slides reorder from the grid view.
- Penpot: the pages list is a focusable list with a context menu.

## Proposed change

1. `makeThumb` (`editor.ts`): give the list container (`this.thumbs`) `role="listbox"`, `aria-label` (Slides), `aria-multiselectable="true"`; give each thumbnail `role="option"`, a roving `tabIndex` (0 on the current slide, -1 on the rest), `aria-selected` mirroring `thumbSel` and the current slide, and an `aria-label` built from the visible number plus the slide's first text or its `name` ("Slide 3: Software with nothing to install", "Variant of slide 8", "Slide 5, hidden").
2. Keyboard on the focused list: Up/Down move focus and go to that slide (reuse `store.goTo`), Home/End, Shift+Up/Down extend the selection (reuse `selRange`), Enter or F2 does nothing new, Delete/Backspace runs the delete-slide command, Shift+F10 / ContextMenu key opens `slideMenuItems` at the thumbnail.
3. Move: add `Move earlier` and `Move later` to `slideMenuItems`, implemented by calling the same `moveBlock` + commit path `dropSlides` uses, with the same "states travel with their parent" rule. Bind Alt+Up / Alt+Down on the focused list (check `slides/src/editor/shortcuts.ts` for collisions first). Disable at the ends.
4. Update `highlightSidebar` (`editor.ts:2427`) to keep `tabIndex` and `aria-selected` in step with the current slide and selection, and keep focus on the moved slide after a move (the sidebar is rebuilt on a `'slides'` commit, so restore focus by slide id).
5. The commands themselves (new, duplicate, delete, move, hide slide as palette entries with shortcuts) are **F-05**. This issue consumes them; if F-05 has not landed, call the existing private methods and leave the palette alone.

New strings (all catalogs): "Slides" (list label, may exist), "Move earlier", "Move later", the three aria-label templates.

Rejected: making thumbnails `<button>`s. They contain buttons (the hover tools at `editor.ts:2139-2143`), and nested interactive content is invalid.

## Acceptance criteria

- [ ] Tab from the canvas reaches the slide list in one stop; focus is visibly indicated on the current thumbnail and the indicator survives forced-colors (see FH-17).
- [ ] Up/Down/Home/End move focus and the current slide; the canvas shows the focused slide.
- [ ] Each thumbnail exposes `role="option"`, an accessible name with its number, and `aria-selected`; the container exposes `role="listbox"`.
- [ ] The slide menu contains Move earlier and Move later; each moves the slide (with its state slides) by one unit and is disabled at the ends.
- [ ] Alt+Up / Alt+Down on the focused list do the same, and focus stays on the moved slide.
- [ ] A move is one undo step and produces the same document as dragging to the same place.
- [ ] Shift+F10 on a focused thumbnail opens the slide menu at that thumbnail.
- [ ] Mouse behaviour is unchanged: click, Shift-click, Ctrl/⌘-click, drag reorder, hover tools.

## Tests

- Add `scripts/test-slides-slide-list-keys-browser.mjs` (headless Chromium, trusted keyboard input): Tab reaches the list; arrow keys change `window.bento.doc` current slide; Alt+Down changes slide order and `window.bento.undo()` restores it; roles and `aria-selected` are present; the menu contains the two new rows. Register it in the `slides-editor-browser` job in `.github/workflows/ci-slides.yml`.
- Extend `scripts/test-slides-multiselect.ts` (it already covers `slidesel.ts`) with a case proving a one-step move through `moveBlock` equals the drag result, including a parent with states.

## Out of scope

- The slide commands and their shortcuts in the palette (F-05).
- Sections in the slide list (MP-16).
- The phone long-press menu specifics (PK-03 reuses the same two rows).
- A slide-sorter grid view.

## Notes for the implementer

- Zone: slides app. Hot file: `slides/src/editor/editor.ts` (expect conflicts with F-05, FH-09 and anything touching the sidebar); also `styles.css`, the i18n catalogs and `CHANGELOG.md`.
- The sidebar rebuilds (`rebuildSidebar`) on structural commits and patches surfaces in `scheduleThumbs` (`editor.ts:2451`); set the ARIA attributes in both paths or in `highlightSidebar`, which runs after each.
- The global key handler treats several keys as canvas shortcuts; make sure keys handled by the focused list do not also fire canvas commands (`scope` in `commands.ts`).
- Upstream issue #20 (horizontal slide list on phones) and discussion #583 (sections) both touch this list; keep the change additive so they can build on it.

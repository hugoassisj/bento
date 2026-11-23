---
id: DS-10
title: "Worded Arrange menu and Tidy up"
epic: 5-design-system
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-01, DS-09, F-05, F-06]
upstream: []
---
## Summary

Align, distribute and match-size exist, but only as up to thirteen unlabelled icons at the top of the Format tab and as ⌥-letter shortcuts. There is no worded menu anywhere, the context menu has none of them, match-size is not even a command, and there is nothing like "just tidy these up". Add a worded Arrange menu and a Tidy up action.

## What the user experiences

A PowerPoint user right-clicks three boxes looking for Align or Distribute. The menu offers Cut, Copy, Lock, Group, Add auto layout. They open ⌘K and type "distribute" or "line up" or "same size": "No matching command". The tools they want are the small icons under the selection's name, identified only by hovering each one.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173, draw three rectangles.
2. Select all three. Format tab: a row of icons with no text.
3. Right-click the selection: no Align, Distribute or size entries.
4. ⌘K (Ctrl+K), type `same size`: "No matching command". Type `distribute`: no match (the command is labelled "Space evenly across").

## Evidence

- **Seen in the running app (design-features journey):** 13 unlabelled icons; ⌘K misses for "distribute", "tidy", "same size", "line up", screenshot `27-cmdk-line_up.png`. A single element does align to the slide.
- **Confirmed in code now:**
  - `slides/src/editor/inspector/arrange.ts:106-121`: six align buttons, two distribute buttons (three or more), two match-size buttons (two or more), all `iconBtn` with a `title` only. The comment at `:64-65` records that unusable controls are left out, not greyed.
  - `slides/src/editor/editor.ts` command list (near `:3797-3803`): `align-left` … `align-bottom` (⌥A/H/D/W/V/S), `distribute-x` and `distribute-y` (⌃⌥H / ⌃⌥V) labelled "Space evenly across / down". There is **no** command for match width or height (`matchSize`, `arrange.ts:328`, is called only from the two buttons).
  - `editor.ts` `elementMenuItems` (near `:4404-4445`): Edit text, Rename, Cut, Copy, Duplicate, Lock, Bring to front, Send to back, Group, Add auto layout, component items, boolean items. No arrange items.
  - `slides/src/editor/ctxmenu.ts:13-28`: `CtxItem` is a separator or a flat row. There is no submenu type.
  - `arrange.ts:343-345` (`align`): a single element aligns to the slide; a multi-selection aligns to its own bounds.

## How others do it

- **PowerPoint:** Arrange ▸ Align ▸ Align Left … Distribute Horizontally, Distribute Vertically, **Align to Slide** / Align Selected Objects, all in words with icons.
- **Keynote:** Arrange ▸ Align Objects ▸ Left …; Distribute Objects ▸ Evenly.
- **Figma:** Tidy Up arranges a selection into an even row, column or grid in place; Smart Selection then lets you drag the spacing.
- **Penpot:** worded Align and Distribute entries in the context menu.

## Proposed change

1. **Commands for everything in the row.** Add `match-width` ("Same width") and `match-height` ("Same height") to the command list, and relabel `distribute-x` / `distribute-y` to "Distribute horizontally / vertically" (the palette label; keep the tooltip text if preferred). Add `align-to-slide-*` only if a multi-selection should be able to align to the slide; otherwise leave as is.
2. **Submenus in the context menu.** Extend `CtxItem` with an optional `items?: CtxItem[]` that renders a row with a chevron and opens a nested list on hover, focus + Right arrow, or click; Left arrow or Escape closes it. Keep the singleton behaviour described in `ctxmenu.ts`'s header.
3. **Arrange ▸ in `elementMenuItems`:** Align left, centre, right, top, middle, bottom; Distribute horizontally, vertically; Same width, Same height; Tidy up; then, separated, Equal columns / Equal rows / Grid (the DS-01 presets). Each row shows its icon, its words and its shortcut (`this.keysOf(id)`), and carries `cmd`. Rows that need more elements than are selected are disabled, not hidden, so the menu teaches what exists. For a frame's children, show the existing explanation ("Placed by its frame") as a disabled first row with "Select the frame".
4. **Tidy up** (`tidy-up`, new command, two or more free elements): arrange in place without creating a frame.
   - Detect the arrangement: if the elements' centres vary more along x than y it is a row; the reverse is a column; if they cluster into several rows and columns it is a grid.
   - Row or column: align on the cross axis to the first element's edge and make gaps equal to the median existing gap (reuse `spacing()` from `inspector/layout.ts:200` and `distribute`).
   - Grid: snap to the detected rows and columns with equal gaps.
   - One undo step. Follow with a toast: "Tidied. Keep it tidy?" with the action **Use auto layout**, which runs ⇧A on the same selection.
5. The Format tab's icon row is unchanged, but each button's tooltip and the palette label must be the same words as the menu.

New strings (all eight catalogs): Arrange, Same width, Same height, Distribute horizontally, Distribute vertically, Tidy up, the toast and its action.

No format change.

## Acceptance criteria

- [ ] Right-clicking a selection shows an Arrange submenu with every align, distribute and size action in words, each with icon and shortcut.
- [ ] The submenu opens and closes with mouse and keyboard (Right / Left / Escape), and its rows are announced as menu items.
- [ ] Rows that cannot apply are disabled, and say why in their title.
- [ ] ⌘K finds "Same width", "Same height", "Distribute horizontally", "Tidy up".
- [ ] Tidy up on three roughly aligned rectangles yields equal gaps (within 1px) and a common top edge, in one undo step, with no frame created.
- [ ] Tidy up on a 2×3 scatter yields a 2×3 grid with equal row and column gaps.
- [ ] The toast's "Use auto layout" wraps the same elements exactly as ⇧A would.
- [ ] Elements placed by a frame are never moved by Tidy up.

## Tests

- Node: a pure test for the arrangement detector and the tidy geometry (`scripts/test-slides-tidy.ts`): given boxes, expect boxes. Register at the end of the slides slice in `.github/actions/validate-slides/action.yml`.
- Browser: extend `scripts/test-slides-menus-ia-browser.mjs` (menus) for the Arrange submenu (open with a right-click `MouseEvent`, walk with the keyboard, run a row, assert on `window.bento.doc`), and `scripts/test-slides-command-palette-browser.mjs` for the new palette entries.

## Out of scope

- Synonyms in ⌘K ("line up", "even out"): F-06.
- The auto layout presets themselves: DS-01.
- A fixed position for contextual toolbar buttons: DS-09.

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/ctxmenu.ts`, `slides/src/editor/editor.ts` (command list, `elementMenuItems`), `slides/src/editor/inspector/arrange.ts`, the eight i18n catalogs, `CHANGELOG.md`.
- Keys are commands: declare each action once in the command list so the shortcut sheet, tooltips, menu hints and palette agree (`slides/src/editor/commands.ts` header).
- `docs/DECISIONS.md` records the choice to leave unusable arrange buttons out of the icon row; the menu can disable instead of hide because a menu is where people look for what exists. Say so in the PR.
- Submenus add a menu behaviour that other menus (File, Save, Help) do not have; keep it inside `ctxmenu.ts` and do not touch the topbar dropdowns here (FH-09 owns their keyboard handling).

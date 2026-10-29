# Issue 1 (bug, PR ready) — slides: shift-click cannot add an element that sits inside the current selection's box

**Shipped:** bento.page/slides, current release. Chrome, macOS.

**Steps** (showcase deck, slide 1):
1. Click `ADVANCE`, then Shift-click `SPEAKER VIEW`. Two selected.
2. Shift-click `EDIT`, which sits between them.

**Expected:** three selected. **Actual:** nothing changes. Shift-clicking `ADVANCE` again doesn't deselect it either.

**Cause:** once 2+ elements are selected, Moveable draws `.moveable-area` over their whole bounding box. The press lands on it (`elementFromPoint` → `div.moveable-area`), and Selecto's `dragStart` stops for `isMoveableElement(target)`. So the toggle never runs. It isn't a count limit; it only looks like "max 3" because the box grows with every pick and covers the rest.

**Fix (PR):** when Selecto hands a *Shift* press to Moveable, toggle on Moveable's `click` / `clickGroup` (these fire only for a press that did not become a drag), using the existing `topElementAt` painted-stack lookup and `expandGroups`. Shift-drag stays an axis-locked move.

**Verified:** a harness running moveable@0.53.0 + selecto@1.26.3 with the same config and wiring:

| step | before | after |
|---|---|---|
| Shift-click inside the group box | unchanged | added |
| Shift-click a selected element | unchanged | removed |
| Shift-drag the selection | moves, axis-locked | moves, axis-locked, selection unchanged |

Real-mouse QA in the built app is still to be done (see CONTRIBUTING).

---

# Issue 2 (proposal) — slides: picking an element under other elements needs Figma's modifiers, and they need to be discoverable

Alt-click deep select already exists (`canvas.ts` `deepSelect`), but:

1. **Nobody can find it.** It isn't mentioned in any hint, tooltip or the `?` sheet.
2. **It hit-tests model boxes, not what is painted.** `topElementAt`'s own comment explains why that's wrong ("decorative full-bleed elements overlap smaller ones in model space while sitting behind or beside them on screen"). Model boxes also ignore rotation.
3. **No list of what's under the cursor.** Cycling works for 2 layers, but not for 6.

Proposal, matching Figma / Penpot:
- **⌘/Ctrl-click** selects the deepest element directly under the pointer, inside groups. This is the Figma convention. Today ⌘ only means duplicate-*drag*, and a still click doesn't conflict with that. Alt-click keeps cycling.
- **Right-click → "Select layer ▸"** lists every element painted under the pointer, top first, and hovering an entry outlines it on the canvas. This reuses `ctxmenu.ts`.
- `deepSelect` walks `document.elementsFromPoint`, like `topElementAt`, instead of comparing model boxes.
- Hover outline (a thin 1px ring) on the element a click *would* select, including while ⌘ is held.

Asking before building, per CONTRIBUTING.

---

# Issue 3 (proposal) — slides: the inspector uses dropdowns where one click would do, overflows its column, and hints are titles only

Measured on the showcase deck, text element selected, 236px panel:

- **15 `<select>`s** for a single text element. Text alignment (left/centre/right) and vertical alignment are dropdowns: two clicks and a read, where Figma, Penpot and Keynote use a 3-icon segmented control (one click, state visible at rest).
- **4 selects truncate their own value**: `Instrument Sans (embedded)`, `Inserir campo…`, `esmaecer para cima`, `(escolha um elemento)`.
- **The panel overflows horizontally by 75px**: the bullets row's `Aumentar recuo` button is clipped off the right edge.
- **Labels collide**: in a multi-selection, `REVELAR` runs into its options (`REVELAREm ordem Juntos Remover`).
- **6 font sizes** in one panel (9, 11, 11.5, 12, 12.5, 13px). Hierarchy comes from size noise rather than from grouping and weight.
- **A 10-line help paragraph** opens the Typography section, above the controls it describes.
- **13 number fields with no scrubbing.** Design tools let you drag the label (X, W, size…) to change the value, and Shift-drag ×10. `panels.ts number(value, step, onEdit(v, final))` already separates live preview from commit, so a scrub can preview while dragging and commit one undo step on release.
- **Hints:** icon-only buttons rely on native `title` (slow, unstyled, no shortcut). Theme swatches are titled with internal token names (`bg1`, `tx1`).

Proposed rules (each one small enough to be a lint or a test, in the spirit of #729's "one field look"):
1. **≤ 5 mutually exclusive options that have an icon → segmented control, not `<select>`.** Selects stay for open lists (fonts, slides, effects).
2. **Every numeric field's label is a scrub handle** (`ew-resize` cursor; Shift ×10, Alt ×0.1; commits once).
3. **Nothing in the inspector is wider than its column**: a test asserts `scrollWidth === clientWidth` with each element type selected.
4. **Every icon-only control has a hint that names the action and its shortcut** (`Align left  ⌘⇧L`), shown after a short delay through one shared tooltip, and with `aria-label` set from the same string. A test fails on an icon-only button with no label.
5. **Type scale: three sizes** (section label, field label, value).
6. **Help text lives behind a `?` affordance or below the controls**, never above them.

Happy to split this into one PR per rule once the direction is agreed.

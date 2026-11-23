---
id: DS-03
title: "Frames adopt what is drawn or dropped onto them"
epic: 5-design-system
type: enhancement
priority: P1
size: S
evidence: mixed
labels: [enhancement, "priority:P1", "size:S", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-01, DS-02, FH-07]
upstream: []
---
## Summary

A shape drawn inside an auto-layout frame joins the frame only if the frame itself is the selection when the tool is armed. Draw a second shape (the first child is now selected) and it lands on top of the frame, looking as if it were inside, but outside the layout. An empty frame gives no hint that it wants content.

## What the user experiences

They press F and draw a frame, press R and draw a card inside: it snaps into place. They press R again and draw another card beside it: it floats, overlaps the first, and does not line up. Nothing explains the difference. The Layers list shows the second rectangle outside the frame.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173, go to an empty slide.
2. Press **F**, drag a box about 600×300. The frame is selected.
3. Press **R**, drag a small box inside the frame. It becomes a child (`parentId` set) and is now the selection.
4. Press **R** again, drag another small box inside the frame.

Observed: the second rectangle has no `parentId`; it sits above the frame at the drawn position. `window.bento.doc.slides[i].elements` confirms it.
Expected: anything drawn with its start point inside a frame joins that frame.

## Evidence

- **Seen in the running app (design-features journey):** steps above; screenshot `11-third-rect.png` in the audit.
- **Confirmed in code now:**
  - `slides/src/editor/editor.ts:4084-4088` (`placeTool`): the target frame is passed only when the selection is exactly one element and that element has `layout`:
    `const f = sel.length === 1 && sel[0].type === 'shape' && sel[0].layout ? sel[0] : null`.
  - `slides/src/editor/canvas.ts` `armPlace(make, edit, into?)` (`:2888`): on mouse-up it tests the start point against that one frame only (`inF`), and sets `el.parentId = f.id` (`:2930`).
  - Dragging an **existing** element into a frame already hit-tests every frame: `canvas.ts:708` filters frames by `isFrame(f) && !f.hidden && ... inside(f) && canAccept(slide, ids, f.id)`, and `:785` calls `moveIntoFrame`. So the drop path is right and the draw path is the odd one out.
  - `editor.ts:4074-4079` (`newFrame`) creates a white frame with a grey stroke and no hint.

## How others do it

- **Figma:** anything drawn or dropped over a frame becomes its child; holding Space while dragging prevents nesting.
- **Penpot:** a shape created over a board or a flex/grid layout container is added to it; the container highlights while you draw.
- **PowerPoint:** content placeholders say "Click to add" and accept whatever is inserted.

## Proposed change

1. **Hit-test at the start of the gesture.** In `armPlace`, when `into` is not given, find the target frame from the start point `a`: the deepest unlocked, visible frame whose box contains `a` (reuse the predicate at `canvas.ts:708`; with a new element there are no moving ids, so `canAccept` reduces to "is an unlocked frame"). Keep the explicit `into` path as the first choice so today's behaviour is unchanged.
2. **A selected child implies its frame.** In `placeTool`, when the single selection has a `parentId` naming a frame, pass that frame as `into`.
3. **Show the target while drawing.** On `mousemove` in `armPlace`, tint the frame under the start point using the same highlight the drag path uses for a drop target (the `ed-slot-bar` insertion indicator built at `canvas.ts:760-762`, or a tint on the frame itself), so the user sees what will adopt the shape before releasing.
4. **Opt out.** Holding Alt at mouse-down draws on top without nesting (mirror of Figma's Space). Show it in the tool's tooltip.
5. **Empty-frame hint.** While a frame has no children, the editor canvas (not the model, not the show, not thumbnails) paints "Draw or drop here" centred in it, dimmed. Implement as an editor overlay alongside `slides/src/editor/frameoverlay.ts`, never as a text element.
6. Apply the same rule to the other insert paths that create an element at a point: the Text tool (already goes through `placeTool`), image insert and paste-at-pointer if they pass a point.

New strings (all eight catalogs): the empty-frame hint; the tooltip suffix for the Alt opt-out.

Old-shell behaviour: none; this only changes which elements get `parentId`, an existing key.

## Acceptance criteria

- [ ] F, R (inside), R (inside) yields a frame with two children; both have `parentId` and are laid out by the frame.
- [ ] Drawing with the start point outside every frame creates a free element, as today.
- [ ] With nested frames, the innermost frame under the start point adopts the element.
- [ ] A locked or hidden frame never adopts.
- [ ] Holding Alt at mouse-down creates a free element even inside a frame.
- [ ] While drawing over a frame, the frame shows the drop-target highlight; it clears on mouse-up and on Escape.
- [ ] An empty frame shows the hint in the editor; the hint is absent from thumbnails, present mode, print and `window.bento.doc`.
- [ ] One undo step removes the drawn element and restores the previous layout.

## Tests

Extend `scripts/test-slides-frames-browser.mjs` (frames) or `scripts/test-slides-frame-drop-browser.mjs` (adoption): drive F / R / R with `MouseEvent`s on the canvas, wait a frame after each selection change, then assert on `window.bento.doc`: both rectangles carry the frame's id as `parentId`, and their boxes (via `getBoundingClientRect`) do not overlap. Add the Alt and the nested-frame cases. The two-children assertion fails on the parent commit. Both rigs are already registered in `.github/workflows/ci-slides.yml`.

## Out of scope

- Adopting into a plain (non-layout) rectangle. Only frames adopt.
- Image placeholders (FH-07).

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/canvas.ts` (`armPlace`), `slides/src/editor/editor.ts` (`placeTool`), `slides/src/editor/frameoverlay.ts`.
- Frame order is the children's current coordinate (`slides/src/layout.ts:15-17`); `armPlace` leaves the default position for an adopted element so the frame decides the slot. Keep that.
- The derive pass must stay a fixed point: run `node scripts/test-slides-layout.ts` and `node scripts/test-slides-derive.ts`.

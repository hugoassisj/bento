---
id: DS-04
title: "Library tab: components with thumbnails, search, drag to place"
epic: 5-design-system
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-03, DS-07, DS-13, SC-04, F-05]
upstream: []
---
## Summary

Components are the answer to "make this card once and reuse it", but they live at the bottom of the icon-only Tokens tab, under every token row, as a list of truncated names with an Insert button. There is no picture, no search, and dragging a row onto the slide does nothing. Give them their own Library view with thumbnails that can be dragged to the canvas.

## What the user experiences

After Create component, the app switches to the Tokens tab and flashes a row. To reuse the component on another slide the user must remember it lives under "Tokens", scroll past about 25 rows, recognise it by a name cut to "Compone…", and press Insert, which drops it at the centre of the slide. Main and copy are told apart only by ◆ and ◇ in the Layers list.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 (starter deck).
2. Left panel ▸ third tab. Scroll to the bottom: a "Components" heading with name rows and **Insert** buttons.
3. Try to drag a row onto the canvas. Nothing happens.
4. Press Insert: a copy appears centred on the slide (offset if something is already there).

## Evidence

- **Seen in the running app (design-features journey):** screenshot `13-component-created.png`; names truncated; drag does nothing; editing a copy's text takes three clicks.
- **Confirmed in code now:**
  - `slides/src/editor/tokenspane.ts:592-632` (`componentsSection`): rows are a ◆ mark, an editable name and an Insert button; no thumbnail, no `draggable`, no search.
  - `tokenspane.ts:648-660` (`insertCopy`): placement is the slide centre, stepped by 32px while it overlaps, via `instanceOf` (`slides/src/components.ts:162`).
  - `slides/src/editor/editor.ts:2171-2187` (`sideTabs`): the left panel has exactly three views, `slides`, `layers`, `tokens`.
  - `editor.ts:3814`: the only palette entry is "Show tokens and components".
  - `slides/src/components.ts:42` (`components(doc)`) lists every component by its main; `:65` (`mainSig`) is a hash of a main's content.

## How others do it

- **Figma:** the Assets panel shows components as thumbnails with search; drag onto the canvas to place; Shift+I opens a quick inserter.
- **Penpot:** the Assets tab lists components with previews, grouped, draggable.
- **PowerPoint:** the Slide Master and Reuse Slides panes show pictures, never names alone.
- **Keynote:** shapes library with search and drag.

## Proposed change

1. **A fourth left-panel view, "Library".** Add `library` to `sideTabs` (`editor.ts:2179`) with its own icon; `tokens-show` stays, and a new `library-show` command is added. Create component (`createComponent`, `editor.ts:2960`) switches to Library instead of Tokens, and its toast ("Made {name} — rename it in its header; insert copies from Tokens", `:2974`) is reworded to name the Library (a changed string: update all eight catalogs). The Tokens view loses its Components section.
2. **Thumbnail grid.** One tile per component: render the main's elements with `renderElement` (`slides/src/render.ts:695`) into a box scaled to fit (the way slide thumbnails are scaled), on the main slide's background. Cache the rendered node per component keyed by `mainSig` so a doc event only re-renders tiles whose main changed. Name under the tile, editable in place (reuse `editing`).
3. **Search.** A field above the grid filters by name (case-insensitive substring); arrow keys move through tiles (a `listbox`, like Layers).
4. **Drag to place.** Mouse-down on a tile starts a drag ghost; on mouse-up over the canvas, call `instanceOf` with the pointer position as the copy's top-left centre, in one commit. If the drop point is inside a frame, adopt the copy into it with the same hit-test as DS-03 (`moveIntoFrame`, `slides/src/layout.ts:38`). Click or Enter still inserts at the centre.
5. **Tile menu:** Go to main, Rename, Insert, Delete (with the existing confirmation path in `deleteSelection`).
6. **Empty state:** "Select something and choose Create component to reuse it." with the shortcut.
7. **⌘K:** `library-show`, plus "Insert component…" which opens the Library with the search field focused. (Per-component palette entries would need dynamic commands; leave that to F-05.)

New strings (all eight catalogs): Library, Search components, the empty state, Insert component…, Go to main (exists as a command label), tile menu items not already present.

No format change. Old shells are unaffected.

## Acceptance criteria

- [ ] The left panel has a Library view; components appear as picture tiles that visibly match the main.
- [ ] Editing the main updates its tile within one doc event; unrelated tiles are not re-rendered (assert by node identity).
- [ ] Typing in the search field filters tiles; clearing restores all.
- [ ] Dragging a tile onto the slide places a copy at the drop point in one undo step; dropping inside a frame makes it a child of that frame.
- [ ] Click or Enter on a tile inserts a copy at the centre, as Insert does today.
- [ ] Create component switches to Library and highlights the new tile.
- [ ] Tiles are reachable and operable by keyboard; each has an accessible name.
- [ ] A deck with 50 components opens the Library without a visible stall (render lazily; measure).
- [ ] The Tokens view no longer lists components.

## Tests

Extend `scripts/test-slides-components-browser.mjs` or add `scripts/test-slides-library-browser.mjs`:
- create a component with real input, assert a tile exists and contains rendered child nodes;
- drag the tile to a point on the canvas with `MouseEvent`s, assert a copy exists in `window.bento.doc` whose bounding box contains that point;
- change the main's fill, assert the tile's rendered fill changed and another tile's node identity did not.
Register a new rig in `.github/workflows/ci-slides.yml` (`slides-editor-browser` job).

## Out of scope

- Variants, properties and swap (DS-13).
- Sharing a library between decks.
- Thumbnails for tokens.

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/editor.ts` (`sideTabs`, command list, `createComponent`), `slides/src/editor/tokenspane.ts` (remove the section, keep `showComponent`'s behaviour in the new view), `slides/src/styles.css`, the eight i18n catalogs, `CHANGELOG.md`.
- `fitTabNames` sizes the icon tabs; check four tabs still fit at the narrowest panel width.
- Rendered component content comes from the document: it must go through the same renderer (which sanitizes) and never be injected as raw HTML.
- Record the byte cost. A new view with a grid is likely 2–4 KB compressed; say what it bought.
- The main/copy model and its known ceiling (a main and its copy both edited before a derive pass) are recorded at `docs/DECISIONS.md:12163-12171`.

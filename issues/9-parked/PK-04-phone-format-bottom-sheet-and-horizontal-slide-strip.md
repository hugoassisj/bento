---
id: PK-04
title: "Phone: Format as a bottom sheet; horizontal slide strip"
epic: 9-parked
type: enhancement
priority: P3
size: L
evidence: mixed
labels: [enhancement, "priority:P3", "size:L", "evidence:mixed", "area:touch", parked]
depends_on: [PK-02, PK-03]
related: [PK-01, FH-15, FH-11, MP-16]
upstream: ["nyblnet/bento#20"]
---
## Summary

Phones and small tablets get the desktop inspector and the desktop slide list as side drawers. The Format drawer covers about two thirds of the slide, including the element being edited; the slide list is a drawer that closes when you pick a slide; resize handles are 8 px. In iPad portrait both panels stay open and the slide is smaller than on a phone. Upstream issue #20 asks for a horizontal slide strip on mobile. This issue records the larger redesign: Format as a half-height bottom sheet, and a horizontal slide strip. It is parked; it is here so the analysis is not lost.

## What the user experiences

- They select a title on a phone and open Format to change its colour. The drawer slides over the slide and hides the title they are recolouring. They close the drawer to see the result, then reopen it for the next change.
- They want to hop between slides. Each hop is: open the drawer, scroll, tap a thumbnail, and the drawer closes.
- On an iPad held upright, both side panels are open and the slide between them is 264 px wide, with 36×30 px targets.
- Resize handles are too small to hit with a finger.

## Reproduce

Chromium emulation:

1. iPhone 13 profile, Showcase deck. Tap the title, then open the Format panel (swipe the top bar first; see PK-02). The drawer covers roughly the right two thirds of the screen, over the selected element.
2. Open the Slides drawer, tap a thumbnail: the drawer closes.
3. iPad Pro 11 profile in portrait: both panels are open; measure the slide's rendered width (about 264 px).
4. Select an element and try to grab a corner handle by touch.

## Evidence

Observed in the running app (audit journey 4, emulated touch): the Format drawer over two thirds of the slide; 8×8 px handles; in iPad portrait both panels open, slide 264 px wide, 36×30 px targets.

**Not verified on a real device.** There is no on-screen keyboard in emulation, so how text editing interacts with a bottom sheet and the keyboard is unknown; the editor makes no use of `visualViewport`.

Confirmed in code at `29b5c80`:

- Under 700 px the two panels become absolutely positioned overlay drawers (`slides/src/styles.css:2627-2640`, in the `max-width: 700px` block that starts at 2593). The comment explains why they stopped being flex siblings: "the thing you are editing became the smallest thing on screen".
- The drawer state is `panelsAreDrawers` (`slides/src/editor/editor.ts:1071`); picking a slide closes the left drawer (`slides/src/editor/editor.ts:2158`).
- Thumbnail width is derived from the sidebar's width: `Math.max(96, this.panelW.left - 52)` (`slides/src/editor/editor.ts:2132-2133`).
- The slide drop maths is vertical only: the drop index is found by comparing `ev.clientY` against each thumbnail's rectangle (`slides/src/editor/editor.ts:2371-2382`).
- The sidebar also hosts the Slides / Layers / Tokens tabs (`sideTabs`, `slides/src/editor/editor.ts:2170`), so a strip cannot simply be the sidebar turned sideways.
- The 700 px rule applies by width only, so an iPad in portrait (834 px) gets the desktop layout with both panels open.

Upstream issue #20 (opened July 2026, labelled enhancement, listed as unowned in the pinned "What's in flight" issue).

## How others do it

- **Keynote on iPhone**: Format is a half-height bottom sheet with Style / Text / Arrange tabs; the slide stays visible above it and updates live. The slide navigator is a vertical strip that stays open in landscape and a pop-over in portrait.
- **Google Slides mobile**: a horizontal filmstrip along the bottom; formatting in a bottom sheet.
- **Canva mobile**: a bottom toolbar of contextual actions that expands into a sheet; pages as a horizontal strip.

## Proposed change

Slides app only; no format change. Three parts, in this order.

### 1. Auto-collapse on touch tablets (smallest)

On a touch device up to about 900 px wide, start with both panels collapsed and open them as overlays, as phones do. See FH-15 for the same idea on narrow desktop windows; share the breakpoint logic.

### 2. Format as a bottom sheet (≤ 700 px)

- The right panel becomes a sheet anchored to the bottom, half the viewport high by default, draggable to a peek height and to full height, with the Format / Animate / Interact tabs as its header.
- The canvas area shrinks to the space above the sheet and re-fits the slide, so the selected element stays visible while its properties change.
- Enlarge hit areas of resize and rotate handles to at least 28 px on touch without changing how they look.
- When the on-screen keyboard is up, use `visualViewport` to keep the focused field and the edited text in view.

### 3. Horizontal slide strip (≤ 700 px), upstream #20

The six-step plan from the code audit:

1. A strip layout in the phone media block: the thumbnail list becomes a horizontal row with `overflow-x` and scroll snapping.
2. Thumbnail size from the strip's height, not the sidebar's width (`editor.ts:2132`).
3. The insert gaps between thumbnails turn horizontal.
4. The drop maths in `wireThumbDrop` becomes axis-aware (`editor.ts:2371-2382` uses `clientY` only).
5. The strip lives outside the sidebar (which keeps Layers and Tokens), for example in the centre column beside the notes pane.
6. State slides render nested and smaller, as now.

Ship it together with PK-03's Move up / Move down, because drag reorder is weak on touch.

Rejected for now: a separate mobile build. One file is the product.

## Acceptance criteria

- [ ] On a 390 px viewport with an element selected and Format open, the selected element is fully visible above the sheet.
- [ ] Changing a property in the sheet updates the slide without closing the sheet.
- [ ] The sheet can be dragged between peek, half and full heights, and closed.
- [ ] A horizontal slide strip shows the deck, scrolls sideways, marks the current slide, and picking a slide does not hide the strip.
- [ ] Slides can be reordered from the strip (menu rows at minimum).
- [ ] On an 834 px wide touch viewport both panels start collapsed and the slide is wider than 500 px.
- [ ] Resize handles have a touch hit area of at least 28 px.
- [ ] At widths above the breakpoints, with a mouse, the layout is unchanged.
- [ ] Verified on a real phone and a real tablet, named in the change description.

## Tests

- Browser rigs at phone and tablet viewports with `hasTouch: true`: element visibility above the sheet (`getBoundingClientRect` against the sheet's top), strip scroll and selection, panel state on load at 834 px. Register in `.github/workflows/ci-slides.yml`.
- Keep `scripts/test-slides-share-pop-phone-browser.mjs`, `scripts/test-slides-topbar-browser.mjs` and `scripts/test-slides-notes-pane-browser.mjs` green; they pin the current phone chrome and the centre column.

## Out of scope

- Touch move safety (PK-01), the top bar (PK-02), the menu rows (PK-03): each is its own small issue and comes first.
- Present mode on touch (MP-19).
- A native app; the hosts in `home/` are the maintainer's.

## Notes for the implementer

- Parked: the owner ranked phone editing low priority on 2026-11-23. Do not start this without that changing.
- Split it into three changes (the three parts above) if it is ever taken.
- Hot files: `slides/src/styles.css`, `slides/src/editor/editor.ts`, `slides/src/editor/panels.ts`, `slides/src/editor/canvas.ts`.
- The README states the current position plainly: "editing is desktop-first (phones view and present well)". A redesign changes that sentence; raise it upstream first.

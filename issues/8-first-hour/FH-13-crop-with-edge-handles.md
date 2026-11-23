---
id: FH-13
title: "Crop with edge handles"
epic: 8-first-hour
type: enhancement
priority: P3
size: M
evidence: seen
labels: [enhancement, "priority:P3", "size:M", "evidence:seen", "area:editor"]
depends_on: []
related: [FH-07, SC-02]
upstream: ["nyblnet/bento discussion #319"]
---
## Summary

Crop mode is pan and zoom only: the frame is a fixed window and you move the picture behind it. People coming from PowerPoint, Keynote or Figma expect to drag the frame's edges inward to cut a side off. Add edge and corner handles inside crop mode that resize the frame while the picture stays where it is.

## What the user experiences

- Double-click a picture. The frame stays the same size; dragging pans the picture, the wheel zooms. To remove a strip from the right-hand side you must zoom in and pan, which also crops the other three sides.
- Outside crop mode, dragging a side handle scales the whole picture, because a picture's proportions are locked by default. So neither mode offers "cut this edge".

## Reproduce

1. Insert a picture (Image tool, pick a file).
2. Double-click it. A hint explains drag to pan and scroll to zoom.
3. Try to drag the right edge of the frame inward. There is no handle; the drag pans the picture.
4. Press Esc, select the picture, and drag the right-middle resize handle. The picture scales in both dimensions.

## Evidence

Observed in the running app during the first-deck journey: no edge handles in crop mode; the side handle outside crop mode scaled the picture because the aspect ratio is locked.

Confirmed in code now:

- `slides/src/editor/cropedit.ts:3-13` documents the design: "drag pans it, wheel or pinch zooms about the pointer, Enter (or a click outside the frame) commits ONE undo step, Esc puts back what was there". The overlay listens for `pointerdown` and `wheel` only (`cropedit.ts:82`, `86`); there is no handle element.
- The model is `ImageCrop { x, y, scale }` (`slides/src/model.ts:464-468`), "pan + zoom inside the frame; absent = `fit` alone" (`model.ts:481-482`). The frame itself is the element's `x/y/w/h`.
- Proportions: for an image, an absent `keepAspectRatio` means locked (`model.ts:476-480`), which is why the side handle scales.
- Mapping helpers already exist and are shared with the renderer: `cropImgStyle`, `cropWindow`, `normalizeCrop`, `CROP_MAX_SCALE` (`slides/src/crop.ts:24-57`).

## How others do it

- PowerPoint: Crop shows black edge and corner handles on the frame; dragging one cuts that side; the picture can still be dragged behind the frame.
- Keynote: Edit Mask: the mask has handles, the picture has its own slider and handles.
- Figma: double-click enters crop mode with handles on the frame and the full image dimmed around it; edges crop, the image can be moved and scaled.
- Penpot: fit and fill modes with a crop box that has handles.

## Proposed change

No format change is needed: an edge drag is a change to the element's box (`x`, `y`, `w`, `h`) plus a compensating change to `crop` so the picture does not move on the slide.

1. In `CropEditor` (`cropedit.ts`), add eight handles (four edges, four corners) on the frame overlay. The overlay already lives in the scaled stage, so handle geometry is in slide pixels divided by the zoom; size the hit area at least 12 screen pixels.
2. While a handle is dragged: compute the new frame rectangle in slide coordinates, clamp it to the picture's visible extent (the ghost image's rectangle) so the frame never shows outside the picture, and to a minimum size. Then recompute `crop` from the invariant "the picture's rectangle on the slide is unchanged". Derive the formula from `cropWindow` / `cropImgStyle` in `crop.ts` rather than re-deriving the fit maths; if a helper is missing, add an exported pure function there (for example `cropForFrame(naturalSize, pictureRect, frameRect, fit)`) so the node rig can test it.
3. A rotated picture: do the maths in the element's local axes (the overlay is already inside the rotated stage node; confirm).
4. Crop mode ignores the aspect lock: edges move freely here. Holding Shift on a corner keeps the frame's current proportions.
5. Commit and cancel stay as they are: Enter or an outside click commits one undo step containing both the box and the crop; Esc restores the entry box and crop. `this.entry` (`cropedit.ts:29`) currently stores only the crop; extend it to store the entry box too.
6. Extend the hint line with the new gesture.

New strings (all catalogs): the extended hint sentence.

Rejected: a separate "mask" element type (Keynote's model). The format rule is no new element type; box plus crop expresses the same thing.

## Acceptance criteria

- [ ] In crop mode the frame shows edge and corner handles.
- [ ] Dragging the right edge inward reduces the element's `w` and leaves every remaining visible pixel of the picture at the same slide position (verified with `getBoundingClientRect` of the image before and after, within 1px).
- [ ] The frame cannot be dragged beyond the picture's extent, nor below a minimum size.
- [ ] Pan and zoom behave exactly as before.
- [ ] Enter commits one undo step; one undo restores both the original box and the original crop.
- [ ] Esc restores the entry state exactly.
- [ ] Works on a rotated picture and on a flipped one (`flipX` / `flipY`).
- [ ] A cropped picture still morphs between slides (crop is tweened by `lerpCrop`, `crop.ts:66`); no regression in the crop rig.

## Tests

- Extend `scripts/test-slides-crop.ts` (node, already registered) with the pure-function cases: for several fits, natural sizes and frame rectangles, the picture rectangle computed from the new box and crop equals the original.
- Add `scripts/test-slides-crop-handles-browser.mjs`: enter crop mode, drag the right edge with real mouse input, assert `w` shrank and the image's on-screen rectangle did not move; Esc restores; Enter then undo restores. Register it in the `slides-editor-browser` job in `.github/workflows/ci-slides.yml`.

## Out of scope

- Crop to a shape or mask.
- Image adjustments (brightness, filters).
- A picture placeholder slot that fills and crops on insert (FH-07).

## Notes for the implementer

- Zone: slides app. Files: `slides/src/editor/cropedit.ts`, `slides/src/crop.ts`, `slides/src/styles.css`, catalogs, `CHANGELOG.md`.
- Canvas gestures: Moveable is hidden while crop mode runs (`cropedit.ts:12-13`), so these handles are your own pointer handling, not Moveable ables. Read `slides/CLAUDE.md` on the crop section before starting.
- Measure with `getBoundingClientRect`; a style read-back will pass whether or not the picture moved.
- The live session writes the numbers into the element while the gesture runs (`cropedit.ts:8-11`); keep that pattern for the box so collaborators see one committed change, not a stream.

---
id: FH-07
title: "Image placeholders: a real picture slot that fills and crops"
epic: 8-first-hour
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:editor"]
depends_on: [FH-01]
related: [FH-06, FH-13, F-01, SC-02]
upstream: []
---
## Summary

The "Image left" and "Image right" layouts show a grey "Add an image" box. It is a text placeholder that only the layout-switching code treats as a picture slot. Inserting, pasting or dropping a picture ignores it: the picture lands centred on top of the slot, at its own size, and the "Add an image" box stays behind it.

## What the user experiences

1. Apply "Image left". A box reads "Add an image".
2. Click it: it opens as a text box (the prompt can even be saved as text, FH-01).
3. Use the Image button: the picture appears in the middle of the slide, overlapping the text column, not in the slot. The slot is still there.
4. The user now drags and resizes the picture by hand to cover the slot and deletes the leftover box.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173. File menu → Start from scratch → confirm.
2. In the inspector, Layout → apply **Image left**.
3. Click the toolbar Image button and choose any picture.
4. `window.bento.doc.slides[0].elements`: the `text` element with `role: 'image'` and id `lil-image` is still present; a new `image` element sits at the slide centre at up to half the slide's size.

## Evidence

- **Seen (journey 1):** steps 2–4 with a screenshot of the picture on top of the slot.
- **Confirmed in code now:**
  - `slides/src/model.ts:1425-1427` and `:1440-1441` — the slots are `ph('lil-image', 'Add an image', { x: 120, y: 120, w: 640, h: 660 }, { …, role: 'image' })`: text elements with a placeholder prompt.
  - `slides/src/model.ts:1480-1500` (`applyLayout`) — the only place that knows the convention: "An `image` slot is a text placeholder … that an IMAGE donor replaces outright — the picture takes the slot's frame and id", implemented at `:1483` and `:1500`. It runs only when a layout is applied to a slide that already has a picture.
  - `slides/src/editor/editor.ts:2618-2638` (`pickImage`) — inserts at the slide centre, scaled to at most half the slide; no slot lookup.
  - `slides/src/editor/editor.ts:2916-2938` (`pasteImageFile`) — centres at up to 640×480; no slot lookup.
  - No other match for `role === 'image'` under `slides/src/editor/`.
- **Unverified:** nothing.

## How others do it

- **PowerPoint:** a picture placeholder has an icon; clicking it opens the picker; the picture is cropped to fill the placeholder's frame and can be re-cropped.
- **Keynote:** media placeholders: drop or click the icon; the image is masked to the frame ("Edit Mask").
- **Figma Slides, Canva:** image frames accept a drop and fill with cover fit.

## Proposed change

Keep the format as it is (a text element with `role: 'image'` and a placeholder); teach the editor the convention the model already has.

1. **One helper** (model or editor): "the empty picture slot on this slide, if any": first element with `role === 'image'`, `type === 'text'` and no content, in document order. Prefer a selected one.
2. **Insert into the slot.** `pickImage`, `pasteImageFile` and the drop path from FH-06 check for a slot when the user did not aim elsewhere (FH-06's drop point wins if it is outside the slot). If there is one, replace it in a single commit with an image element that takes the slot's `id`, `x`, `y`, `w`, `h`, `rotation` and `role: 'image'`: the same shape `applyLayout` produces at `model.ts:1500`, so slides from the same layout still morph their pictures. Set `fit: 'cover'` so the picture fills the frame; the existing crop mode then lets the user reposition it.
3. **Click to pick.** A click on an empty picture slot opens the image picker instead of a text edit; double-click likewise. Keyboard: Enter on the selected slot. Do not allow the slot to be edited as text.
4. **Look.** Draw an icon with the prompt so it reads as a picture frame, not a text box (editor only; hidden in present, as today via `hidePlaceholders`).
5. **Removing the picture** (Delete) restores the empty slot only if that is cheap; otherwise the slot is simply gone, as with any element. State which.
6. Apply the same rule to user-saved layouts: any text placeholder with `role: 'image'`.

Strings: a tooltip or accessible name for the slot ("Add an image: click to choose a picture") in every catalog.

## Acceptance criteria

- [ ] On a slide with an empty picture slot, the Image button inserts the picture into the slot: same id and frame as the slot, `fit: 'cover'`, slot element gone, one undo step.
- [ ] Pasting an image file does the same.
- [ ] With no empty slot, insertion behaves exactly as before.
- [ ] With two slots, the first empty one (or the selected one) is filled; a second insert fills the next.
- [ ] Clicking an empty slot opens the picker and never opens a text edit.
- [ ] The inserted picture's `src` is an `asset:` reference.
- [ ] Switching the slide to "Image right" afterwards moves the picture into the new slot (existing `applyLayout` behaviour, still passing).
- [ ] Present mode and print show nothing for an empty slot.

## Tests

- Node: extend `scripts/test-layouts.ts` (or `scripts/test-slides-layout.ts`; check which covers `applyLayout`) with the helper's selection rule.
- Browser: `scripts/test-slides-image-slot-browser.mjs`: apply Image left, feed a generated PNG through the picker's input (`setInputFiles`) and through a paste event, assert the doc. Register in `.github/workflows/ci-slides.yml`.
- Regression: `scripts/test-slides-crop*.ts`, `scripts/test-slides-shrink.ts`.

## Out of scope

- A dedicated picture-placeholder element type (the format has no new element types by decision: `docs/DECISIONS.md`, the editor-revamp entries near line 12043).
- Crop handles (FH-13).
- Drag-and-drop itself (FH-06).

## Notes for the implementer

- Zone: slides app. Hot files: `slides/src/editor/editor.ts`, `slides/src/editor/canvas.ts`, `slides/src/model.ts`.
- `ImageElement.fit` and `crop` already exist (`model.ts:464-483`); no format change is needed.
- Layout colours and fonts are being rebound to the theme in F-01; touch only the slot behaviour here.

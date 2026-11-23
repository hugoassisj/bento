---
id: FH-08
title: "Show on every slide: footers and repeated elements"
epic: 8-first-hour
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:editor", "format-change"]
depends_on: []
related: [F-01, SC-04, MP-16, AI-09]
upstream: []
---
## Summary

There is no way to put a logo, a footer or a page number on every slide and keep it in step. Layouts are stamped once when applied; changing a layout afterwards changes nothing already made. The built-in slide number is drawn only in the show. Users coming from PowerPoint or Keynote look for a master slide and find none.

## What the user experiences

- To put a logo on twenty slides they copy and paste it twenty times. To move it they do that again.
- "Slide number" in the Deck section adds a counter in the show's letterbox; nothing appears on the slide in the editor, in thumbnails or in print, and it cannot be styled or placed.
- Saving a slide as a layout and later improving that layout does not update slides built from it.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Tick Deck → Slide number in the inspector. No element is added to any slide; the number appears only after starting the slideshow.
3. Add a text box with `{{page}}` to slide 1. It shows on slide 1 only.
4. Inspector → Layout → save the slide as a layout, apply it to a new slide, then edit the original: the new slide does not follow.

## Evidence

- **Seen:** journey 1 reported "Slide number is a show-only '3 / 7' in the letterbox, with nothing in the editor" and that layouts are one-time stamps. Not re-driven for this issue.
- **Confirmed in code now:**
  - `slides/src/model.ts:1473-1520` (`applyLayout`) — a one-off merge of a layout's elements into a slide; no link is kept beyond shared element ids.
  - `slides/src/model.ts:1453` (`instantiateLayout`) — copies a layout into a new slide.
  - `slides/src/model.ts:801` — `present.slideNumber?: boolean` is a show option, not an element.
  - `slides/src/render.ts:68-94` (`resolveFields`) — `{{page}}`, `{{pages}}`, `{{title}}`, `{{date}}` and document-property fields already resolve per slide, so a repeated element containing a field would render correctly on each slide.
  - No key on `Slide`, `ElementBase` or `BentoDoc` (`model.ts:11-220`, `646-712`) expresses "appears on every slide".
- **Unverified:** the exact "save as layout" UI steps (read from the first audit's notes: `slides/src/editor/inspector/slide.ts`).

## How others do it

- **PowerPoint:** Slide Master with layouts beneath it; Insert ▸ Header & Footer toggles date, number and footer per slide or for all.
- **Keynote:** Edit Slide Layouts; objects on a layout appear on every slide using it; "Slide Number" is a layout object.
- **Figma Slides / Figma:** components on a template; changing the main updates copies.
- **Penpot:** components with main and copies.

## Proposed change

This adds to the format. Two designs; pick one and propose it before building for upstream.

**A. Deck furniture (recommended).** A new optional list on the document, for example `doc.furniture: SlideElement[]`: ordinary elements drawn on every slide, under the slide's own elements, with fields resolved per slide. A slide opts out with an optional `slide.noFurniture: true` (title and section slides). Old shells ignore both keys and simply do not draw the furniture: decks stay readable, the footer is missing. Editing: selecting a furniture element on any slide edits the one shared element, with a clear badge ("On every slide") and a way to detach.

- For: one place to edit, no duplication in the file, no sync logic, small render change (one extra pass in `renderSlide`), agents can read and reuse it.
- Against: old shells drop the footer; morph and export paths must include furniture.

**B. A per-element flag kept in sync as copies.** `el.everySlide: true` plus the derive pass copying the element to every slide and keeping copies in step, the way component copies follow their main (`slides/src/components.ts`, `slides/src/derive.ts`).

- For: old shells still draw the footer on every slide because the copies are real elements.
- Against: N copies in the file, a sync pass with the same "both edited" ceiling components have (`docs/DECISIONS.md` near line 12168), CRDT merge of mass edits.

A lighter third option to weigh first: do this with what exists. A footer made as a **component** and inserted on each slide already stays in step. Then the feature is only "Insert on every slide" and "Remove from every slide" commands, with no format change at all. If that covers the need, prefer it and close the format question.

**Either way**

1. Inspector: an "On every slide" toggle in the element header or the Arrange section; a slide-level "Hide deck furniture" checkbox.
2. `render.ts` `renderSlide`: draw furniture for the canvas, thumbnails, present, print and image export; `validate.ts` and `measure.ts` include it.
3. `untrusted.ts` gate, `modelkeys.generated.ts`, `schema/slides.json` regenerated; `docs/format.md` and `docs/agents.md` updated; `compact.ts` round-trips the key.
4. Page numbers: with furniture, the show-only counter (`present.slideNumber`) stays as is; a `{{page}}` furniture element is the styled alternative.

New strings in every catalog.

## Acceptance criteria

- [ ] An element marked "on every slide" is drawn on every slide in the editor, thumbnails, the show, print and exported images.
- [ ] Editing it once changes it everywhere; one undo step.
- [ ] A slide can opt out.
- [ ] `{{page}}` inside it shows each slide's own number.
- [ ] A file using the feature opens in a 1.3.0 shell without errors; the PR states exactly what that shell shows.
- [ ] The key is in `modelkeys.generated.ts` and `schema/slides.json`; both `--check` builds pass.
- [ ] Copying a slide to another deck does not silently drop or duplicate the furniture (state the rule).
- [ ] Live collaboration: two people editing the shared element converge (`node scripts/test-sync.ts` green).

## Tests

- `scripts/test-slides-furniture.ts` (node): model, gate, compact round trip, old-shell reading (unknown key preserved through parse and serialize).
- `scripts/test-slides-furniture-browser.mjs`: render on every surface; opt-out; field resolution.
- Register node rigs in `.github/actions/validate-slides/action.yml`, browser rigs in `.github/workflows/ci-slides.yml`.
- Regression: `scripts/test-slides-fields.ts`, `scripts/test-slides-export-images.ts`, pagination and schema-frozen rigs.

## Out of scope

- Editable master slides with live-linked layouts (a much larger design).
- Slide sections (MP-16).
- Theme reach of layouts (F-01).

## Notes for the implementer

- Zone: slides app, plus format documentation. No kernel change expected, but check `kernel/src/docfields.ts` if document-level keys are listed there.
- Read `docs/PLATFORM.md` on format additivity and `docs/DECISIONS.md` (editor-revamp entries, "no new element type or shape kind") first.
- Do not start on option A or B for upstream without the maintainer's view; the component-based option needs none.

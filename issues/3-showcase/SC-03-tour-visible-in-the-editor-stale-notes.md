---
id: SC-03
title: "The tour is visible in the editor; stale chart notes corrected"
epic: 3-showcase
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:showcase"]
depends_on: []
related: [SC-02, FH-05, F-06]
upstream: []
---
## Summary

All of the Showcase's guidance is written in speaker notes, and the notes pane now starts folded. A newcomer who lands in the editor sees a polished deck and nothing that says what to try. Only the first slide has on-canvas hints, and those are about presenting. Two of the notes are also wrong: they call the charts "a live ECharts instance" although the chart engine has been in-house for a long time. Put one "try this" on each slide where the editor shows it and the show does not, and correct the notes.

## What the user experiences

A person opens bento.page/slides. The deck is beautiful and silent. They click around, maybe press Slideshow. Nothing tells them to double-click text, to open Layers, to drag a card past another, or that the tiles on slide 1 morph. The tour text exists, 19 slides of it, under a toggle they have no reason to press. A reader of the notes on the chart slides is told the charts are ECharts, which contradicts the README.

## Reproduce

1. Open the app in a fresh profile. The notes pane under the canvas is closed.
2. `window.bento.doc.slides.map(s => s.notes.length)`: all 19 slides have notes.
3. `window.bento.doc.slides.reduce((n, s) => n + (s.comments?.length || 0), 0)`: 0.
4. `window.bento.doc.slides[7].notes` begins "The chart is a live ECharts instance while presenting"; `slides[8].notes` contains "ECharts’ universal transition".

## Evidence

Observed during the audit: notes on all 19 slides; no comments; on-canvas hints only on slide 1 (advance, Esc to edit, S for the speaker view).

Confirmed in code now:

- The notes pane "starts folded until the viewer opens it" (`slides/src/editor/notespane.ts:9`), opening only when `bento-notes-open` is `'1'` in local storage (`notespane.ts:116`).
- The stale sentences are at `slides/src/starterdeck.ts:1107` and `starterdeck.ts:1124`.
- Review comments are stored on the slide, shown in the editor as numbered markers and "never rendered in present/print" (`slides/src/editor/comments.ts:3-7`); the model is `Comment` in `slides/src/model.ts:631-645` with `elementId`, `author`, `text`, `at`.
- Charts are drawn by the in-house engine (`README.md`, "Charts, built in"; `kernel/src/charts.ts`).

Still unverified: how comment markers read to a first-time user (they look like review feedback, not a tutorial). Test with the real UI before committing to comments as the carrier; see alternatives.

## How others do it

Figma's starter files put the instruction next to the object it is about. PowerPoint's welcome deck writes "Try it" steps on the slide. Keynote's themes use placeholder text that says what to do. None hides the tour in presenter notes.

## Proposed change

1. **Correct the notes** at `starterdeck.ts:1107` and `:1124`: describe the charts as built in, with tooltips and zoom while presenting and morphing between types. Review every other note for claims that no longer hold (search for product names and version-specific wording).
2. **One "try this" per slide, visible while editing, absent from the show and from print.** Preferred carrier: a comment thread on the relevant element, authored "Bento", with one short imperative sentence ("Double-click this title and type", "Open Layers: this row is a frame", "Drag a card past its neighbour"). Comments already have exactly the visibility wanted and need no new code or format.
   - If user testing shows comment markers read as review noise, the alternative is a first-run hint strip tied to the starter document only; that is new UI and new strings, so try comments first.
3. **Resolve on action where cheap**: nothing automatic in this issue. The comment's own Resolve button is enough.
4. **Open the notes once for the starter**: when the open document is the untouched starter and the user has never toggled notes, start the pane open. Read the same "is this our starter" signal boot already has (`bootWith(…, !parsed)` in `slides/src/main.ts`), and never override a stored preference.
5. Keep slide 1's presenting hints.

Comment text is document content. Decide with the maintainer whether it is localised like the rest of the starter or left in English; do not add it to the UI catalogs.

## Acceptance criteria

- [ ] No note in the starter mentions ECharts or any engine that is not in the tree.
- [ ] Every non-state slide carries exactly one "try this", anchored to an element that exists on that slide.
- [ ] The "try this" items are visible in the editor on first open without any click.
- [ ] None of them appears in present mode, in print or PDF, or in an exported image (assert in a browser rig).
- [ ] On an untouched starter with no stored preference the notes pane starts open; with `bento-notes-open` stored as `'0'` it stays closed; on any other document behaviour is unchanged.
- [ ] `window.bento.validate()` stays at zero errors and warnings (SC-01).
- [ ] Shell size before and after is stated in the PR.

## Tests

- Extend `scripts/test-slides-starterdeck.ts`: every comment's `elementId` resolves on its slide; no note matches `/ECharts/i`.
- `scripts/test-slides-starter-tour-browser.mjs`: opens the built shell, asserts the markers are in the editor DOM and that the show's DOM and a print render contain none; asserts the notes-pane default for the three cases above. Register in `.github/workflows/ci-slides.yml`.

## Out of scope

- New features in the deck (SC-02).
- A general onboarding system or coach marks for arbitrary documents.
- The empty state after Start from scratch (FH-05, SC-05).

## Notes for the implementer

Slides zone; `starterdeck.ts` plus a few lines in `notespane.ts` or its caller. The starter is in every shell: nineteen short comments cost bytes, so keep each under about 80 characters and state the total. The comments feature asks for an author name with `window.prompt` on first use (`comments.ts:17-25`); pre-authored threads must not trigger that prompt on open. Upstream changed the notes pane's default once already after disliking a first design (`docs/DECISIONS.md`, entry on the notes toggle near the end of the file); raise the "open for the starter" behaviour with the maintainer before proposing it upstream.

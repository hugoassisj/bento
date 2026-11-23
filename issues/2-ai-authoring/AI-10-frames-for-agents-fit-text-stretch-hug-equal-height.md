---
id: AI-10
title: "Frames for agents: fit text after layout, fix stretch with hug, equal-height rows"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-11, AI-09, AI-12, F-03, DS-01]
upstream: []
---
## Summary

Auto-layout frames are the only way an agent can build a slide without computing coordinates, and three things stop them from working when a deck is loaded from JSON: text height is measured before the frame has given the text its width, a hugging row whose children stretch collapses to whatever height the file happened to carry, and there is no way to get a row of cards that are all as tall as the tallest one. The agent in the trial had to write its own measure-and-reload loop to get a usable slide.

## What the user experiences

An agent writes a row frame of three cards, each a column frame holding a title and a paragraph, sets the texts to `h: "auto"` and the cards to fill the row, and writes placeholder boxes because the frame is supposed to place everything. After `window.bento.loadDoc()`:

- The title text is 635px tall. It was measured at the placeholder width of 100px, then the frame widened it, and nothing measured it again.
- Content sits off the slide, while the load report says 0 warnings (that part is AI-11).
- With `align: "stretch"` on a hugging row, every card is 100px tall: the placeholder height.
- After fixing heights by hand, the cards have ragged heights. There is no setting that makes them equal to the tallest.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. In the console, load a compact deck with one slide: a row frame (`layout: {dir:"row", gap:24, pad:[24,24,24,24], hug:true, align:"stretch"}`) with three child column frames (`parentId` the row, `sizing:{w:"fill"}`, `layout:{dir:"col", gap:12, pad:[16,16,16,16], hug:true}`), each holding two text children with `sizing:{w:"fill"}`, `w:100`, `h:"auto"` and different amounts of text.
3. `const r = window.bento.loadDoc(JSON.stringify(deck))`, then read `window.bento.doc.slides[0].elements` and `await window.bento.validate()`.

Observed in the trial: text `h` far larger than the laid-out width needs; cards 100px tall with stretch; unequal card heights without it.

## Evidence

Observed during the audit (AI trial, part 2, frames and tokens version): the 635px title, the first load placing content off-slide, `align:"stretch"` with `hug` collapsing cards to 100px, and no route to equal-height cards.

Confirmed in code now:

- `slides/src/compactload.ts:104` calls `fitAutoHeights(doc, stats)` before the document reaches the store. `fitAutoHeights` (`compactload.ts:119-131`) measures each text with `measureElement(tx, doc)` at the element's current `w`.
- Frame children get their real `w` only from `layoutAll`, which runs inside `derive` (`slides/src/derive.ts:49-70`), and for a loaded document that runs on the store's `replace` event (`slides/src/editor/editor.ts:252`), after the fit. Nothing re-fits afterwards except the fonts-ready path (`slides/src/main.ts:392-395`), which only runs when fonts were still loading.
- A child frame on the cross axis of a stretching parent is "owned by its parent" and skips its own hug on that axis (`slides/src/layout.ts:201-202`, `ownedByParent` at `layout.ts:213-219`). The parent's hug then takes the maximum of the children's current sizes (`layout.ts:240-246`), and `place` writes that back to every child (`layout.ts:327`).

Still unverified: that the ownership rule above is the whole cause of the 100px collapse. It is my reading of the code and matches the symptom; write the failing rig first.

## How others do it

Figma: text in an auto-layout frame has a resizing mode (auto width, auto height, fixed) and reflows when the frame resizes it. A row with "Fill container" height on its children and "Hug contents" on the row gives equal-height cards as tall as the tallest content. Penpot's flex layout has the same pair (Fit content on the parent, Fill on the children), following CSS `align-items: stretch`.

## Proposed change

Keep `layout.ts` pure geometry: `docs/DECISIONS.md` (2026-08-02 entry on layout, around lines 2842-2876) rules out a solver that measures text. Text heights stay inputs; the fix is the order they are produced in.

1. In `parseDocInputReport` (`compactload.ts`), after the gate and before the report, run a derive pass on the result (`derive(doc, deriveMemory(doc))`), then re-fit every auto-height text whose `w` changed, then derive again. Stop when a pass changes nothing; cap at 4 rounds as `derive.ts` does. The editor's own derive on `replace` must then find nothing to change.
2. In `layout.ts`, make a hugging frame with stretching children compute its cross size from the children's natural sizes: for a child frame, the size its own hug would give if it were not owned by the parent; for any other child, its current size. Then stretch every child to that maximum. This is what gives equal-height rows, with no new key.
3. Add the pattern to a fixture: `scripts/fixtures/agent-decks/equal-cards.json`.

No new format key. `h: "auto"` stays load-time only; a persistent auto-height flag is a separate decision (the same DECISIONS entry says it must be an additive flag).

Alternatives rejected: measuring text inside `layout.ts` (ruled out); asking agents to estimate heights (the status quo).

## Acceptance criteria

- [ ] Loading the reproduction deck gives each text an `h` within 2px of `window.bento.measure()` at its laid-out width.
- [ ] After `loadDoc`, the editor's derive pass on `replace` changes nothing (assert `derive` returns false).
- [ ] A hugging row with `align:"stretch"` and hugging column children ends with every child as tall as the tallest child's content, not the height written in the file.
- [ ] The same row without stretch keeps each child's own height (no behaviour change).
- [ ] `scripts/test-slides-layout.ts` still passes, including its one-pass-settling fuzz.
- [ ] Every deck in `scripts/fixtures/agent-decks/` still loads clean.
- [ ] `validate()` on the reproduction deck reports no `text-overflow` and no `out-of-canvas`.

## Tests

- Extend `scripts/test-slides-layout.ts` with the stretch-and-hug cases (pure, node). They must fail on the parent commit.
- Add `scripts/test-slides-load-fit-browser.mjs`: loads the reproduction deck through `window.bento.loadDoc` in headless Chromium and asserts the heights and the no-op derive. Register it in `.github/workflows/ci-slides.yml` beside the other editor browser rigs.
- Add the new fixture to `scripts/test-slides-agent-decks.ts`.

## Out of scope

- Re-fitting text when a person edits it later inside a frame (F-03).
- Reporting findings after layout (AI-11); do that one first or together.
- Grid spans, absolute children, per-child alignment (DS-14).

## Notes for the implementer

Slides zone only. Hot files: `compactload.ts`, `layout.ts`, `derive.ts`. Layout results are written into the model and must stay a fixed point on every replica: any change to `hug` must be deterministic and settle in one pass, or collaboration diverges. `deriveMemory` treats tokens as unmoved at load, so a token-bound literal that disagrees still loses its binding (AI-12); do not change that here.

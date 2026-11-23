---
id: EPIC-3
title: "Epic 3: the Showcase deck as the reference"
labels: [epic]
---
# Epic 3 · The Showcase deck as the reference

## Goal

The built-in Showcase deck (`slides/src/starterdeck.ts`) is the first thing every user sees at bento.page/slides and the deck every agent is pointed at. Make it do four jobs at once: show everything that shipped, pass the app's own check, teach inside the editor, and be the model an agent copies.

## Why it matters

- It sets the visual bar. In the AI trial an agent rated its own output about 6 out of 10 against roughly 9 for the Showcase.
- It is the reference for tooling. Agents are told to validate; today the reference itself reports six warnings.
- It is the tour. The guidance lives in speaker notes, and the notes pane now starts folded.
- It is the example of the design system. Whatever it does with tokens, components and layouts is what people and agents will imitate.
- It travels inside every file, so every byte added here is added to every document. Changes need measuring and, upstream, agreement first.

## Inventory (live starter, 1.3.0 at `29b5c80`)

| What | Count |
|---|---|
| Slides | 19 (15 shown, 4 state slides) |
| Elements | 336 (149 shapes, 122 texts, 56 svgs, 5 charts, 3 code blocks, 1 table) |
| Auto-layout frames | 45, with 92 children |
| Design tokens | 18, one mode |
| Component members | 40 (3 components) |
| Elements with a binding | 261; about 48% of style values bound |
| Named elements | 321 of 336 |
| Speaker notes | on all 19 slides |

Covered: morph (18 of 19 transitions), gradient fills, motion-path loops, entrances, count-ups, symbol-by-symbol maths and code morph, charts with state morphs, a table linked to a chart, state slides and links, fields, frames, components, tokens, markdown typing.

Missing:

| Feature | In the Showcase |
|---|---|
| Click-build steps | 0 |
| Image elements (so crop) | 0 |
| Visuals with alt text | 0 of 61 |
| Video or audio | 0 |
| Fill or stroke layer stacks | 0 |
| Boolean shapes | 0 |
| Blend, blur | 0 |
| Token modes | none |
| Locked or hidden elements | 0 |
| Comments | 0 |
| Saved layouts | 0 |
| Validator warnings on the untouched deck | 6 (3 false, 3 for a deliberate bleed) |

Also wrong: two chart notes describe the charts as "a live ECharts instance"; the engine is in-house.

## Children, in order

- [ ] **SC-01** Showcase validates clean; a deliberate bleed can be marked; CI gate (needs F-07)
- [ ] **SC-05** Start from scratch: blank or keep this look; reset the title
- [ ] **SC-03** The tour is visible in the editor; stale chart notes corrected
- [ ] **SC-02** Showcase covers what shipped: builds, a picture with crop and alt text, media, modes, paint layers, booleans (agree the byte budget upstream first)
- [ ] **SC-04** Showcase as the model deck: every value bound, saved layouts, alt text on all visuals

SC-01 goes first so the clean-check gate protects every later change to the deck. SC-05 and SC-03 are independent of each other. SC-02 and SC-04 both edit the same file heavily: do them one after the other, not in parallel.

## Definition of done

- `window.bento.validate()` on the untouched Showcase reports zero errors and zero warnings in a real browser, and CI fails if that changes.
- Every feature in the "Missing" table above appears at least once, or the PR records why it was left out (video, on byte grounds).
- A newcomer sees one "try this" per slide in the editor without opening anything; none of it shows in the slideshow or in print.
- Every colour and font family is bound; the deck carries its own layouts; every meaningful visual has alt text.
- Start from scratch gives an explicit choice and an untitled deck.
- The same deck is generated into the skill as its reference example (AI-01, AI-04) and used as an eval fixture (AI-17).
- The compressed shell size before and after each change is on record, and the deck still opens in the previous released shell.

## Related epics

Epic 1 (F-01 layouts follow the theme, F-02 theme presets, F-07 field measurement, F-09 new findings), epic 2 (AI-01, AI-04, AI-16, AI-17), epic 8 (FH-05 empty state, FH-14 first save).

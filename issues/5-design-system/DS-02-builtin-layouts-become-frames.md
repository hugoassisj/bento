---
id: DS-02
title: "Built-in Three cards and Two columns layouts become auto-layout frames"
epic: 5-design-system
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:design-system"]
depends_on: [F-01]
related: [DS-01, DS-03, AI-09, AI-10, SC-04]
upstream: []
---
## Summary

The app ships auto layout, but its own built-in layouts do not use it. "Three cards" is three rectangles with a text box grouped on top of each; "Two columns" is two fixed text boxes. Delete a card and a hole stays; add a fourth and nothing makes room. Rebuild these layouts on frames so they demonstrate the feature and behave the way a user now expects.

## What the user experiences

They apply the Three cards layout, decide two points are enough, delete the third card, and are left with two cards and an empty third of the slide. In a frame the two would share the width.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Add a slide; Format tab ▸ Layout ▸ choose **Three cards**.
3. Click the third card's background and press Delete (delete its text too).

Observed: the first two cards keep their size and position; the right third is empty.
Expected: the remaining cards fill the row.

## Evidence

- **Seen in the running app (design-features journey):** screenshot `04-two-selected.png`.
- **Confirmed in code now:**
  - `slides/src/model.ts:1401-1414` (`layout-three-cards`): a title placeholder, then per card a `card(...)` rectangle at fixed x (120, 587, 1054; width 426) and a `ph(...)` text placeholder inside it sharing a `groupId` (`l3c-g1` …). No `layout`, no `parentId`.
  - `model.ts:1378-1387` (`layout-two-col`): two `ph` text boxes at fixed x (120 and 820; width 660).
  - `model.ts:1357` (`builtinLayouts(size?)`): layouts are authored in a 1600×900 design space and fitted to the deck's size.
  - `model.ts:1473` (`applyLayout`): elements are matched to slots by id, then by `role`.
  - `slides/src/compact.ts:260-261`: the compact input form maps `two-column` → `layout-two-col` and `cards` → `layout-three-cards`. Agents depend on these ids and roles (`card1`, `card2`, `card3`, `body`).
  - `slides/src/layout.ts:165` (`layoutAll`) lays out `doc.slides` and `doc.layouts`. Built-in layouts are generated, so their elements are laid out once they are copied into a slide and the derive pass runs.

## How others do it

- **Figma Slides:** templates are built from auto-layout frames; removing a column reflows the rest.
- **Penpot:** flex and grid containers are the normal way to build a card row.
- **PowerPoint:** content placeholders are fixed, but Designer re-proposes a layout when the count changes. Bento's frames can do better than that for free.

## Proposed change

1. **Three cards:** a row frame (`layout: { dir: 'row', gap: 41, pad: [0,0,0,0], align: 'stretch' }`, not hugging) spanning x 120…1480, y 220…780. Each card is a column frame child with `sizing: { w: 'fill' }`, the card's fill and radius, padding 32, holding its text placeholder with `sizing: { w: 'fill', h: 'fill' }`. Keep every existing id (`l3c-bg1`, `l3c-card1`, …) and role so `applyLayout`, morph pairing and the compact form keep working; the card rectangles become the frames (a frame is a rect with `layout`).
2. **Two columns:** a row frame with two `fill` text children, gap 40, same ids (`l2c-left`, `l2c-right`) and roles.
3. Write x/y/w/h in full for every child, as the format requires (`model.ts:153-157`): the values the solver would produce at 1600×900. A shell that predates frames then draws exactly today's picture.
4. Check the fitting: `scaleLayout(ly, sx, sy)` (`model.ts:1330`) scales each element's x/y/w/h and nothing inside `layout`. It must also scale `gap` and `pad`, or the frame will fight the scaled boxes.
5. Drop the `groupId`s that existed only to move a card as one; the frame does that now. Confirm selection behaviour (click selects the card frame; double-click enters).
6. Run the placeholders' text through whatever F-01 does to bind layouts to the theme; do F-01 first so this issue does not conflict with it.

Old-shell behaviour: a 1.2.x shell that opens a deck using the new layouts sees ordinary positioned rectangles and text (it ignores `layout`, `parentId`, `sizing`). Deleting a card there leaves a hole, as today, until a current editor re-lays the slide. Say this in the PR.

No new strings.

## Acceptance criteria

- [ ] Applying Three cards at 1280×720 and at 1600×900 renders pixel-equivalent to today (compare bounding boxes within 1px).
- [ ] Deleting one card makes the other two share the row width equally; duplicating one makes four.
- [ ] Deleting one column in Two columns makes the other fill the width.
- [ ] Element ids and roles are unchanged; `node scripts/test-slides-compact-layouts.ts` passes; a compact deck using `layout: "cards"` with `card1..card3` loads with zero drops.
- [ ] Applying the layout to a slide that already has content keeps that content in the right slots (`applyLayout` by id, then role).
- [ ] The derive pass is a fixed point on a slide made from each layout (second pass writes nothing).
- [ ] `window.bento.validate()` reports no new findings on a slide made from each layout.
- [ ] Morph between two slides made from the same layout still pairs the cards.

## Tests

- Extend `scripts/test-slides-compact-layouts.ts` with: ids and roles unchanged, boxes equal to the pre-change boxes at both sizes, and reflow after removing a child (`layoutSlide` from `slides/src/layout.ts:172`).
- Extend `scripts/test-slides-frames-browser.mjs`: apply the layout from the inspector, delete a card with real input, measure the remaining cards.
- The agent decks under `scripts/fixtures/agent-decks/` must still load clean (`scripts/test-slides-agent-decks.ts`).

## Out of scope

- New layouts (stats, timeline, big number): AI-09.
- Theme binding of layout colours and fonts: F-01.
- Equal heights when card texts differ in length: AI-10.

## Notes for the implementer

- Slides app only. Hot file: `slides/src/model.ts` (`ph` `:1283`, `bar` `:1305`, `card` `:1311`, `scaleLayout` `:1330`, `builtinLayouts` `:1357`). F-01 and AI-09 edit the same block: sequence them, do not parallelise.
- Frames are derived geometry (`docs/DECISIONS.md:12052-12060`); order along the main axis is the children's current coordinate, ties by array order (`slides/src/layout.ts:15-17`), so write the children left to right in the array and in x.
- AGENTS.md documents the layout and role table for agents and `scripts/test-slides-compact-layouts.ts:139-147` checks it; update the table if anything an agent can observe changes.
- Record the byte cost (the layouts ship in every shell).

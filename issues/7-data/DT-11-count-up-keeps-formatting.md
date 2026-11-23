---
id: DT-11
title: "Count-up keeps formatting and counts only the chosen number"
epic: 7-data
type: bug
priority: P2
size: S
evidence: mixed
labels: [bug, "priority:P2", "size:S", "evidence:mixed", "area:data", "format-change"]
depends_on: []
related: [DT-03, MP-12]
upstream: []
---
## Summary

"Count up numbers" animates every number in a text box and flattens the box's formatting while it does. A headline such as "Revenue **$1,234.5M** (+27%) in 2026" loses its bold for good once the animation has run, and the year counts up from zero ("in 1411"). Keep the markup, and let the author choose which number counts.

## What the user experiences

They bold the figure in a stat line and tick Count up numbers. In the show the bold disappears as the slide enters and never returns on that slide. The percentage and the year also spin up from 0, so for a second the slide reads as nonsense dates.

## Reproduce

1. Fresh load. Add a text box with: `Revenue $1,234.5M (+27%) in 2026`. Select `$1,234.5M` and make it bold (⌘B).
2. With the box selected: Animate ▸ Count up numbers on.
3. Start the slideshow on that slide.
4. Result: three numbers count from 0 (1,234.5, 27 and 2026). During and after the animation the figure is no longer bold. Inspect the element in the show: its inner node contains a single text node, no `<b>`.
5. Step to another slide and back: the box is re-rendered with bold, then flattened again when the count-up runs.

## Evidence

- Seen in the running 1.3.0 app during the data journey (bold lost; the year counted up, read mid-flight as "in 1411").
- Code, verified now:
  - `slides/src/present.ts:1799-1812` `runCountUp`: `const plan = countPlan(inner.textContent ?? '')` and `onUpdate() { inner.textContent = plan(state.p) }`. Assigning `textContent` replaces all child nodes with one text node, which is the formatting loss.
  - `slides/src/countnumber.ts:108-126` `countPlan`: tokenises every digit run with `/\d+(?:[.,]\d+)*/g` and animates each one that `isCountable` accepts. There is no notion of "which number".
  - The flag is a boolean: `fx.countUp?: boolean` (`slides/src/model.ts:72`), gated as `bool` (`slides/src/untrusted.ts:334`); the inspector toggle is `slides/src/editor/inspector/animate.ts:417-418`.
  - Number reading rules are pinned by `scripts/test-slides-countup-number.ts`.
- The count-up does not preview on the canvas; that is MP-12.

## How others do it

- Keynote and PowerPoint have no built-in count-up; presenters fake it with builds. This is a differentiator, so it has to be safe to use on real slides.
- Web count-up libraries animate one target node and leave the rest of the sentence alone.

## Proposed change

1. **Keep the markup** (`slides/src/present.ts` `runCountUp`). Walk the text nodes under the inner element with a `TreeWalker`. Build the plan per text node (or over the concatenated text with a map back to node offsets, so a number split across nodes such as `1,<b>234</b>` is handled or deliberately skipped). On each update set `node.data`, never `textContent` on the container. On completion the DOM is byte-identical to the authored render.
2. **Choose the number** (format addition, optional key): `fx.countPick?: number`, the zero-based index among the box's countable numbers. Absent = all, exactly today's selection, so existing decks do not change.
   - Inspector (`slides/src/editor/inspector/animate.ts`): when the box has more than one countable number, show a compact choice under the toggle: "All" plus each number as a chip (`1,234.5`, `27`, `2026`). Selecting text in the box and pressing "Count this number" is a nice extra, not required.
   - Add `countPick` to the model type, the gate (`slides/src/untrusted.ts`, a small non-negative integer), `scripts/build-modelkeys.mjs` output and the schema.
   - Old shells: ignore the key and count every number, which is today's behaviour.
3. **Do not change the default set silently.** Skipping four-digit years automatically would alter decks that count a year on purpose. If a default heuristic is wanted, put it behind the new key's absence only for boxes authored after this change, which cannot be detected; so leave defaults alone and make the choice explicit.
4. **Duration** is hard-coded (`duration: 1.15, delay: 0.15`). Exposing it is optional; if you do, reuse an existing timing key rather than adding another.
5. Reduced motion: confirm the count-up settles immediately when the show's reduced-motion setting is on (search `present.ts` for how other effects settle) and add it if missing.

## Acceptance criteria

- [ ] After the count-up finishes, the element's inner HTML equals the HTML rendered before it started (bold, italic, colour spans, links intact).
- [ ] During the animation the bold run stays bold.
- [ ] With `fx.countPick = 0` only `1,234.5` animates; `27` and `2026` stay as authored for the whole animation.
- [ ] With `countPick` absent, behaviour is the same as before for a single-number box (the Showcase's count-up slide renders and animates as it does today).
- [ ] A number that is not countable (`1.2.3`, `192.168.1.1`) is never altered.
- [ ] A document with `countPick` opens in the gate without being dropped; an out-of-range index falls back to "all".
- [ ] The inspector offers the choice only when there is more than one countable number.
- [ ] Morph arrivals and elements carried across slides still skip or run the count-up exactly as before (`present.ts:1745` and `present.ts:1770` call sites).

## Tests

- Extend `scripts/test-slides-countup-number.ts` (node) with a plan-per-node case and `countPick` selection, using a pure function that maps text nodes to plans (keep the DOM walk thin so most logic is testable without a DOM).
- New browser rig `scripts/test-slides-countup-markup-browser.mjs`: render a box with a bold run and `fx.countUp`, drive the animation with `window.bento.anim.setManual(true)` and `tick()`, assert the `<b>` exists at mid-progress and that final `innerHTML` equals the initial. It must fail on the parent commit. Register in `.github/workflows/ci-slides.yml`; the node rig is already registered.
- Run `node scripts/build-modelkeys.mjs --check` and `node scripts/build-schema.mjs --check`.

## Out of scope

- Count-up in table cells or charts (DT-12 covers fields and maths in cells only).
- Easing options, counting down, prefixes that animate.
- Canvas preview (MP-12).

## Notes for the implementer

- Measure with the animation engine stepped manually; a hidden tab throttles `requestAnimationFrame` to zero and a style read-back proves nothing.
- If you would rather not add a format key, ship step 1 alone: it fixes the data-losing half and needs no format change. Then the label `format-change` applies only to step 2.
- `present.ts` is large and shared with every presenting issue in Epic 6; keep the diff inside `runCountUp`.

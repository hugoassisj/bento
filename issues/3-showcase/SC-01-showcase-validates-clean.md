---
id: SC-01
title: "Showcase validates clean; a deliberate bleed can be marked; CI gate"
epic: 3-showcase
type: bug
priority: P1
size: S
evidence: seen
labels: [bug, "priority:P1", "size:S", "evidence:seen", "area:showcase"]
depends_on: [F-07]
related: [SC-02, SC-04, F-09, AI-17]
upstream: []
---
## Summary

The built-in Showcase deck is the reference every user and every agent starts from, and it fails the app's own check: `window.bento.validate()` reports six warnings on it. Three are false text overflows caused by the page-number field being measured as literal text (F-07). Three are `out-of-canvas` warnings for the decorative "ghost numeral", a deliberate bleed the validator cannot tell from a mistake. An agent told to "validate and fix" sees noise on the model deck, and CI does not notice because the existing rig checks errors only, without measuring.

## What the user experiences

An agent opens the starter, runs the check as the guide tells it to, and gets six warnings on a deck it has not touched. It either "fixes" the numeral (damaging the design) or learns to ignore warnings. A person who opens a future Check deck panel (F-10) on a fresh file sees six problems before doing anything.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 in a fresh profile (the starter loads).
2. Console: `const v = await window.bento.validate(); v.counts`
3. Result: `{ error: 0, warning: 6, info: 20 }`.
4. `v.findings.filter(f => f.severity === 'warning')` lists, for slides 2, 13 and 18: one `out-of-canvas` ("Extends outside the 1280x720 canvas (x 780-1200, y -30-310) — the text past the edge is cropped when presenting") and one `text-overflow` ("Text needs 1500px but the box is 340px tall … (4 lines)"), all on the element named "Ghost numeral".

## Evidence

Observed during the audit: the counts and messages above, reproduced twice in the running app.

Confirmed in code now:

- The numeral is defined once in `slides/src/starterdeck.ts:274-278`: `x: 780, y: -30, w: 420, h: 340, html: '{{page:2}}'`, 300px type at 5% opacity.
- `out-of-canvas` is a warning for any text or table whose box leaves the canvas and info for everything else (`slides/src/validate.ts:329-337`). The numeral's box starts at `y: -30`.
- The existing starter rig validates with `{ measure: false }` and asserts only that there are no errors (`scripts/test-slides-starterdeck.ts:35-37`). The measured checks never run there, and warnings are not counted.
- The CI step comment for the validation rig says the starter "stay[s] silent" (`.github/actions/validate-slides/action.yml:217-220`); with measuring off and warnings uncounted, that is not what is tested.

Still unverified: whether any glyph ink of the numeral actually leaves the canvas. With 300px type on a 1.25 line height the ink probably starts inside the slide; confirm by measuring.

## How others do it

PowerPoint's and Keynote's checkers do not flag decorative text that hangs off the slide; Figma's lint plug-ins let a layer be excluded. Anthropic's skill guidance needs a validator the agent can trust to zero: "run, fix, repeat" only terminates if the reference passes.

## Proposed change

1. Land F-07 first (fields measured as rendered). That removes the three false overflows.
2. Make a deliberate text bleed recognisable without a new format key. In the measured path, compare the rendered ink box of the text (the inner text node's bounding rectangle, which `slides/src/measure.ts` already renders off-screen) with the canvas. If the element's box leaves the canvas but its ink does not, report `out-of-canvas` at info with the wording used for shapes ("fine as a deliberate bleed"). If ink is cropped, keep the warning. Without a DOM, behaviour is unchanged.
3. If the numeral's ink does cross the edge, move it in `starterdeck.ts` so it does not; do not weaken the rule to fit the deck.
4. Tighten the gate: `scripts/test-slides-starterdeck.ts` asserts zero warnings as well as zero errors for the non-measured checks, and a browser rig asserts zero warnings with measuring on.
5. Correct the CI comment so it says what is tested.

Alternative considered: an explicit optional key such as `decorative: true`, which would also let screen readers skip the numeral. It is a format addition and needs upstream's agreement first; raise it separately if the ink rule is not enough.

## Acceptance criteria

- [ ] `(await window.bento.validate()).counts.warning === 0` on the shipped starter in a real browser, with fonts loaded.
- [ ] A text box whose ink is cropped by the canvas edge still produces an `out-of-canvas` warning.
- [ ] A text box that overhangs the canvas with all ink inside produces info, not a warning.
- [ ] `scripts/test-slides-starterdeck.ts` fails if any warning appears in the non-measured checks.
- [ ] The new browser rig fails on the parent commit (six warnings) and passes with the change.
- [ ] No change to the starter's rendered appearance (compare a contact sheet before and after).

## Tests

- Extend `scripts/test-slides-starterdeck.ts` (already registered as "Starter deck rig").
- Add `scripts/test-slides-starter-clean-browser.mjs`: loads the built shell in headless Chromium, waits for `document.fonts.ready`, asserts zero warnings and zero errors. Register in `.github/workflows/ci-slides.yml`.
- Add the cropped-ink and overhang cases to `scripts/test-validate.ts` or to the browser rig, whichever can measure.

## Out of scope

- New validator findings (F-08, F-09); when they land the starter must stay clean, which this gate will enforce.
- Adding slides or features to the starter (SC-02).

## Notes for the implementer

Slides zone. The starter deck travels inside every file, so prefer a validator fix over extra elements. `validate()` runs through the real renderer; measure after fonts are ready or the numbers move.

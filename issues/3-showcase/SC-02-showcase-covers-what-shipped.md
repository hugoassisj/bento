---
id: SC-02
title: "Showcase covers what shipped: builds, a picture with crop and alt text, media, modes, paint layers, booleans"
epic: 3-showcase
type: enhancement
priority: P1
size: M
evidence: seen
labels: [enhancement, "priority:P1", "size:M", "evidence:seen", "area:showcase", needs-upstream-discussion]
depends_on: []
related: [SC-01, SC-03, SC-04, MP-01, DS-06]
upstream: []
---
## Summary

The Showcase is described as the feature tour, and it omits a long list of shipped features: click builds, pictures (so cropping and alt text), video and audio, and most of the 1.3.0 editor (fill and stroke layers, boolean shapes, blend and blur, token modes, lock and hide). The entire 1.3.0 editor is represented by one slide of three text cards. Add the missing features as things a person can see and try, within a byte budget agreed first.

## What the user experiences

A new user pages through the tour and never learns that bullets can appear one at a time, that a picture can be cropped, or that a deck can switch between light and dark. A user who came for the Figma-style editor finds one slide that describes frames, components and tokens in words. An agent that copies patterns from the model deck has no example of a build step, an image with alt text, or a layered fill.

## Reproduce

In the running app on a fresh profile:

```js
const d = window.bento.doc, all = d.slides.flatMap(s => s.elements)
const n = f => all.filter(f).length
({ steps: n(e => e.fx?.step != null), images: n(e => e.type === 'image'), media: n(e => e.type === 'media'),
   alt: n(e => e.alt), fills: n(e => e.fills), strokes: n(e => e.strokes), bool: n(e => e.bool),
   blend: n(e => e.blend), blur: n(e => e.blur || e.backdropFilter), locked: n(e => e.locked), hidden: n(e => e.hidden),
   modes: d.theme.tokens?.modes, layouts: (d.layouts || []).length })
```

Result: every count is 0, `modes` is undefined, `layouts` is 0.

## Evidence

Observed during the audit (inventory of the live starter): 19 slides (4 of them state slides), 336 elements; types are 149 shapes, 122 texts, 56 svgs, 5 charts, 3 code blocks, 1 table; 45 auto-layout frames with 92 children; 40 component members; 18 tokens; 50 gradient fills; motion-path loops, entrances and count-ups present. Absent: any element with `fx.step`, any `image` or `media` element, any `alt`, any `fills` or `strokes` stack, any `bool`, `blend`, blur, `locked` or `hidden`, any token mode, any typewriter effect, any hidden or unnumbered slide, any comment, any saved layout.

Confirmed in code now: `grep -n "step:\|alt:\|modes\|comments" slides/src/starterdeck.ts` finds no build step, alt text, token mode or comment. The design-system slide is built at `slides/src/starterdeck.ts:1423` ("Frames, components, tokens.").

Still unverified: the byte cost of each addition in the compressed shell. Measure each one; see Notes.

## How others do it

PowerPoint's and Keynote's welcome templates walk through each headline feature with a live example on the slide. Figma's starter files are built from the features they teach (auto layout, components, variables) so the file is the tutorial. Penpot's onboarding file does the same for flex layout and tokens.

## Proposed change

Edit `slides/src/starterdeck.ts` only. Prefer reworking existing slides over adding slides.

1. **Builds**: on the "Everything ships inside" slide, give the four right-hand statements consecutive `fx.step` values so they appear one per click. The slide then teaches builds with no new element.
2. **A picture**: one small embedded image (well under 20 KB, public-domain, listed in `scripts/gallery-photos/SOURCES.md` or drawn for the purpose) with a non-trivial `crop` and real `alt` text, on the closing or anatomy slide.
3. **Alt text**: add `alt` to every chart and every meaningful svg; leave pure decoration without it (SC-04 finishes this).
4. **Modes**: add a second token mode ("Dark" or "Light") with different values for the number and font tokens that already exist, and mention the mode switch in the design slide. Theme colours cannot differ per mode today (DS-05, DS-06); do not fake it.
5. **Design slide becomes things to try**: replace the three text cards with one card that carries a two-layer fill (`fills`), one combined shape (`bool`), and one component copy with a visible override, each named in Layers. Keep the frame, the gap token and the three components the starter rig already asserts.
6. **Lock and hide**: lock the full-bleed backdrop on one slide and note it in the tour.
7. **Media**: propose only. A video costs far more bytes than everything else together; describe the option in the PR and let the maintainer decide.

Any new on-slide words are document content, not UI strings; they are not translated today (confirm how the starter's text is localised before adding sentences).

## Acceptance criteria

- [ ] The reproduction snippet reports at least: 4 elements with a step, 1 image with `crop` and `alt`, 1 `fills` stack, 1 `bool`, 1 locked element, 2 token modes.
- [ ] Every chart has `alt`.
- [ ] `window.bento.validate()` still reports zero errors and zero warnings (SC-01).
- [ ] `scripts/test-slides-starterdeck.ts` passes: derive fixed point, every bound token exists and agrees, every copy has a main.
- [ ] Switching the token mode re-renders with no finding and no lost binding.
- [ ] The compressed shell grows by no more than the budget agreed upstream; the PR states the before and after size of `slides/dist-single/Bento_Slides.bento.html`.
- [ ] The deck opens in the previous released shell (1.2.x) without errors; the PR says what that shell draws for the layered fill and the hidden or locked elements.

## Tests

- Extend `scripts/test-slides-starterdeck.ts` with a coverage table: each feature above must appear at least once, so a later edit cannot drop one silently.
- The browser rig from SC-01 keeps the deck clean.
- Present-mode check for the build slide: step through in headless Chromium and assert visibility by `getBoundingClientRect` and computed visibility, not by reading back a style.

## Out of scope

- The in-editor tour and stale notes (SC-03).
- Saved layouts and full binding coverage (SC-04).
- Per-paragraph builds (MP-01); use element steps here.

## Notes for the implementer

Slides zone, one file, but it is the most byte-sensitive file in the app: the starter is embedded in every shell. `docs/DECISIONS.md` ("The slides shell diet", near the end of the file) records how hard the last 136 KB were to win back. Ask upstream for a number before building, hence the label. Old-shell behaviour matters here more than anywhere: a 1.2.x shell draws only the top paint layer and shows hidden elements; say so in the PR.

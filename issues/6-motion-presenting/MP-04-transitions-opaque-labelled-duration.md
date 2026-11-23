---
id: MP-04
title: "Push, zoom and fade keep the outgoing slide opaque; labelled picker; per-slide duration"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:motion", format-change]
depends_on: []
related: [MP-05, MP-12]
upstream: []
---
## Summary

The three non-morph transitions dip through black: mid-flight, both the outgoing and the incoming slide are partly transparent over a black stage, so two white slides flash grey. The picker that chooses them is five icons with no visible names, and there is no way to set how long a transition takes. Make the outgoing slide stay opaque until the incoming one covers it, name the choices, and add an optional per-slide duration.

## What the user experiences

A speaker sets Push between two light slides and presents. Halfway through, the screen is visibly darker than either slide. Fade does the same: it is a fade through black, not a cross-dissolve. Zoom shrinks the old slide over a black field. In the editor the Transition control shows five small pictograms; the speaker cannot tell Push from Zoom without trying each, and cannot slow any of them down.

## Reproduce

1. Fresh load. Start from scratch. Give slide 1 a white background and one shape. Duplicate it three times.
2. Deselect everything. In the Animate tab set slide 2's Transition to the third icon (Push), slide 3 to the fourth (Zoom), slide 4 to the second (Fade).
3. Start the slideshow and press →. Capture the screen about 200–300 ms after each press.
4. Observe: in each capture both slides are dimmed and the black stage shows through. With identical white slides the frame should be plain white.

## Evidence

- Seen in the running app during the motion and presenting journey: six mid-flight frames across push, zoom and fade between identical white slides, all dimmed over black. The montage was re-checked in the main session.
- Confirmed in code now:
  - Non-morph transitions are Reveal's own section transitions. Each section gets `data-transition` from the slide (`slides/src/present.ts:130-132`), and Reveal is configured with `transition: 'fade'`, `transitionSpeed: 'default'`, `backgroundTransition: 'fade'` (`present.ts:748-750`).
  - The stage behind the sections is black: `.bento-present-overlay { background: #000 }` and the same on `.reveal` / `.reveal-viewport` (`slides/src/styles.css:1118-1127`).
  - Slide backgrounds are painted inside the section by the renderer, because Reveal's background layer is stubbed out (`slides/reveal-lite.ts`, `controllers/backgrounds.js`). So when Reveal fades a section's opacity, the slide's own background fades with it and black shows through. `backgroundTransition` has nothing to act on.
  - The picker is `segmented(['none','fade','slide','zoom','morph'], …)` with an icon per value and an `aria-label` of "Transition" on the group (`slides/src/editor/inspector/slide.ts:181-185`). Whether each segment has a tooltip was not checked; the journey saw no visible labels.
  - `TransitionKind` is `'none' | 'fade' | 'slide' | 'zoom' | 'morph'` (`slides/src/model.ts:9`). There is no duration key on `Slide`.
- Not verified: the exact Reveal CSS rules involved. Read the built `reveal.css` after `trimRevealCss` (`slides/reveal-lite.ts`) before writing overrides.

## How others do it

- **Keynote**: Push keeps both slides fully opaque and moves them; Dissolve is a true cross-dissolve; every transition has Duration and Direction, and the list shows names with a preview.
- **PowerPoint**: a labelled gallery, a Duration field, Effect Options for direction, and Preview.

## Proposed change

1. **Opaque outgoing slide** (`slides/src/styles.css`, scoped to `.bento-present-overlay .reveal`):
   - Fade: the incoming section fades in **over** the outgoing one, which stays at opacity 1 underneath and is hidden only when the transition ends. In CSS terms the leaving section's opacity change is delayed by the transition duration instead of animated.
   - Push (`slide`): both sections stay at opacity 1 and translate.
   - Zoom: the incoming section scales in over an opaque outgoing section.
   - Backward navigation must be the mirror image, so cover both the `.past` and `.future` leaving states.
   - Reduced motion (the `M` toggle and `prefers-reduced-motion`) must still collapse to an instant cut.
2. **Named picker** (`slides/src/editor/inspector/slide.ts`): show the name of each transition. Either a caption under each icon or a text label beside the selected one plus a tooltip on every segment. Names through `t()`: None, Fade, Push, Zoom, Morph.
3. **Per-slide duration**: a new optional key

   ```
   Slide.transitionSeconds?: number    // absent = the default for that transition
   ```

   clamped to 0.1–6 s, applied to the incoming section as a CSS custom property that the overrides in (1) read. A "Duration" number field appears under the picker when the transition is not None. MP-05 uses the **same key** for Morph; whichever issue lands first adds it, with this definition.
   - Add to `model.ts`, the slide checks in `untrusted.ts`, regenerate model keys and schema.
   - **Old shells** ignore the key and play the transition at the default speed. Nothing breaks.

Rejected: painting slide backgrounds on Reveal's background layer (it is deliberately stubbed and cannot be re-enabled by a document); replacing Reveal's transitions with the in-house animation engine (larger, and morph already covers the rich case).

## Acceptance criteria

- [ ] Between two identical white slides, with Push, Zoom and Fade in turn, a frame sampled at 25%, 50% and 75% of the transition has no pixel darker than the slide background inside the slide's rect (measure from a screenshot, not from styles).
- [ ] Push: at 50% the outgoing and incoming sections' `getBoundingClientRect()` are side by side and both have computed opacity 1.
- [ ] Going backward (←) behaves as the mirror image and also never shows black inside the slide rect.
- [ ] With reduced motion on, every transition is an instant cut.
- [ ] Each transition's name is visible or available as a tooltip, in every catalog; the group and each option have accessible names.
- [ ] `transitionSeconds: 2` on a Fade slide makes the incoming section reach opacity 1 at 2 s ± 0.1 s (sample `getComputedStyle(...).opacity` over time or the section's `getAnimations()`), and absent means today's speed.
- [ ] Morph slides are unaffected by this change.
- [ ] Model keys and schema checks pass; an old-shell note is in the model comment.

## Tests

- Add `scripts/test-slides-transitions-browser.mjs` (register in `.github/workflows/ci-slides.yml`): two white slides, each transition, screenshot at three points, assert the minimum luminance inside the slide rect; assert rect positions for Push; assert the duration key. It must fail on the parent commit for the luminance case.
- Check `document.visibilityState === 'visible'` at the start of the rig; a hidden tab throttles animation frames to zero.

## Out of scope

- Morph timing (MP-05).
- Direction options for Push, and new transition kinds.
- Playing a transition on the canvas (MP-12).

## Notes for the implementer

- Slides app only. `slides/reveal-lite.ts` prunes Reveal's CSS at build time and fails the build if a pruning pattern stops matching: do not add rules that depend on pruned selectors, and run `npm run build:single`.
- `viewDistance: 2` exists so adjacent sections stay mounted for these transitions (`present.ts` config comment); keep it.
- The live audience follows by slide index; nothing here changes the broadcast.

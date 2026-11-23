---
id: MP-05
title: "Morph duration and easing per slide"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:motion", format-change]
depends_on: []
related: [MP-04, MP-12]
upstream: []
---
## Summary

Morph is the product's signature transition and it has one speed and one curve for the whole deck. The speed can only be changed by hand-editing `present.morphSeconds` in the file; the curve cannot be changed at all. Add Duration and Easing to the slide's Animate tab, stored per slide, inheriting the deck default.

## What the user experiences

A speaker wants the title morph to land slowly and the next three morphs to be quick. The Animate tab shows the transition picker, a pairing status line, a scrub slider and Play transition, but nothing about time. Every morph in the deck takes 0.65 s with the same ease-in-out.

## Reproduce

1. Fresh load of the Showcase deck. Select slide 4 ("Morph."), deselect all elements, open the Animate tab.
2. Look for a duration or easing control for the slide's transition: there is none.
3. In the browser console: `window.bento.doc.present` — no `morphSeconds` unless hand-written.

## Evidence

- Reported by the motion and presenting journey as read in code plus the absence of any control in the panel. Confirmed in code now:
  - `MORPH_DURATION_DEFAULT = 0.65`, `MORPH_EASE = 'power2.inOut'`, `MORPH_SPRING = 'spring'` are module constants (`slides/src/present.ts:28-33`).
  - The only input is deck-wide: `MORPH_DURATION = clamp(doc.present?.morphSeconds ?? default, 0.1, 6)` (`present.ts:92`).
  - `MORPH_EASE` is passed to the morph tweens directly (`present.ts` ≈2400, 2446, 2477, 2486, 2499). `MORPH_SPRING` drives the symbol-level travel of maths and code morphs (≈2290).
  - `morphSeconds` and `typeWriterSeconds` are declared in `slides/src/model.ts` (≈811, 816) and the schema (`slides/src/schema.ts:114-115`). A search of `slides/src` finds **no editor code** that reads or writes either.
  - The engine's ease table is fixed: `none`, `linear`, `power1|2|3.in|out|inOut`, `sine.in|out|inOut`, `spring` (`kernel/src/anim.ts:30-39`).
- The editor's Play transition waits a fixed 700 ms before stepping (`slides/src/editor/editor.ts`, `playTransition`, the `setTimeout(() => show.goTo(here), 700)` line; recorded as a known ceiling in `docs/DECISIONS.md`). That wait is for the show to settle, not for the morph, but check it when durations grow.

## How others do it

- **Keynote**: Magic Move has Duration and Acceleration (None, Ease In, Ease Out, Ease In & Out), plus Match by object, word or character.
- **PowerPoint**: Morph has a Duration field in the Transitions tab.
- **Figma**: Smart Animate takes an easing preset or spring and a duration per interaction.

## Proposed change

Two optional keys on `Slide`, read when the show **arrives** at that slide by a morph:

```
Slide.transitionSeconds?: number     // absent = present.morphSeconds, else 0.65
Slide.transitionEase?: string        // absent = 'power2.inOut'; one of the engine's ease names
```

`transitionSeconds` is the same key MP-04 defines for the other transitions; whichever issue lands first adds it, with one definition.

- **`slides/src/present.ts`**: resolve duration and ease per transition at the point the morph for a slide pair is built, instead of reading the module constants. Going backward uses the keys of the slide being left, mirroring how the code already decides morph direction (`present.ts` ≈1392-1393). Clamp the duration 0.1–6 s as today. An ease name not in the engine's table falls back to the default; never pass a document string through unchecked.
- **Symbol morphs** (maths, code): keep `MORPH_SPRING` for symbol travel but scale to the resolved duration.
- **`slides/src/editor/inspector/slide.ts`** (or the Animate slide panel where the picker lives): when the transition is Morph, show **Duration** (seconds, placeholder shows the inherited value) and **Easing** (a select: Ease in & out, Ease out, Ease in, Linear, Spring, mapping to engine names). Add a **Deck default** duration field in the Deck section writing `present.morphSeconds`, so the existing key finally has a control.
- **The scrub preview** in the editor should use the same resolved ease so what is scrubbed is what plays (find the preview's stepper in `slides/src/editor/morph.ts` and `fxpreview.ts`).
- **Format**: add both keys to `model.ts`, slide checks in `untrusted.ts` (ease restricted to the known names), regenerate model keys and schema.
- **Old shells** ignore both keys and morph at the deck speed with the default curve.
- **Strings** in every catalog: Duration, Easing, the five ease names, Deck default.

Rejected: per-element duration (multiplies the UI and the format for a rare need; revisit after this lands); free-form cubic-bezier input (a document string reaching the animation engine needs a gate and a parser).

## Acceptance criteria

- [ ] A slide with `transitionSeconds: 2` morphs in 2 s ± 0.1 s: step the engine with `window.bento.anim.setManual(true)` and `tick()` and read a paired element's `getBoundingClientRect()` at t = 0, 1 s, 2 s; it reaches its final rect at 2 s and not before.
- [ ] With `transitionEase: 'linear'` the element is at the geometric midpoint at half time (± 2 px); with the default it is not.
- [ ] A slide without the keys morphs exactly as before (same rects at the same ticks as the parent commit).
- [ ] `present.morphSeconds` still sets the deck default and is now editable in the Deck section.
- [ ] An unknown ease string in a file is dropped by the gate and reported in the load report; the show uses the default.
- [ ] The editor's scrub slider follows the chosen ease.
- [ ] Going backward uses the leaving slide's keys.
- [ ] Model keys and schema checks pass; old-shell behaviour is stated in the model comment.

## Tests

- Add `scripts/test-slides-morph-timing-browser.mjs` (register in `.github/workflows/ci-slides.yml`): a two-slide deck with one paired rectangle moving 600 px; manual engine ticks; rect assertions for duration and for linear versus default ease; the no-keys control.
- Extend the gate rig that covers slide keys (find it with `grep -l "SLIDE_CHECKS" scripts/`) with the unknown-ease case.
- `scripts/test-slides-morph-render-browser.mjs` already exercises morph rendering; make sure it still passes.

## Out of scope

- Duration for Push, Zoom and Fade (MP-04).
- Per-element timing, delays, and morph matching rules.
- Replacing Play transition's fixed 700 ms settle (a recorded ceiling; MP-12 addresses playing in place).

## Notes for the implementer

- Slides app only. Do **not** change `kernel/src/anim.ts`; the ease table there is enough. If a new ease is wanted, that is a separate kernel-zone issue.
- Reading back `style.transform` is not a measurement. Use rects after `tick()`.
- `present.ts` is large and frequently edited; keep the change to the duration and ease lookups.

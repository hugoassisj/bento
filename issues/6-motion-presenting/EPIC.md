---
id: EPIC-6
title: "Epic 6 · Motion and presenting"
epic: 6-motion-presenting
type: epic
labels: [epic, "area:motion", "area:present", "area:export"]
---
## Goal

A speaker can build a slide's reveals the way they do in Keynote or PowerPoint, tune and preview motion without entering the show, trust the live toolkit in front of a room, and hand the deck out afterwards without leaking anything.

## Why it matters

Morph and the speaker view are the reasons people pick this app for a talk, and both got stronger in 1.3.0 (pairing status line, on-canvas ghost and path, scrub slider, "Morph with" picker). The audit found the weak points around them:

- **Builds are number-typing.** One step per element, so a bullet list cannot build one line at a time; no list of the build order; the only on-canvas control collides steps instead of reordering.
- **Motion cannot be tuned.** Morph has one speed and one curve for the whole deck; push, zoom and fade dip through black; nothing but entrances previews on the canvas.
- **The live toolkit has holes.** The black screen eats clicker presses; stray library keys dim the screen or bypass builds; there is no help in the show and no way to jump to a slide from the main window; the speaker view ignores builds.
- **Sharing after the talk leaks.** The "sealed hand-out" carries speaker notes, comments and hidden slides.

Evidence for every item is in its own file. Most was reproduced in the running 1.3.0 app; each file says which parts were seen and which were only read in code.

## Children, in recommended order

Take the P0 first, then bugs, then the rest by priority. MP-11 to MP-19 are listed from the index; open their files for detail.

- [ ] **MP-06** · Present-only export: choose whether notes, comments and hidden slides are included — bug, P0, S
- [ ] **MP-07** · Black screen swallows the clicker — bug, P1, S
- [ ] **MP-03** · Clicking a step badge to reorder leaves two elements on the same step — bug, P2, S
- [ ] **MP-01** · Bullets build one at a time (per-paragraph steps) — P1, M, format change
- [ ] **MP-10** · Speaker view: build steps, notes font size, timer pause and countdown — P1, M
- [ ] **MP-14** · PDF export options: a page per click step, notes pages, background quality — P1, M
- [ ] **MP-02** · Build order list in the Animate tab — P1, L
- [ ] **MP-08** · In-show help sheet; `?` dims the screen today; retire stray Reveal keys — P2, S
- [ ] **MP-09** · Jump to a slide from the audience window: grid overlay, number then Enter — P2, M
- [ ] **MP-04** · Push, zoom and fade keep the outgoing slide opaque; labelled picker; per-slide duration — P2, M, format change
- [ ] **MP-05** · Morph duration and easing per slide — P2, M, format change
- [ ] **MP-11** · Laser pointer from the speaker view — P2, M
- [ ] **MP-12** · Play slide in place — P2, M
- [ ] **MP-13** · Hover reveal: one picker that writes all three settings, with a status line — P2, M
- [ ] **MP-16** · Slide sections in the slide list — P2, M, format change, needs upstream discussion
- [ ] **MP-15** · Present from the beginning; Present from here — P3, S
- [ ] **MP-17** · Rehearse mode and timed auto-advance — P3, M, format change
- [ ] **MP-18** · Audience view in its own window for a second monitor — P3, M
- [ ] **MP-19** · Present mode on touch: visible exit and next; no silent exit on over-swipe — P3, S

## Dependencies and collisions

- **MP-03 before MP-02.** The list makes the step numbering visible; fix the badge semantics first.
- **MP-01 feeds MP-02, MP-10 and MP-14.** Once an element can occupy several steps, the build list, the speaker previews and one-page-per-step printing must all use the same helper (`spanOf` / `maxStep` in `slides/src/steps.ts`).
- **MP-04 and MP-05 share one new key**, `Slide.transitionSeconds`. Whichever lands first adds it; the definition is written identically in both files.
- **MP-08 before MP-09.** MP-08 decides who owns the keyboard in the show; MP-09 adds G, O and digits on top.
- **MP-06 and MP-14** should offer the same choices (notes, comments, hidden slides) with the same wording.
- **One file, many issues.** MP-01, 04, 05, 07, 08, 09, 10, 11, 12, 18 and 19 all edit `slides/src/present.ts` (about 2,700 lines). Do not run them in parallel on that file without splitting by function first; where an issue suggests extracting a module (the show grid, the build list), do the extraction as its own small first commit.
- **Kernel zone.** None of these needs a change to `kernel/src/anim.ts`. If one seems to, stop and split it out.
- **Reveal is partly stubbed.** `slides/reveal-lite.ts` replaces Reveal controllers at build time and prunes its CSS; a stubbed feature cannot be switched on from config and the build fails if a stub or pruning pattern stops matching.
- Outside this epic: the Check deck panel (F-10) is where a "this slide's hover is off" or "two elements share a step" hint could also surface; the Assistant epic (AS-06) wants the same command registry these keys should come from.

## Format additions in this epic

All optional, all ignored by older shells, each to be stated in `slides/src/model.ts` with its old-shell behaviour and followed by regenerating the model keys and schema:

| Key | Issue | An older shell does |
|---|---|---|
| `fx.stepBy: 'paragraph'` | MP-01 | reveals the whole text box at its step |
| `Slide.transitionSeconds` | MP-04, MP-05 | plays the transition at the default speed |
| `Slide.transitionEase` | MP-05 | uses the default curve |
| sections, timings | MP-16, MP-17 | see those files |

## Definition of done for the epic

- A three-bullet list builds on three clicks from one text box, and the build order of any slide can be read and rearranged in one list.
- No transition shows black inside the slide area between two light slides; a slide's transition has a name and a duration in the panel.
- In the show: a black screen never loses the speaker's place; `?` shows Bento's own keys; no key dims the screen or bypasses builds; G and "number, Enter" jump to a slide from the main window.
- The speaker view's current and next panes match what the audience sees and will see next.
- A present-only file saved with the defaults contains no speaker notes, comments or hidden slides.
- Every child has a rig registered in CI, bug rigs were shown failing on the parent commit, all new strings are in every catalog, and each format addition documents its old-shell behaviour.

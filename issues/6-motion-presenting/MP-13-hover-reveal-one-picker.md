---
id: MP-13
title: "Hover reveal: one picker that writes all three settings, with a status line"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:motion"]
depends_on: []
related: [F-09, F-10, MP-12]
upstream: []
---
## Summary

A hover reveal ("show this when the pointer is on that") needs three separate settings in two places, two of them free-text names that must match exactly. Set one or two of the three and the editor looks configured while the show does nothing. Replace the free-text pair with one picker that writes all three keys, and add a status line that says when the slide's hover behaviour is off.

## What the user experiences

A first-timer wants a detail card to appear when the audience pointer is on a rectangle. They select the card, open Interact, and see "Show on hover of" with an empty text field. They type "Rectangle" (the layer's name). The canvas grows a "Hover set:" chip bar, which reads as success. In the show, hovering the rectangle does nothing.

What was actually required:

1. On the trigger: type a name in "Hover group".
2. On the target: type the same name in "Show on hover of".
3. On the slide (nothing selected, Format tab): set "On hover" to "Switch content".

Nothing tells them steps 1 or 3 are missing. The field accepts any text, including a layer name, which is not a hover group.

## Reproduce

1. Start from scratch. Add a rectangle and a text box.
2. Select the text box, open the Interact tab, type `Rectangle` into "Show on hover of", press Enter.
3. Observe: a "Hover set:" bar with a `Rectangle` chip appears above the stage.
4. Start the slideshow and move the pointer over the rectangle. Nothing changes.
5. Exit. Select the rectangle, type `Rectangle` into "Hover group". Present again: still nothing.
6. Exit. Deselect, and in the slide's Format tab set "On hover" to "Switch content". Present: hovering the rectangle now shows the text box.

## Evidence

Observed in the running app (audit journey 3): steps 2 to 6 as written.

Confirmed in code at `29b5c80`:

- The model keeps the three settings apart: `showOnHover?: string` on the target (`slides/src/model.ts:128-132`), `group` on the trigger, and `hover?: { type: 'focus-group' | 'reveal'; dim?; default? }` on the slide (`slides/src/model.ts:695-699`).
- The Interact tab offers two plain text inputs: "Show on hover of" (`slides/src/editor/inspector/animate.ts:496-509`, placeholder "always visible") and "Hover group" (`slides/src/editor/inspector/animate.ts:511-521`). Neither validates against the other or against the slide.
- The slide-level control is a select in a different inspector module: "On hover" with None / Dim other groups / Switch content (`slides/src/editor/inspector/slide.ts:232-238`).
- The show wires hover only when the slide has it: `wireHoverFocus` returns at once if `!slide.hover` (`slides/src/present.ts:1985-1986`), and the reveal set is applied only when `slide.hover?.type === 'reveal'` (`slides/src/present.ts:141`). Triggers are matched by `[data-group]` (`slides/src/present.ts:2004-2007`).
- The canvas draws the "Hover set:" bar from the sets alone (`slides/src/editor/canvas.ts:1465-1486`), regardless of whether the slide's hover is on or any element carries the matching group. That bar is the false signal.
- The tooltips do explain the dependency (`slides/src/editor/inspector/controls.ts:33`, `:55`, `:56`), but only on hover of the row label.
- `slides/src/validate.ts` has no finding for an unmatched hover set.

## How others do it

- **Figma**: drag a connector from the trigger, choose "While hovering" and the destination; one gesture, one visible arrow.
- **Penpot**: an interaction is a trigger ("Mouse enter") plus an action, shown as a connector on the canvas.
- **PowerPoint**: a trigger is picked from a list of the slide's objects ("On Click of ▸ Rectangle 3"), never typed.
- Bento's own morph UI already does this well: a status line says "Pairs with Slide 1 · Rectangle, but this slide uses Fade — Use Morph" with a one-click fix.

## Proposed change

Slides app only. No format change: the three existing keys stay as they are.

1. **Picker instead of free text.** In `slides/src/editor/inspector/animate.ts`, replace the "Show on hover of" input with an element picker listing the slide's other elements by their Layers names (reuse the "Morph with" picker pattern in the same file, and the token picker's keyboard behaviour). Choosing an element:
   - gives the chosen trigger a `group` if it has none (derive a readable unique name from its layer name),
   - sets the target's `showOnHover` to that group,
   - sets `slide.hover = { type: 'reveal' }` if the slide has no hover, and leaves an existing `reveal` alone.
   All three writes are one undo step.
2. **Conflict handling.** If the slide's hover is `focus-group`, do not overwrite it silently: show the status line with a "Switch to Switch content" action.
3. **Status line** under the picker, in the morph style:
   - "Shows while the pointer is on *Rectangle*."
   - "This slide's hover is off — Turn on."
   - "Nothing on this slide is in the group *x* — Pick the trigger."
4. **Keep the advanced path.** "Hover group" stays as a text field under an Advanced fold for people who share one group across several triggers.
5. **Honest set bar.** In `canvas.ts renderSetBar`, mark a set whose group no element carries, or whose slide hover is off, with a warning style and the same action.
6. **Validator.** Add two warnings to `slides/src/validate.ts`: `hover-set-unreachable` (a `showOnHover` value no element's `group` matches) and `hover-off` (elements carry `showOnHover` but the slide's `hover` is absent or not `reveal`). Agents hit the same trap.

New strings go through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] Picking a trigger from the list makes the reveal work in the show with no other step, on a slide that had no hover settings.
- [ ] The three writes undo as one step.
- [ ] The picker lists elements by layer name and never shows ids.
- [ ] On a slide whose hover is "Dim other groups", picking a trigger does not change the slide setting without the user pressing the offered action.
- [ ] The status line states the true state in each of: working, slide hover off, no element in the group.
- [ ] The "Hover set:" bar flags an unreachable set.
- [ ] `window.bento.validate()` reports `hover-set-unreachable` and `hover-off` on the corresponding documents and nothing on a correct one.
- [ ] Existing decks with hand-typed groups open and behave unchanged.

## Tests

- Node rig `scripts/test-slides-hover-reveal.ts`: the validator findings on three fixture documents (correct, unmatched set, slide hover off). Register at the end of `.github/actions/validate-slides/action.yml`.
- Browser rig `scripts/test-slides-hover-picker-browser.mjs`: build two elements, use the picker with real mouse input, assert the three keys in `window.bento.doc`, present, hover the trigger with `page.mouse.move`, and assert the target's rendered opacity by `getComputedStyle(...).opacity` after the 180 ms transition. Register in `.github/workflows/ci-slides.yml`. `scripts/test-slides-hover-steady-browser.mjs` is the nearest existing rig.

## Out of scope

- Click-triggered reveals (the "Link to a new variant of this slide" path already covers that).
- Connectors drawn on the canvas between trigger and target.
- Changing the model to a single key.

## Notes for the implementer

- Hot files: `slides/src/editor/inspector/animate.ts`, `slides/src/editor/inspector/slide.ts`, `slides/src/editor/canvas.ts`, `slides/src/validate.ts`.
- New validator codes must be documented wherever finding codes are listed for agents (see AI-02).
- `group` here is the hover group, not ⌘G grouping (`groupId`). The tooltip at `controls.ts:56` says so; keep that distinction visible in the new UI.

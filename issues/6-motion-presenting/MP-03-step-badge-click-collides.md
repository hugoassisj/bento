---
id: MP-03
title: "Clicking a step badge to reorder leaves two elements on the same step"
epic: 6-motion-presenting
type: bug
priority: P2
size: S
evidence: mixed
labels: [bug, "priority:P2", "size:S", "evidence:mixed", "area:motion"]
depends_on: []
related: [MP-02]
upstream: []
---
## Summary

Clicking a numbered step badge on the canvas is the only on-canvas way to change the build order. It does not reorder: it walks that one element through the step numbers, and when it wraps to 1 it lands on a step another element already holds. The slide now reveals two things on one click and has a hole later in the sequence, with no message. The code does this on purpose; the behaviour is wrong for what users use the badge for.

## What the user experiences

Three boxes are numbered 1, 2, 3. The speaker wants the third to come first and clicks its badge. It becomes "1". The first box still shows "1". Step 3 no longer exists. In the show, the first press reveals two boxes together and the build is one click shorter than intended. The tooltip ("click for the next step") does not warn that the element will join another's step.

## Reproduce

1. Fresh load. Start from scratch. Add three text boxes.
2. Select all three, Animate ▸ Reveal ▸ **In order**: badges read 1, 2, 3.
3. Click the badge "3" once.
4. Observe: that badge reads **1**; the first box's badge also reads **1**; no badge reads 3.
5. Start the slideshow: the first → reveals two boxes, the second → reveals the last, the third → leaves the slide.

## Evidence

- Seen in the running app during the motion and presenting journey; the screenshot was checked in the main session (two badges reading 1, tooltip "Reveal step 1 — click for the next step; set the number in Presenting").
- Confirmed in code now. The badge click handler calls `cycleStep` and writes the result to that element only (`slides/src/editor/stepbadges.ts:52-59`). `cycleStep` is:

  ```
  const top = maxStep(others) + 1
  return cur >= top ? 1 : cur + 1          // slides/src/editor/reveal.ts:71-76
  ```

  With others on 1 and 2 and the clicked element on 3, `top` is 3, `cur >= top`, so it returns 1. No other element is renumbered. The file's comment states the intent: "walks the element through the slide's steps: 1, 2, … up to one past the last step anyone else has, then back to 1".
- The tooltip text also points at a panel section that no longer exists by that name: it says "set the number in Presenting" (`stepbadges.ts:48`), while the control lives in the **Animate** tab since 1.3.0. Confirm the current tab label before changing the string.

So this is designed behaviour that produces a result users read as a bug. Sharing a step is a real feature ("Give several elements the same step to reveal them together", `editor/inspector/animate.ts:413`), but it should be chosen, not stumbled into.

## How others do it

- **Keynote** and **PowerPoint**: order is changed by dragging a row in the build list; two builds only play together when the user sets "With previous". A click on an order marker selects the object, it never renumbers.

## Proposed change

Make a badge click **swap**, never collide.

- `slides/src/editor/reveal.ts`: replace `cycleStep` with `advanceStep(slide, el): StepPatch[]`:
  - Compute the distinct steps on the slide in ascending order.
  - Move the clicked element to the next distinct step position; the element or group that held that position takes the clicked element's old step. Wrapping from the last position goes to the first, again as a swap.
  - If the clicked element shares its step with others, it leaves the group and takes a new step directly after it, and later steps shift up by one, so nothing ends up sharing by accident.
  - Always return a contiguous 1..k numbering.
- `slides/src/editor/stepbadges.ts`: apply all patches in one `store.commit`, keep the selection on the clicked element.
- Joining a step on purpose stays available through Reveal ▸ **Together** and by typing the number.
- Update the tooltip: "Reveal step {n} — click to move it later; set the number in Animate". Catalog entries for the old string must be replaced in every language file (the dead-key check fails otherwise).
- Shift-click moves it earlier (optional; only if it costs a few lines).

Rejected: keeping the cycle and adding a toast (still leaves a broken sequence); removing the click (it is the only on-canvas affordance until MP-02 lands).

## Acceptance criteria

- [ ] Starting from steps 1, 2, 3 on elements A, B, C, one click on C's badge gives C=1, A=2, B=3 or another documented swap result, with **no two elements sharing a step and no missing number**.
- [ ] Repeated clicks walk the element through every position and back without ever creating a duplicate.
- [ ] Clicking the badge of one of two elements that share a step separates them and keeps the sequence contiguous.
- [ ] The change is one undo step.
- [ ] Reveal ▸ Together still puts a selection on one step.
- [ ] The tooltip names the tab that actually holds the control, in every catalog.
- [ ] `scripts/test-slides-reveal-ui.ts` passes with the new function and fails on the parent commit for the duplicate-step case.

## Tests

- Extend `scripts/test-slides-reveal-ui.ts` (node; registered in `.github/actions/validate-slides/action.yml`): property test over random small slides — after any number of `advanceStep` calls the steps are exactly `1..k` and only groups that were created by `revealTogether` share a step. Record that the duplicate case fails before the fix.
- The existing assertions on `cycleStep` in that rig must be rewritten, not deleted; note in the PR which ones changed and why.

## Out of scope

- The Build order list (MP-02), which replaces most uses of the badge.
- Per-paragraph ranges on the badge (MP-01).

## Notes for the implementer

- Slides app only, two small files plus eight catalogs.
- `reveal.ts` is DOM-free by design so the node rig can drive it; keep it that way.
- Check `scripts/test-slides-reveal-preview-browser.mjs` in case it clicks a badge and asserts the old cycle.

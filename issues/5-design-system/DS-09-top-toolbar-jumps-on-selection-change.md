---
id: DS-09
title: "Top toolbar jumps sideways when the selection changes"
epic: 5-design-system
type: bug
priority: P2
size: S
evidence: mixed
labels: [bug, "priority:P2", "size:S", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-10]
upstream: []
---
## Summary

The insert tools in the middle of the top bar shift left when two or more closed shapes are selected, because the four boolean buttons appear at the end of the group and the group is re-centred. The Move tool moved from x=510 to x=427 in the audit. A toolbar that moves under the pointer makes every tool a moving target.

## What the user experiences

They select three rectangles and reach for the Text tool where it was a second ago. It is 83px further left; they hit a different tool, or nothing.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 at 1440×900.
2. Note the screen position of the Move tool (first tool in the middle group).
3. Press R and draw a rectangle; repeat twice so there are three.
4. Drag a marquee over all three.

Observed: four boolean buttons appear after the Comment tool and every tool in the group shifts left (Move tool x 510 → 427 at this window size).
Expected: tools that were on screen do not move when the selection changes.

## Evidence

- **Seen in the running app (design-features journey):** positions above; screenshot `05-three-selected.png` in the audit.
- **Confirmed in code now:**
  - `slides/src/editor/editor.ts:458-483`: `boolBar` is appended to the `insert` group and toggled with `boolBar.hidden` on every `selection`, `doc` and `current` event (`syncBool`, `:471-481`). The path bar is appended right after it (`:484`).
  - The comment at `:458-459` records the intent: "present only while two or more closed shapes are selected — never greyed out, simply not there." That intent stays.
  - `slides/src/styles.css:3589-3593`: the left zone and the right zone are both `flex: 1 1 0`, which centres the insert group between them. Any change in the group's width therefore moves every tool in it.

## How others do it

- **Figma:** boolean operations live in a fixed dropdown in the toolbar; contextual actions appear in a separate floating bar near the selection.
- **Penpot:** the boolean bar is contextual, but it sits in the design panel, not in the main toolbar.
- **Canva and Figma Slides:** contextual actions float beside the selection; the main toolbar never reflows.
- **PowerPoint:** contextual tabs (Shape Format) appear at the end of the ribbon; existing tabs do not move.

## Proposed change

Keep the contextual bars, but take them out of the centring calculation so the permanent tools never move.

1. In `editor.ts`, stop appending `boolBar` and `this.pathBar()` into `insert`. Put them in one wrapper (for example `div('ed-insert-ctx')`) that is a child of `insert` but positioned out of flow: `position: absolute; inset-inline-start: 100%; top: 0; height: 100%; display: flex`.
2. In `styles.css`, make `.ed-topbar .ed-insert` `position: relative`, and give `.ed-insert-ctx` the hairline and padding the group already uses so it reads as an extension of the bar.
3. Guard against overlap with the right zone: when the space between the insert group's end and the right zone's start is smaller than the contextual wrapper, fall back to a compact form (a single "Combine" button opening a small menu of the four operations). Compute with `getBoundingClientRect` inside `fitTopbar()`, which the bar's `ResizeObserver` already calls (`editor.ts:713`) and which applies the `ed-bar-compact` / `ed-bar-tight` / `ed-bar-fold` tiers (`editor.ts:1007`); also re-run it from `syncBool`.
4. Right-to-left: use logical properties only.

No new strings unless the compact fallback is built (then one: "Combine shapes" already exists as the group's label at `editor.ts:462`).

Alternatives rejected: reserving the space with `visibility: hidden` (wastes about 150px of every toolbar); greying the buttons (contradicts the recorded intent).

## Acceptance criteria

- [ ] The Move tool's `getBoundingClientRect().left` is identical (within 0.5px) with nothing selected, one shape selected, three shapes selected, and a path selected.
- [ ] The boolean buttons still appear only when the selection has valid operands, and still show disabled with the reason for a selection containing a line or open path.
- [ ] Keyboard order is unchanged: the contextual buttons come after the Comment tool in tab order.
- [ ] At a 1024px-wide window the contextual bar does not overlap the right zone; it collapses to the compact form instead.
- [ ] Correct in a right-to-left UI language.

## Tests

Extend `scripts/test-slides-steady-chrome-browser.mjs` (it exists to keep chrome from moving): record the left edge of the first insert tool, select three rectangles with real mouse input (`MouseEvent`s; synthetic pointer events do not drive the canvas), wait a frame, compare. Add the 1024px case. It must fail on the parent commit. The rig is already registered; confirm with `node scripts/test-ci-registered.ts`.

## Out of scope

- A floating contextual bar next to the selection (a larger design; raise it as its own issue if wanted).
- Changing which operations are contextual.

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/editor.ts` (top bar construction around `:440-490`), `slides/src/styles.css` (topbar zones around `:3583-3594`).
- `docs/DECISIONS.md` records the topbar zones and the fold behaviour in the 1.3.0 entries (search "TOPBAR ZONES" in `styles.css` for the rationale comment). Do not change the three-zone model.
- `scripts/test-slides-chrome-polish-browser.mjs` and `scripts/test-slides-chrome-rulings-browser.mjs` assert other topbar rules; run them.

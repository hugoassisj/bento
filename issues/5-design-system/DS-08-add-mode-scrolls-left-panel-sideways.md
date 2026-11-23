---
id: DS-08
title: "Add mode scrolls the left panel sideways and clips headings"
epic: 5-design-system
type: bug
priority: P2
size: S
evidence: mixed
labels: [bug, "priority:P2", "size:S", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-05]
upstream: []
---
## Summary

Clicking **+** beside the mode chips in the Tokens tab shifts the whole left panel about 37px to the left. Section headings lose their first letters ("OLORS", "UMBERS"), swatches are cut off, and the panel stays shifted until it is rebuilt.

## What the user experiences

The moment they try to add a mode, the panel looks broken: every row is cropped on the left edge. There is no horizontal scrollbar to drag it back.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 at a 1440×900 window.
2. Left panel, third tab (Tokens).
3. Click the **+** to the right of the "Default" mode chip.

Observed: an input appears in the header and the panel content jumps left; headings read "OLORS", "UMBERS". Typing a name and pressing Enter rebuilds the panel and the offset usually disappears; pressing Escape may leave it.
Expected: the name field appears without moving anything else.

## Evidence

- **Seen in the running app (design-features journey):** screenshot recorded as `19-add-mode.png` in the audit; offset measured at roughly 37px. The journey also noted that the Default and Dark chips are hard to tell apart when active.
- **Confirmed in code now (mechanism is a hypothesis, the pieces are real):**
  - `slides/src/editor/tokenspane.ts:375-391`: the **+** button is replaced by `inlineName(...)` and then `field.focus()` is called (`:390`).
  - `tokenspane.ts:68-71`: that field is an `<input class="ed-token-name ed-token-new">`.
  - `slides/src/styles.css:3134-3136`: `.ed-tokens-head` is a flex row with `justify-content: space-between`; `.ed-tokens-modes` (`:3199`) is `flex-wrap: wrap`.
  - `styles.css:3210`: `.ed-token-name { flex: 1; min-width: 0; ... }` gives no upper bound inside the header.
  - `styles.css:384-389`: `.ed-sidebar` has `overflow-x: hidden`. A hidden overflow can still be scrolled by script, and focusing an element that overflows scrolls its container to reveal it.
- **Not verified:** that the focus scroll is the cause. Confirm by reading `sidebar.scrollLeft` after step 3 before fixing.

## How others do it

Figma and Penpot both add a mode or theme through a field that occupies its own row or a popover; neither resizes the panel header.

## Proposed change

1. Confirm the cause: log `document.querySelector('.ed-sidebar').scrollLeft` before and after the click.
2. Make the header unable to overflow: in `styles.css`, give the new-mode field a bounded width inside `.ed-tokens-modes` (`flex: 0 1 120px; max-width: 100%`) so it wraps onto its own line when there is no room.
3. Focus without scrolling: `field.focus({ preventScroll: true })` at `tokenspane.ts:390`, and the same for the other inline fields in this file that sit in a header (`:344`, `:138`).
4. Make sideways scrolling impossible: change `.ed-sidebar` from `overflow-x: hidden` to `overflow-x: clip` (clip cannot be scrolled programmatically). Check `scrollbar-gutter: stable` still behaves and that nothing relies on `scrollLeft`.
5. While here, raise the contrast between the active and inactive mode chip (`styles.css:3204`): the active chip should differ by more than a border tint.

No new strings.

## Acceptance criteria

- [ ] After clicking **+**, `.ed-sidebar.scrollLeft === 0`.
- [ ] After clicking **+**, every `.ed-section` heading's left edge is at or right of the sidebar's content edge.
- [ ] The same holds after Escape and after a successful Enter.
- [ ] The same holds at the narrowest panel width the splitter allows.
- [ ] With three modes plus the open field, the header wraps instead of overflowing.
- [ ] The active mode chip is distinguishable from an inactive one without relying on colour alone (weight, fill or a mark).

## Tests

Add `scripts/test-slides-token-modes-browser.mjs` (or extend it if DS-05 created it): open the Tokens view, click **+**, assert `scrollLeft === 0` and compare `getBoundingClientRect().left` of the first `.ed-section` with the sidebar's. Measure geometry, not styles. The rig must fail on the parent commit and pass with the fix; record both. Register it in `.github/workflows/ci-slides.yml` with the other editor browser rigs.

## Out of scope

- Any change to what modes do (DS-05, DS-06).
- The token rows' own layout.

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/tokenspane.ts`, `slides/src/styles.css`.
- `scripts/test-slides-steady-chrome-browser.mjs` and `scripts/test-css-balance.ts` already guard chrome stability and CSS brace balance; run both.
- `overflow-x: clip` is supported by every browser the app targets, but check the phone drawer rules in the `@media (max-width: 700px)` block still open the sidebar correctly.

---
id: PK-02
title: "Phone top bar: Undo and Format always visible"
epic: 9-parked
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:touch", parked]
depends_on: []
related: [PK-01, PK-04, FH-15]
upstream: []
---
## Summary

On a phone the top bar is wider than the screen and scrolls sideways. At 390 px the visible part ends exactly after the "+" button, so Undo, the Format-panel button, Save and "⋯" are off-screen with nothing peeking in and no scrollbar to hint that more exists. The deck title takes the room. Keep Undo and Format in view at all times on a phone; move the title out of the bar.

## What the user experiences

They open a deck on a phone. The bar shows the logo, the deck title, the Slides button and "+". They move something by accident (PK-01) and look for Undo: not there. They want to change a colour and look for the Format panel: not there. Nothing suggests the bar scrolls; the cut falls between two buttons, so no half-visible icon gives it away. Keynote on iPhone keeps Undo, Format (the brush), "+" and "⋯" permanently visible.

## Reproduce

Chromium emulation, iPhone 13 profile (390 px wide):

1. Open the Showcase deck.
2. Observe the top bar: logo, "Bento Slides Showcase", the Slides panel button, "+". Nothing else.
3. Swipe the bar to the left: Undo, the Format panel button, Save and "⋯" scroll into view.
4. Measure: `document.querySelector('.ed-topbar').scrollWidth` is about 623 against a 390 px viewport.

## Evidence

Observed in the running app (audit journey 4, emulated iPhone 13): the bar's content was 623 px wide in a 390 px viewport; the visible cut fell exactly after "+", with no scrollbar; Undo, Format, Save and "⋯" appeared only after swiping the bar.

**Not verified on a real device.**

Confirmed in code at `29b5c80`:

- Phones always take the folded bar: `fitTopbar()` adds all three tiers and calls `applyPhoneChrome(true)` when `window.innerWidth <= 700` (`slides/src/editor/editor.ts:1004-1014`).
- The phone tool group is Slides, the "+" insert menu and the undo/redo history, in that order (`slides/src/editor/editor.ts:568-569`), followed by the Format button, Save and "⋯".
- In the phone media block the title keeps a 220 px basis: `.ed-title { flex: 0 1 220px; }`, and the tool group refuses to shrink: `.ed-phone-tools { … min-inline-size: max-content; }` (`slides/src/styles.css:2593-2619`).
- The folded bar's document zone is told to keep its content width: `.ed-topbar.ed-bar-fold .ed-zone-doc { min-width: max-content; }` (`slides/src/styles.css:3936`).
- **The sideways scroll is deliberate.** The comment above that rule says: squeezed to its flex share, the zone "let undo/redo slide UNDER the right group (390px, measured). Past the fold's floor the bar scrolls instead" (`slides/src/styles.css:3933-3935`). So the present behaviour was chosen over an overlap bug. This issue changes what is *in* the bar on a phone so that it fits, instead of undoing that rule.

## How others do it

- **Keynote on iPhone**: back, Undo, Format, "+", "⋯" fixed in the bar; the document name is not in the bar while editing.
- **Google Slides mobile**: Undo, Redo, "+", comment, "⋯"; the title is on the document list screen.
- **Canva mobile**: Undo and Redo at the top left at all times.

## Proposed change

`slides/src/editor/editor.ts` (`applyPhoneChrome`, the phone chrome description around line 560-575) and `slides/src/styles.css` (the `max-width: 700px` block). No format change.

1. **Take the title out of the bar on phones.** In the phone layout, hide the `.ed-title` input in the bar and offer renaming from the File menu (a "Rename…" row that focuses an input inside the menu or opens the document properties dialog). Names are typed where they appear, never through `prompt()`.
2. **Fixed order that fits 360 px**: logo (File menu) · Slides · "+" · Undo · Format · Save · "⋯". Redo moves into "⋯" on phones (it already has a captioned form there for demoted buttons). Seven 44 px targets plus padding is about 330 px.
3. **Keep the no-overlap guarantee.** With the title gone the bar should not need to scroll at 360 px and above. Keep the scroll as the fallback for narrower widths or long locales, and when the bar does scroll show a fade on the cut edge so a hidden part is evident.
4. Do not change tablets or desktop: the change is inside the phone tier only.

Rejected: shrinking the title to its 48 px floor. A 48 px title input is unusable and still costs a button's width.

New strings: "Rename…" if added, through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] At 390 px and at 360 px viewport width, Undo and the Format panel button are fully inside the viewport on load, measured by `getBoundingClientRect().right <= innerWidth`.
- [ ] At those widths the bar does not scroll (`scrollWidth <= clientWidth + 1`).
- [ ] No two bar buttons overlap at 360, 390 and 430 px (the same collision check `fitTopbar` uses).
- [ ] The deck can still be renamed on a phone, and the new title lands in `doc.title`.
- [ ] Redo is reachable from "⋯" with a text label.
- [ ] At 701 px and wider, the bar is unchanged from today.
- [ ] In German and Portuguese (the longest catalogs) the phone bar still fits at 360 px.

## Tests

- Extend `scripts/test-slides-topbar-browser.mjs` and `scripts/test-slides-topbar-stable-browser.mjs` (both registered in `.github/workflows/ci-slides.yml`) with phone-width cases: the button rectangles, the no-scroll condition, and the no-overlap condition at 360, 390 and 430 px, in English and German.
- `scripts/test-slides-share-pop-phone-browser.mjs` and `scripts/test-slides-people-tiers-browser.mjs` exercise the folded bar's menus; keep them green, since moving buttons between the bar and "⋯" is what broke them before.

## Out of scope

- A bottom-sheet Format panel and a horizontal slide strip (PK-04).
- Auto-collapsing side panels on narrow desktop windows (FH-15).
- Touch move safety (PK-01).

## Notes for the implementer

- Parked epic: a cheap safety fix; keep it small.
- Read the comments in `fitTopbar` and `applyPhoneChrome` first (`slides/src/editor/editor.ts:921-1060`). Reparenting buttons has ordering traps that are documented there: a first load that reordered the bar, a dropdown that lost its label, a people-avatar stack that folded the bar at any width.
- `slides/CLAUDE.md` has a top-bar note on why the bar hides text by measuring instead of by pixel media queries; follow it.

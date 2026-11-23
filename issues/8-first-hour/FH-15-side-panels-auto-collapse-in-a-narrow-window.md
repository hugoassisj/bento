---
id: FH-15
title: "Side panels auto-collapse in a narrow window"
epic: 8-first-hour
type: enhancement
priority: P2
size: S
evidence: seen
labels: [enhancement, "priority:P2", "size:S", "evidence:seen", "area:editor"]
depends_on: []
related: [PK-02, PK-04]
upstream: []
---
## Summary

Between 700px and roughly 1100px of window width, both side panels stay open as fixed columns and the slide is squeezed between them. At 900×700 the canvas zoom falls to 23% and the slide is about 300px wide, too small to edit. Panels only get out of the way below 700px, where they become drawers. Add a middle band where the editor collapses panels it was not asked to keep open, so the canvas keeps a workable width.

## What the user experiences

- A laptop user puts the editor beside a document in a split window (about 900px). The slide shrinks to a thumbnail between a 232px slide list and a 264px inspector. Text on the slide is unreadable; handles are tiny.
- An iPad in portrait (834px) gets the same layout: in the audit the slide was 264px wide there, smaller than on a phone.
- Nothing suggests collapsing a panel; the user has to know the chevrons or the `[` and `]` keys.

## Reproduce

1. Open the app in a desktop browser window sized 900×700.
2. The Showcase loads with both panels open. The zoom readout at the bottom shows about 23%.
3. Press `]` to hide the Format panel: the slide grows substantially. Press `[` to hide the slide list: it grows again.
4. Resize the window to 690px wide and reload: both panels start collapsed and act as drawers.

## Evidence

Observed in the running app: at a 900×700 viewport both panels were open and the zoom readout showed 23% (main-session screenshot of the first load at that size). In iPad Pro 11 portrait emulation the design-features journey measured a 264px-wide slide with both panels open.

Confirmed in code now:

- The only breakpoint is 700px. `panelsAreDrawers` returns `window.innerWidth <= 700` (`slides/src/editor/editor.ts:1071-1079`), matching the `@media (max-width: 700px)` blocks in `slides/src/styles.css:2593`, `2967` and `4056`.
- Panels start collapsed only below 700px (`editor.ts:674-680`).
- Collapse state is a class, `ed-collapsed`, toggled by `togglePanel` (`editor.ts:1059-1064`) and set by `closePanel` (`editor.ts:1081-1086`). Only panel **widths** are persisted (`lsSet('bento-ed-panels', …)` at `editor.ts:858`); collapsed state is not.
- Default widths are 232px and 264px (`editor.ts:222`), with per-side minimums computed from the tab bar (`panelMin`, `editor.ts:796-801`), so at 900px the canvas column gets roughly 400px before its own padding.

## How others do it

- Figma: below a width threshold the UI offers "minimize UI" and panels collapse to a floating strip; the canvas always wins.
- PowerPoint (web): the thumbnail pane narrows and the Designer / Format pane closes when the window narrows.
- Keynote: the inspector and navigator are independently toggled and remembered; on iPad the format panel is a popover over the canvas, never a column.
- Penpot: both sidebars collapse with one shortcut and collapse automatically on small viewports.

## Proposed change

1. Introduce a derived "comfortable canvas" rule in the editor: after layout, if the canvas column would be narrower than a minimum (start with 520 CSS pixels; tune by looking), auto-collapse panels until it is not. Collapse the **right** panel first (the slide list is navigation; the inspector is reachable again with one click or `]`), then the left.
2. Track intent so the editor never fights the user: keep, per side, whether the panel is open because the user opened it at this width (`userOpen`) or by default. Auto-collapse only applies to panels that are open by default. If the user opens a panel while narrow, it stays open until they close it or the window crosses back over the threshold.
3. On widening past the threshold, restore panels that were auto-collapsed (not ones the user closed).
4. Hook into the existing resize plumbing rather than adding a `matchMedia` query: the top bar already re-fits through a `ResizeObserver` and a resize listener (`editor.ts:706-720`); the comment at `editor.ts:1071-1079` explains why width breakpoints were replaced by measuring.
5. When a panel auto-collapses for the first time in a session, show nothing modal. The existing edge chevrons (`updatePanelChevrons`) are the affordance; make sure they are visible in this band.
6. Initial load: apply the same rule at boot, replacing the hard-coded `< 700` start-collapsed check with the rule (below 700 both still start collapsed, as today).

No new strings are expected.

Rejected: making panels drawers up to 1100px (overlays cover the element being edited, which is the phone problem moved to laptops); shrinking panel widths below their computed minimums (the tab bars clip in longer languages, which `panelMin` exists to prevent).

## Acceptance criteria

- [ ] At 900×700 on first load, the canvas column is at least the chosen minimum width and the zoom readout is materially higher than 23% (record the new value).
- [ ] At 1440×900 nothing changes: both panels open.
- [ ] Below 700px nothing changes: both collapsed, drawers.
- [ ] Opening the auto-collapsed panel by chevron, top-bar button or `]` keeps it open while the window stays narrow.
- [ ] Widening the window past the threshold re-opens only panels that were auto-collapsed.
- [ ] A panel the user closed at a wide size stays closed after narrowing and widening.
- [ ] Resizing a panel by its drag handle still works and persists its width.
- [ ] No layout jump loop: resizing slowly across the threshold toggles each panel at most once per crossing.

## Tests

- Add `scripts/test-slides-narrow-panels-browser.mjs` (headless Chromium): load at 900×700 and assert the right panel has `ed-collapsed` and the stage's `getBoundingClientRect().width` exceeds the minimum; press `]` and assert it stays open after a 10px resize; set the viewport to 1440×900 and assert both open; set 690px and assert both collapsed. Measure rectangles, not class names alone. Register it in the `slides-editor-browser` job in `.github/workflows/ci-slides.yml`.
- Run the existing `scripts/test-slides-steady-chrome-browser.mjs` and `scripts/test-slides-inspector-tabs-browser.mjs` to confirm no regression in panel sizing.

## Out of scope

- The phone layout: bottom-sheet inspector and horizontal slide strip (PK-04, parked).
- The phone top bar (PK-02).
- Persisting collapsed state across sessions.

## Notes for the implementer

- Zone: slides app. Files: `slides/src/editor/editor.ts` (hot file), possibly `slides/src/styles.css`, `CHANGELOG.md`.
- `docs/audit/ux-pyramid-2026-10-30.md` already tested at 1024 and 768 and records top-bar and panel-width problems there (lines 150 and 287); mention this issue covers the panel half of that band when proposing upstream.
- The canvas re-fits its zoom from a `ResizeObserver` on the canvas wrap (the comment at `editor.ts:1063`); collapsing a panel is enough, do not set the zoom yourself.
- Check the right-to-left chrome: "left" and "right" in the code are logical sides in RTL locales; test once with an RTL language pack.

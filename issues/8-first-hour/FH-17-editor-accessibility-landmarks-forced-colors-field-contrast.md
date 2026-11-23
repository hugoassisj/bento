---
id: FH-17
title: "Editor accessibility: landmarks, forced-colors, field border contrast"
epic: 8-first-hour
type: enhancement
priority: P3
size: M
evidence: mixed
labels: [enhancement, "priority:P3", "size:M", "evidence:mixed", "area:a11y", a11y]
depends_on: []
related: [FH-09, FH-10, FH-11, FH-16]
upstream: []
---
## Summary

Three gaps in the editor chrome for people who rely on assistive settings: the page has no landmarks, so a screen-reader user cannot jump between the toolbar, slide list, canvas and inspector; there is no support for Windows High Contrast (`forced-colors`), where several focus and selection indicators disappear; and the resting edge of form fields is very faint. The first two are straightforward. The third collides with a recorded design decision and must be handled as an opt-in, not a default change.

**Read this first:** the forced-colors and contrast points were established by reading the stylesheet, not by running Windows High Contrast. Reproduce in a real forced-colors session (or Chromium's rendering emulation) before and after.

## What the user experiences

1. **No landmarks.** A screen-reader user's landmark or region list is empty. The 380-odd buttons of the editor are one flat sequence.
2. **Forced colours.** In Windows High Contrast, `box-shadow` is removed and author background colours are replaced. Focus rings drawn only with `box-shadow`, and hover or focus states drawn only with a background change, become invisible, so keyboard focus is lost in the Layers list, the shortcut sheet rows, the Morph-with picker and the token picker.
3. **Faint field edges.** In the light theme a text field's border at rest is roughly 1.2–1.3:1 against its surface. Low-vision users cannot see where an input is until they hover it.

## Reproduce

1. Open the app. In the browser's accessibility tree (or with a screen reader's landmark list) look for regions: none are present.
2. In Chromium DevTools ▸ Rendering ▸ "Emulate CSS media feature forced-colors: active". Click the Layers tab, focus the list with Tab and move with the arrow keys; open the `?` shortcut sheet and Tab through its rows; select a shape, open Animate ▸ Morph with. Watch for the focus indicator in each.
3. In the light theme, look at any numeric field in the Format panel without hovering it.

## Evidence

Measured in the running app (main session): a query for `main, nav, header, aside, footer` and the roles `main`, `navigation`, `toolbar`, `banner` returned zero elements on the loaded editor. The Tab walk showed visible focus styles on ordinary buttons (`outline: solid 2px`), so the default theme is not the problem.

Confirmed in code now:

- Landmarks: the chrome containers are plain `div`s: `ed-topbar` (`slides/src/editor/editor.ts:389`), `ed-sidebar` (`editor.ts:590`), `ed-canvas-wrap` (`editor.ts:604`), `ed-props` (`editor.ts:662`). The only `role="toolbar"` uses are the floating text bar (`slides/src/editor/richtext.ts:136`) and the arrange row (`slides/src/editor/inspector/arrange.ts:58`).
- Forced colours: `slides/src/styles.css` contains no `forced-colors` and no `prefers-contrast` rule (a count of both strings is 0).
- Indicators that will vanish under forced colours:
  - `styles.css:726` `.ed-layers:focus-visible…` is `box-shadow` only.
  - `styles.css:3872` `.ed-morph-opt:focus-visible` is an inset `box-shadow`, and `styles.css:3871` sets `outline: none` with a background change.
  - `styles.css:3864` `.ed-tokpick-act:hover, :focus-visible` is a background change with `outline: none`.
  - `styles.css:4040` `.ed-keys-row:focus-visible` is an inset `box-shadow`.
  This list is a sample, not an inventory; the stylesheet has six `outline: none|0` declarations to audit.
- Field edges: `--field-line: var(--line)` with `--line: #e3e8ef` on `--field: #ffffff` in light (`styles.css:24`, `30-31`); dark uses `#3a414d` on `#12151a` (`styles.css:69`, `76`).
- **This is deliberate.** `docs/DECISIONS.md:12263-12274` ("quiet field edges in dark") records that a 3:1 edge on every resting control "turned the dark inspector into a grid of outlines; the trade-off at rest is deliberate". `scripts/test-slides-accent-contrast.ts:109-112` enforces it in both themes: the hover edge must reach 3:1 and the resting edge must be **below** 3:1 ("quiet but present").

Not verified: actual rendering in Windows High Contrast; whether kernel UI primitives (`kernel/src/ui/dialog.css`, `menu.css`, `toggle.css`, `tooltip.css`) survive forced colours.

## How others do it

- PowerPoint and Keynote are native and inherit the system's high-contrast and increased-contrast settings.
- Figma: landmark regions for toolbar, layers and properties; honours forced colours in its UI kit.
- Penpot: labelled regions for the main toolbar and sidebars.
- General practice (WAI-ARIA Authoring Practices): one `main`, labelled `navigation` and `complementary` regions, `role="toolbar"` with roving focus for tool rows; focus indicators drawn with `outline` (or a transparent outline that forced colours repaint).

## Proposed change

1. **Landmarks** (`editor.ts`, where the containers are built): `ed-topbar` gets `role="banner"`; the tool cluster inside it gets `role="toolbar"` with an `aria-label` ("Tools"); `ed-sidebar` gets `role="navigation"` with `aria-label` ("Slides, layers and tokens"); the canvas wrap gets `role="main"` with `aria-label` ("Slide canvas"); `ed-props` gets `role="complementary"` with `aria-label` ("Format, animate and interact"). Labels through `t()`. Do not add roving-tabindex behaviour to the toolbar in this issue: adding `role="toolbar"` without arrow-key movement is acceptable only if each tool stays a tab stop; say so in the PR, or leave the tool cluster as a labelled `group`.
2. **Forced colours** (`styles.css`): add one `@media (forced-colors: active)` block near the end. For every interactive element whose focus or selected state is drawn with `box-shadow` or background only, draw it with `outline: 2px solid Highlight` (focus) or a `Highlight` / `HighlightText` pair (selected). Use system colour keywords only. Cover at least: the four rules listed above, the selected layer row, the active slide thumbnail, the selected tab in each tab strip, the active tool button, toggles and segmented controls, the palette's highlighted row. Audit by searching for `box-shadow` inside `:focus-visible` rules and for `outline: none`.
3. **Field edges**: do **not** change the default tokens. Add `@media (prefers-contrast: more)` that sets `--field-line` to the same value as `--field-line-hot` in both themes, so users who ask the system for more contrast get a 3:1 resting edge. Under forced colours the system draws borders itself.

New strings (all catalogs): the four or five region labels.

Rejected: raising the resting edge for everyone. It contradicts a dated decision and fails `test-slides-accent-contrast.ts` by design. If you believe the decision is wrong, that is an upstream conversation, not a PR.

## Acceptance criteria

- [ ] The editor exposes exactly one `main` region and labelled banner, navigation and complementary regions; each label is translated.
- [ ] With `forced-colors: active` emulated, keyboard focus is visible on: a Layers row, a shortcut-sheet row, a Morph-with option, a token-picker action, a slide thumbnail (once FH-11 makes it focusable), a palette row.
- [ ] With `forced-colors: active`, the selected tab, the active tool and the selected layer are distinguishable from their neighbours.
- [ ] With `prefers-contrast: more`, a resting field edge reaches at least 3:1 in both themes; without it, the tokens are unchanged.
- [ ] `scripts/test-slides-accent-contrast.ts` passes unmodified, or is extended (not weakened) with the `prefers-contrast` values.
- [ ] No visual change in the default light and dark themes (compare screenshots before and after at 1440×900).

## Tests

- Add `scripts/test-slides-chrome-a11y-browser.mjs` (headless Chromium): assert the region roles and labels; then `page.emulateMedia({ forcedColors: 'active' })` and assert, for each listed control, that the focused element's computed `outline-style` is not `none` and `outline-width` is at least 2px. Add a `prefers-contrast` case using `page.emulateMedia({ contrast: 'more' })` and compute the edge contrast from the resolved custom properties. Register it in the `slides-editor-browser` job in `.github/workflows/ci-slides.yml`.
- Extend `scripts/test-slides-accent-contrast.ts` with the `prefers-contrast: more` token values if they are declared as tokens.
- `scripts/test-css-balance.ts` (CSS brace balance) must stay green after the new media blocks.

## Out of scope

- Menu and dialog keyboard semantics (FH-09), toast announcements (FH-10), slide list focus (FH-11), the show (FH-16).
- Kernel UI primitives under `kernel/src/ui/*.css`: kernel zone. If they need forced-colours rules, write a separate issue with the `kernel-zone` label.
- A full WCAG audit.

## Notes for the implementer

- Zone: slides app. Files: `slides/src/editor/editor.ts` (hot file, small additions at the container builders), `slides/src/styles.css` (hot file; append the media blocks, do not interleave), catalogs, `CHANGELOG.md`.
- Computed-style assertions are legitimate here because the property under test **is** the style; this is not the "reading back a style is not a measurement" trap, which is about motion.
- The stylesheet is compressed into every file; note the byte cost of the new blocks.

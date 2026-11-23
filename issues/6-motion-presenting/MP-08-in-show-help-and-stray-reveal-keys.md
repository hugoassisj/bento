---
id: MP-08
title: "In-show help sheet; `?` dims the screen today; retire stray Reveal keys"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: S
evidence: mixed
labels: [enhancement, "priority:P2", "size:S", "evidence:mixed", "area:present", a11y]
depends_on: []
related: [MP-07, MP-09]
upstream: []
---
## Summary

The show has seven keys of its own (Esc, S, F, M, L, B and the arrows) and no way to discover them while presenting. Meanwhile the underlying Reveal library still listens to the keyboard and reacts to a dozen keys the product never advertises: some dim the screen, some open an unstyled overview, and some navigate **around** Bento's own logic. Add a help sheet that lists the show's real keys, and take the keyboard away from Reveal.

## What the user experiences

- Pressing a key in search of help darkens the slide in front of the audience with no explanation and no visible way back.
- Pressing O opens a raw strip of slides.
- Pressing N or P moves between slides but ignores click builds and can land on a hidden state slide that arrow keys correctly skip.
- Nothing lists S (speaker view), L (laser), B (black) or M (reduce motion) once the first slide of the Showcase is gone.

## Reproduce

Read the Evidence section first: one of these observations needs re-checking with a real keyboard.

1. Fresh load of the Showcase. Start the slideshow.
2. Press `/` (the key without Shift). The slide dims (Reveal's pause). Press it again to resume.
3. Press `.` or `V`: same dimming.
4. Press Shift+`/` (a real `?`). Record what appears.
5. Press `O`: an overview strip appears; Esc closes it.
6. Go to the "Charts with a pulse." slide, which links to hidden state slides. Press `N` repeatedly and compare with pressing →.
7. On a slide with reveal steps, press `N`: it leaves the slide without revealing the steps.

## Evidence

- Seen in the main session: a synthetic `?` key press (Playwright `keyboard.press('?')`) added the class `paused` to `.reveal` and showed `.pause-overlay`, dimming the slide; no help appeared. **That key event carried keyCode 191 without Shift**, which is why it paused. The journey also reported O showing "Reveal's raw unstyled strip".
- Confirmed in code now:
  - Bento's capture handler intercepts only Esc, S, F, M, L, B, →, PageDown, Space, ←, PageUp, and stops propagation for those (`slides/src/present.ts:1281-1329`). Every other key reaches Reveal.
  - The Reveal config passed by the show sets `keyboardCondition: null` and does not set `keyboard`, `help`, `pause`, `overview` or `jumpToSlide`, so Reveal's defaults apply (`present.ts` config block ≈745-766; a search for `help:` / `keyboard:` / `jumpToSlide` in `present.ts` finds nothing).
  - Reveal's keyboard controller (`slides/node_modules/reveal.js/js/controllers/keyboard.js`): P and N call `Reveal.prev()` / `Reveal.next()` (265-271), H/J/K navigate (273-319), Home and End jump to the first and last **section** (331-337), `: ; B V .` and `/` **without Shift** call `togglePause()` (351-352), G toggles jump-to-slide when `config.jumpToSlide` (365-368), `?` **with Shift** and F1 call `toggleHelp()` (375-380), Esc and O toggle the overview (394-399).
  - `Reveal.next()` knows nothing about Bento's steps or state slides; Bento's own `goNext` does (`present.ts:199-206`). So N, P, Home and End bypass both.
  - The help overlay is a stand-in written in `slides/reveal-lite.ts:74-87` ("What stays is the `?` help"): it builds a table from Reveal's own shortcut list, in English, if `config.help` is on.
- Not verified (needs a real keyboard): what Shift+`/` shows. By the code it should open Reveal's table, which would list Reveal's bindings (N, P, H, J, K, L, B, O …) rather than Bento's. The title's claim "`?` dims the screen" is therefore only established for the key without Shift. Establish the real behaviour before changing anything, and correct this issue file.

## How others do it

- **PowerPoint**: F1 or `?` during a show opens "Slide Show Help", a tabbed list of every key.
- **Keynote**: `?` or `/` shows the keyboard shortcuts panel in the presenter display.
- Neither exposes library defaults.

## Proposed change

1. **Own the keyboard.** In the Reveal config in `slides/src/present.ts`, set `keyboard: false` so Reveal binds nothing, and handle every key in `onKeydown`:
   - Home / End → `goFirst()` / `goLast()` (they exist, `present.ts:238-239`, and respect the visible-slide list).
   - N / P: either drop them or map them to `goNext()` / `goPrev()`; do not leave them on Reveal.
   - O: if the overview is kept, call `deck.toggleOverview()` from Bento's handler; MP-09 proposes replacing it with the speaker view's grid.
   - `?`, Shift+`/`, F1 and H → the new help sheet.
   - Everything else: ignored.
   Confirm `keyboard: false` does not also disable Esc-closes-overview, which the handler currently defers to Reveal (`present.ts:1283`).
2. **Help sheet.** A small overlay inside the show overlay, built by Bento, not Reveal: two columns, key and action, from one list that is also the source of truth for the handler (the editor already works this way: "keys are commands", `slides/src/editor/commands.ts`). Rows: → Space PageDown / ← PageUp, Home / End, S speaker view, F fullscreen, B black screen, L laser, M reduce motion, Esc end show, `?` this sheet, plus G grid once MP-09 lands. Any key or click closes it. It must not be sent to the audience of a live broadcast and must not appear in the speaker window's audience preview.
3. **Remove the stand-in** help from `slides/reveal-lite.ts` if nothing calls it any more, and set `help: false`. The build checks that every stub is still imported; follow the file's own rules.
4. A one-line hint on entering the show for the first time per browser ("Press ? for keys"), dismissible, stored in localStorage.

Strings in every catalog: the sheet title and each action label (several already exist as tooltips in the speaker view: reuse those keys).

## Acceptance criteria

- [ ] With a real Shift+`/` (and with F1), a help sheet listing Bento's keys opens inside the show; any key closes it; the slide underneath is not paused or dimmed afterwards.
- [ ] `/`, `.`, `;`, `:` and `V` do nothing in the show; `.reveal` never gets the class `paused`.
- [ ] N and P either do nothing or behave exactly like → and ← on a slide with reveal steps and around state slides (same indices and step counts).
- [ ] Home and End land on the first and last slide of the linear flow, never on a state slide.
- [ ] The sheet's text comes from the catalogs and renders in a right-to-left locale.
- [ ] The sheet is not visible to a live audience and not in the speaker window's preview.
- [ ] The sheet has `role="dialog"` and an accessible name, and focus returns to the show.
- [ ] `npm run build:single` passes (the Reveal stub and CSS pruning checks in `slides/reveal-lite.ts`).

## Tests

- Add `scripts/test-slides-show-keys-browser.mjs` (register in `.github/workflows/ci-slides.yml`): for each retired key assert no `paused` class and no index change; for N/P/Home/End assert the same indices as the Bento functions on the Showcase (which has state slides); press Shift+Slash with `page.keyboard.down('Shift')` so the event really carries Shift, and assert the sheet. A synthetic press without Shift is what misled the audit.
- `scripts/test-slides-help-sheet-browser.mjs` covers the **editor's** shortcut sheet; do not confuse the two, but reuse its pattern.

## Out of scope

- The audience-window grid and number-then-Enter jump (MP-09).
- Black-screen wake behaviour (MP-07).
- Custom key bindings.

## Notes for the implementer

- Slides app only. `slides/reveal-lite.ts` stubs Reveal controllers at build time and fails the build when a stub or an edit stops matching; a stubbed feature cannot be switched on from config (see `docs/DECISIONS.md`, "The slides shell diet"). Turning the keyboard **off** is config only and safe.
- Removing Reveal's keyboard also removes its `keyboardCondition` handling; the show has no text fields, but the speaker window is a separate document with its own handler (`present.ts:1156-1166`) and is unaffected.

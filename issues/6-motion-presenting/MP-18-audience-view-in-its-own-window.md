---
id: MP-18
title: "Audience view in its own window for a second monitor"
epic: 6-motion-presenting
type: enhancement
priority: P3
size: M
evidence: code
labels: [enhancement, "priority:P3", "size:M", "evidence:code", "area:present"]
depends_on: []
related: [MP-10, MP-11, MP-17, MP-09]
upstream: ["nyblnet/bento discussion #959"]
---
## Summary

With two screens, the show takes over the window you were editing in, and the speaker view opens as a popup that the presenter must drag to the laptop. Upstream discussion #959 asks for the opposite arrangement: the main window stays on the laptop as the speaker view, and a clean audience view opens in a new window that can be moved or maximised on the external display. Offer that arrangement as a second way to present. The request has no maintainer reply yet.

## What the user experiences

A presenter connects a projector. Today:

1. They click Slideshow. The slides go fullscreen on the laptop, the screen they are looking at.
2. They press S (or use "Open speaker view" first). A 1200×800 popup opens on the same display.
3. They drag one of the two windows to the other screen and re-enter fullscreen.

On macOS the order matters: the speaker popup has to be opened before going fullscreen, or it is trapped in the fullscreen Space. The menu row's tooltip says so, which is a workaround written into the UI. People coming from PowerPoint and Keynote expect "slides on the projector, notes on my laptop" without rearranging windows.

## Reproduce

1. Open the Showcase deck. Click the Slideshow pill: the editor's own window becomes the audience view (fullscreen).
2. Press S: a popup titled as the speaker view opens at 1200×800 on the current display.
3. There is no menu entry or command that opens the audience view in a new window and keeps this one as the presenter's.

## Evidence

Read in code at `29b5c80`. Second-screen placement could not be exercised in the headless audit; nothing here was observed on real dual-monitor hardware.

- The show is an overlay built in the opener's document by `startPresentation` (`slides/src/present.ts:76`), and fullscreen is requested on that overlay (`slides/src/present.ts:1215`).
- The speaker view is a popup: either adopted from the editor (`speakerWindow()`) or opened with `window.open('', 'bento-speaker', 'width=1200,height=800')` (`slides/src/present.ts:1016-1022`). The editor-side opener is `openSpeakerWindow` (`slides/src/screens.ts:91-102`). The popup has no script of its own; the opener paints it and imports rendered slides into it (`slides/src/present.ts:986-1001`).
- The design note at the top of `slides/src/screens.ts` (lines 3-8) records the current approach: the editor opens the notes window in its own user gesture before presenting so that opening notes and going fullscreen never compete for activation ("the macOS second-screen fix"), the window opens on the current display, the presenter drags it, and **"we deliberately do NOT request the 'window management' permission"**.
- The menu row: "Open speaker view — Notes, controls and slide thumbnails in a separate window — drag it to a second screen. On macOS, open it before going fullscreen." (`slides/src/editor/editor.ts:631`).
- A presenter-to-viewer protocol already exists for live broadcast: `nav { id, i, lock }`, `black { on, lock }`, `laser 'fx,fy' | null` (`slides/src/present.ts:55-62`), with the viewer-side decisions in `slides/src/follow.ts` (`resolveNav`, follow state, laser sampling) and `setRemoteLaser` on the receiving show.

Upstream: discussion #959 (2026-11-12). Bonus request there: use the Window Management API to target the second screen directly.

## How others do it

- **PowerPoint**: Presenter View opens automatically on the laptop and the slides on the second display; "Swap Displays" flips them.
- **Keynote**: Play ▸ "In Window" gives a slideshow window and a presenter display window that can each be placed on any screen; fullscreen play picks the external display.
- **Google Slides**: the audience tab stays, the presenter view is a popup (the same model Bento has now), and it is a common complaint.

## Proposed change

Slides app only; no format change. Add an alternative arrangement; do not replace the current one.

1. **New entry** in the Slideshow ▴ menu and the command list: "Present in a new window". It opens the audience view in a new window (opened inside the click's user gesture) and turns the current window into the presenter's view: current slide, next, notes, controls. The audience window shows only the slide, with a one-line hint "Move this window to the other screen, then press F" that disappears on first navigation or fullscreen.
2. **How the audience window runs.** Two designs; pick after a spike and record the choice in `docs/DECISIONS.md`.
   - *Painted popup*: the opener builds the show overlay inside the popup's document. Cheapest in code, but animations then run on the opener's timers and `requestAnimationFrame`, which the browser throttles when the opener is covered or minimised. Measure before committing.
   - *Second instance* (recommended to try first): open the same file in a new window in a present-only follow state, and drive it from the opener with the existing verbs (`nav`, `black`, `laser`) over `postMessage` on the `WindowProxy`, reusing `slides/src/follow.ts`. Each window animates itself, so throttling one does not freeze the other. It needs a way to start an instance directly in follow mode and a local transport beside the relay one.
3. **Presenter side.** Reuse the speaker view's layout and controls in the main window (`slides/src/speakerlayout.ts`, the `sv-*` markup in `present.ts`) so there is one implementation.
4. **Fullscreen.** The audience window's own F key or a visible button requests fullscreen there (a user gesture in that window is required by the browser).
5. **Screen targeting** stays manual by default, in line with the recorded decision. If the Window Management API is used at all, it is behind an explicit "Put it on the other screen" button that requests the permission only when pressed, and the feature works without it.
6. Closing either window ends the show cleanly and restores the editor.

New strings go through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] "Present in a new window" opens an audience window showing the current slide, and the original window shows the presenter's view (current, next, notes, controls).
- [ ] Navigating from the presenter's window changes the audience window's slide and build step; black screen and laser are mirrored.
- [ ] With the presenter's window covered by another window, a morph in the audience window still animates (measured by element geometry over time in the audience window).
- [ ] The audience window never shows notes, comments or editor chrome.
- [ ] Closing the audience window ends the show and returns the editor to the slide where it stopped; closing the presenter window closes the audience window.
- [ ] The existing Slideshow, "Present in this tab" and "Open speaker view" paths behave exactly as before.
- [ ] No permission prompt appears unless the user presses an explicit screen-placement control.
- [ ] Works when the deck is opened from disk (`file://`) and from an `https` origin.

## Tests

- Browser rig `scripts/test-slides-audience-window-browser.mjs`: use Playwright's `context.waitForEvent('page')` to capture the new window, navigate from the presenter window with real keys, and assert the audience window's current slide id and a moving element's `getBoundingClientRect` across frames. Keep both pages visible. Register in `.github/workflows/ci-slides.yml`.
- Reuse the pure follow decisions already covered by `scripts/test-broadcast-follow.ts`; add cases if the local transport adds verbs.
- `scripts/test-slides-speaker-layout-browser.mjs` covers the speaker layout; run it.

## Out of scope

- Automatic placement on the external display without a user action.
- Presenter remote from a phone, and anything that needs the relay.
- Speaker-view improvements themselves (MP-10, MP-11).
- Rehearse mode (MP-17).

## Notes for the implementer

- Hot files: `slides/src/present.ts`, `slides/src/screens.ts`, `slides/src/editor/editor.ts`.
- Read the header of `slides/src/screens.ts` and the macOS fullscreen notes before changing any gesture ordering; that sequence was hard-won.
- On `file://` every local file shares one storage origin; do not put show state in shared storage to sync the two windows. Use the window reference.
- #959 is unanswered upstream; treat the arrangement as a proposal until the maintainer weighs in.

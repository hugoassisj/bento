---
id: MP-11
title: "Laser pointer from the speaker view"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:present"]
depends_on: []
related: [MP-10, MP-09, MP-08]
upstream: []
---
## Summary

The speaker view has a Laser button, and it does switch the laser on. But the laser can only be drawn by pressing on the audience window. A presenter who works from the speaker view on a laptop, with the slides on a projector, toggles the laser, moves over the current-slide preview, and nothing appears on the main screen. The only visible effect is a "Laser pointer: on" toast shown to the audience. Let the presenter point from the speaker view's current-slide preview.

## What the user experiences

A speaker opens the speaker view, drags the slideshow to the projector, and presents from the laptop. They click the Laser button in the speaker view (or press L there). The audience sees a toast. The presenter then presses and drags over the large current-slide preview in the speaker view, expecting a dot on the projector. No dot, no trail. To point at anything they have to move the mouse to the other screen, which is the screen they are not looking at.

## Reproduce

1. Open the Showcase deck. Slideshow ▴ ▸ Open speaker view, then start the slideshow (Present in this tab is enough).
2. In the speaker window click the Laser button (title "Laser pointer (L)").
3. Observe the main window: the toast "Laser pointer: on" appears over the slide.
4. In the speaker window, press and drag across the current-slide preview (`.sv-current`).
5. Observe the main window: no laser dot, no trail.
6. Press and drag on the slide in the main window: the dot and trail appear.

## Evidence

Observed in the running app (audit journey 3, real input): steps 2 to 5 as written; the toast was the only thing the main window showed.

Confirmed in code at `29b5c80`:

- The speaker toolbar builds the button at `slides/src/present.ts:1047` and routes it to `toggleLaser()` at `slides/src/present.ts:1138`; the speaker window's `L` key does the same at `slides/src/present.ts:1163`.
- `setLaserEnabled` (`slides/src/present.ts:635-643`) toggles `laser-enabled` on the audience overlay and calls `flashPresentMsg(...)`, which paints into that overlay. That is the toast the audience sees.
- All laser pointer listeners are attached to the audience overlay only: `overlay.addEventListener('pointermove', scheduleLaser, true)` and the `pointerdown` handler directly after it (`slides/src/present.ts:646-662`). Nothing listens on the speaker document's `.sv-current` box, which is filled by `updateSpeaker` (`slides/src/present.ts:986-1001`).
- A position-from-fractions painter already exists: `setRemoteLaser(p)` (`slides/src/present.ts:581-633`) takes `'fx,fy'` fractions of the slide box, mounts the laser layer if needed, and draws the dot with a trail. It is what an audience copy uses when a live presenter points. The wire format is documented at `slides/src/present.ts:61`.
- The local painter sends the same fractions to live audience copies through `sendLaserPoint` (`slides/src/present.ts:525-531`).

Not verified: behaviour with a live broadcast, since the audit had no relay.

## How others do it

- **PowerPoint Presenter View** has laser, pen and highlighter tools in the presenter window itself; moving over the presenter's slide draws on the audience display.
- **Keynote** shows a pointer on the audience display when the presenter moves over the slide in the presenter display (with the pointer option enabled), and its iPhone remote has a laser mode.
- **Google Slides** presenter view has a pointer toggle that mirrors to the audience tab.

## Proposed change

All in `slides/src/present.ts`; no format change.

1. In `openSpeaker`, attach `pointerdown`, `pointermove`, `pointerup` and `pointerleave` listeners to the speaker document's `.sv-current` box. Ignore them unless `laserEnabled` is true, and ignore `pointerType === 'touch'` to match the audience-side rule at `present.ts:647`.
2. On press and on each move while pressed, find the rendered slide surface inside `.sv-current` (the imported `.bento-slide` node), compute `fx, fy` from its `getBoundingClientRect()`, clamp to 0..1, and call `setRemoteLaser(\`${fx},${fy}\`)`. On release or leave call `setRemoteLaser(null)` so the trail fades as a local stroke does.
3. Forward the same fractions through `sendLaserPoint` with the existing 33 ms throttle so live audience copies follow, and send the release.
4. Give the presenter feedback in the speaker view: a dot drawn over `.sv-current` at the pointer, and the Laser button's pressed state (already maintained by `updateSpeakerControls`).
5. Stop showing the "Laser pointer: on/off" toast to the audience when the toggle came from the speaker view: pass `feedback = false` to `setLaserEnabled` on that path and flash the message in the speaker window instead.
6. Respect `blacked`: `setRemoteLaser` already clears while black.

Rejected: moving the laser layer into the speaker window (the audience would see nothing), and re-dispatching synthetic pointer events into the overlay (the coordinates differ and it would fight the local painter's cursor handling).

New strings: none expected. If a speaker-side message is added it goes through `t()` and into all eight catalogs.

## Acceptance criteria

- [ ] With the laser on, pressing and dragging over the speaker view's current-slide preview draws the dot and trail on the audience window at the matching position (same fraction of the slide, within 2 px at 1280×720).
- [ ] Releasing or leaving the preview fades the trail on the audience window.
- [ ] The laser still works exactly as before when drawn on the audience window.
- [ ] Toggling the laser from the speaker view no longer shows a toast on the audience window; toggling from the audience window (L) still does.
- [ ] While the screen is black, pointing from the speaker view draws nothing.
- [ ] With "Reduce motion" on, the dot shows and the trail does not, matching the local laser.
- [ ] When live, the forwarded points are sent at no more than about 30 per second.
- [ ] `tsc -b` and `npm run build:single` pass; shell size delta recorded.

## Tests

Extend or sit beside `scripts/test-slides-laser-release-browser.mjs` (registered in `.github/workflows/ci-slides.yml`). Add `scripts/test-slides-laser-speaker-browser.mjs`:

- Open the show with a speaker window, enable the laser from the speaker toolbar, dispatch real mouse press and moves over `.sv-current`, and assert the audience overlay's `.bento-laser-dot.bento-remote` (or whichever dot the implementation uses) is visible and its centre maps to the same slide fraction, measured with `getBoundingClientRect`.
- Assert no present-toast element appears in the audience overlay on the speaker-side toggle.
- Assert the dot hides after release.

Register it at the end of the browser rigs in `ci-slides.yml`. Remember `requestAnimationFrame` is throttled in a hidden tab: keep both windows visible in the rig.

## Out of scope

- Pen, highlighter or persistent annotations.
- Zoom or spotlight regions.
- Speaker-view build steps, notes size and timer (MP-10).
- Jumping to a slide from the audience window (MP-09).

## Notes for the implementer

- Zone: slides app only. Hot file: `slides/src/present.ts` (2,700 lines; MP-07 to MP-10 also touch it, so land these one at a time).
- The speaker popup's DOM is built by the opener (`d.importNode`), so the listeners live in the opener's realm; check `ev.view`/coordinates are the popup's.
- `.sv-current` is re-filled on every slide change (`updateSpeaker`); attach listeners to the box, not to the imported slide node.
- The speaker layout is resizable (`slides/src/speakerlayout.ts`); compute the surface rect per event, never cache it.

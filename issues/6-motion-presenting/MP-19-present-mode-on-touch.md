---
id: MP-19
title: "Present mode on touch: visible exit and next; no silent exit on over-swipe"
epic: 6-motion-presenting
type: enhancement
priority: P3
size: S
evidence: code
labels: [enhancement, "priority:P3", "size:S", "evidence:code", "area:touch"]
depends_on: []
related: [MP-08, PK-01, PK-02, FH-16]
upstream: []
---
## Summary

On a phone or tablet the show has no visible controls. A tap does nothing, there is no on-screen way to leave, and swiping past the last or first slide exits to the editor with no warning. Presenting or viewing a deck on a tablet is a real use (the README says phones "view and present well"), separate from phone editing, which is parked. Add tap zones, an auto-hiding control strip, and a confirmation step before an over-swipe exits.

## What the user experiences

- A viewer opens a deck on a tablet and it starts in the show. They tap the slide: nothing. Nothing on screen says to swipe.
- A presenter swipes forward on the last slide out of habit. The show closes and the audience sees the editor.
- Someone with no hardware keyboard wants to leave the show mid-deck. There is no Esc; the only exits are swiping off either end of the deck or leaving fullscreen through the browser.

## Reproduce

Touch emulation, phone or tablet viewport:

1. Open the Showcase deck and start the slideshow.
2. Tap the middle of the slide. Nothing happens.
3. Swipe left: next slide. Swipe right: previous.
4. Go to the last slide and swipe left: the show exits to the editor with no prompt.
5. Go to the first slide and swipe right: the show exits.
6. Look for an on-screen exit, next or menu control: there is none.

## Evidence

Read in code at `29b5c80`. **Not observed on a device**: the audit's touch work used Chromium emulation, and the show on touch was not exercised by a journey (the first-pass code audit raised it). Reproduce on a real phone or tablet before fixing.

- The whole touch handling of the show is two listeners: `touchstart` records the start point, and `touchend` navigates when the horizontal travel is at least 50 px and dominates the vertical travel; anything else "is a tap or a scroll" and returns (`slides/src/present.ts:1332-1353`).
- In the same handler, `if (hasNext()) goNext() else exit()` and `if (hasPrev()) goPrev() else exit()` (`slides/src/present.ts:1346-1352`). The comment above it states the intent: "swiping past either end of the deck drops back into the editor (phones have no Esc)".
- Keyboard handling covers Esc, S, F, M, L, B and the arrows (`slides/src/present.ts:1281-1330`); there is no touch equivalent for any of them.
- The laser ignores touch pointers on purpose (`slides/src/present.ts:647`).
- Element links and state buttons inside a slide are click targets, so a tap on them must keep working.

## How others do it

- **Keynote on iPhone and iPad**: tap advances; a swipe goes back; a pinch or a tap in the corner shows a toolbar with exit and the slide navigator.
- **PowerPoint mobile**: tap or swipe to advance; tapping the top of the screen shows a bar with End Show, pen and blackout.
- **Google Slides mobile**: tap advances; a tap near the top or bottom shows controls with an explicit close button.

## Proposed change

`slides/src/present.ts` and `slides/src/styles.css` only; no format change.

1. **Tap zones.** A tap (travel under the existing slop, short hold) on the right two thirds advances; on the left third goes back. A tap that lands on an interactive element (`[data-link]`, a link, a media control, a chart) keeps its own behaviour and never navigates: test the event target first.
2. **Control strip.** A tap in the top band (or a two-finger tap; choose one and record it) shows a small strip for a few seconds: Exit, Previous, Next, slide counter, and Black screen. It hides again without input. It is rendered only when the device reports touch (`pointer: coarse` or a touch event has been seen), so desktop shows are unchanged.
3. **Over-swipe.** Swiping past either end no longer exits at once. The first over-swipe shows a message "Swipe again to exit" (use the show's existing message toast) and arms a short window; a second over-swipe inside it exits. On the last slide a tap in the advance zone does the same instead of doing nothing.
4. **First-run hint.** On the first touch show per browser, flash "Tap to advance, swipe back, tap the top for controls" once.
5. Respect an audience copy's lock: when a live presenter has locked navigation, the strip shows only Exit.
6. Give the strip's buttons accessible names and at least 44 px targets.

Rejected: a permanently visible button. It would sit on the slide in every screenshot and recording.

New strings go through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] A tap on the right two thirds of a slide advances one step or slide; a tap on the left third goes back.
- [ ] A tap on a linked element follows the link and does not also navigate.
- [ ] Swiping still navigates as before in the middle of the deck.
- [ ] Swiping past the last slide once does not exit and shows the exit message; a second swipe within the window exits. The same holds at the first slide.
- [ ] The control strip appears on the chosen gesture, offers Exit, Previous, Next and Black screen, and hides without input.
- [ ] With a mouse and keyboard and no touch input, the show's DOM and behaviour are unchanged from today.
- [ ] The strip's buttons are at least 44 px and have accessible names.
- [ ] Verified on at least one real touch device, named in the change description.

## Tests

- Browser rig `scripts/test-slides-present-touch-browser.mjs`: a context with `hasTouch: true` and a phone viewport; drive `page.touchscreen.tap` and CDP `Input.dispatchTouchEvent` swipes; assert the slide counter after taps in each zone, that an over-swipe leaves the overlay in place and a second removes it, and that a tap on a `[data-link]` element changes slide by the link and not by the zone. Register in `.github/workflows/ci-slides.yml`.
- `scripts/test-slides-share-pop-phone-browser.mjs` is an existing phone-viewport rig to model the setup on.

## Out of scope

- Phone editing (the `9-parked` folder: PK-01 to PK-04).
- A help sheet for keyboard users (MP-08).
- Screen-reader behaviour in the show (FH-16).
- Annotation or pinch-zoom inside the show.

## Notes for the implementer

- Hot file: `slides/src/present.ts`; MP-07 to MP-11 also touch it.
- Synthetic `PointerEvent`s do not exercise this path; the handlers are `touchstart`/`touchend`.
- Emulated touch differs from real devices in tap timing and in the synthesized mouse events that follow a tap; check for a double action (tap navigates and the synthesized click navigates again).
- iOS idle-timer handling for the show already exists near `slides/src/present.ts:1186`; do not disturb it.

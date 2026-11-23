---
id: FH-16
title: "Present mode for screen readers: hidden steps, alt text, focusable links"
epic: 8-first-hour
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:present", a11y]
depends_on: []
related: [FH-17, SC-02, MP-08, MP-01]
upstream: []
---
## Summary

A deck presented or viewed with a screen reader, or with the keyboard alone, loses three things: content that has not been revealed yet is announced anyway, the alt text authors write is never announced, and elements that link to another slide or the web cannot be reached without a mouse. Fix all three in the show.

**Read this first:** most of this issue was established by reading code, not by listening to a screen reader. Reproduce each point with VoiceOver or NVDA before changing anything, and correct this file if a claim does not hold.

## What the user experiences

1. **Spoilers.** A slide with click builds ("Appears on click") announces every bullet on arrival, including the ones the audience cannot see yet. Revealing a step then announces nothing.
2. **Alt text is silent on arrival.** The author fills in the Accessibility field for a picture or chart. On slide change the announcement contains only text nodes, so the description is skipped. (It is still reachable by browsing the page with a virtual cursor, since it is an `aria-label` on a `role="img"` node.)
3. **Links are mouse-only.** A shape linked to another slide, a state slide, or a URL responds to a click and to nothing else. Tab does not reach it, and it is not exposed as a link. Interactive "state" slides are therefore unreachable from the keyboard.

## Reproduce

Use the Showcase deck plus one slide you make.

1. Make a slide with three text boxes; select them, Animate ▸ Reveal ▸ In order. Start the slideshow on it with a screen reader running. Expected today: all three texts are read on arrival; pressing → to reveal box 2 reads nothing.
2. Add a picture, give it alt text in Format ▸ Export ▸ Accessibility, present. Expected today: arriving on the slide does not read the alt text.
3. On Showcase slide 8 ("Charts with a pulse"), present, press Tab repeatedly. Expected today: focus never lands on "See the split"; only a mouse click follows the link.

## Evidence

Measured in the running app (main session, headless Chromium, slideshow open): one `aria-live` region present; 19 slide sections, none with an accessible name; no heading roles; the wrapper carries `role="application"`.

Confirmed in code now:

- The announcer is Reveal's own. `slides/node_modules/reveal.js/js/reveal.js:391-418` `getStatusText` concatenates text nodes and skips a node only when it has `aria-hidden="true"` or computed `display: none`. It is called on slide change (`reveal.js:1393`, `1483`). `slides/reveal-lite.ts` does not replace it.
- Unrevealed build steps are hidden with visibility, not display: `slides/src/present.ts:167-173` `applyStep` toggles the class `bento-step-hidden`, and `slides/src/styles.css:1993` defines it as `visibility: hidden !important; pointer-events: none`. So `getStatusText` still reads them.
- Revealing a step (`present.ts:175-183` `revealStep`) applies the class change and entrance effect and never touches the status element.
- Alt text is rendered as `role="img"` plus `aria-label` (`slides/src/render.ts:704`, types in `ALT_TYPES` at `render.ts:1008`: shape, image, svg, chart). `getStatusText` reads `textContent` only, so labels are not included.
- Links: `render.ts:701` writes `data-link`; the show handles it in a click listener (`present.ts:1442-1456`). There is no `tabindex`, `role="link"` or key handler for these nodes anywhere in `render.ts` or `present.ts`.

Not verified: what VoiceOver, NVDA or TalkBack actually speak; whether `role="application"` on the wrapper suppresses virtual-cursor browsing in practice; behaviour in the present-only and audience copies.

## How others do it

- PowerPoint: slide show exposes the slide title and reads objects in the Selection Pane's reading order; alt text is read for pictures; animations reveal content to the accessibility tree as they play.
- Keynote: VoiceOver reads builds as they appear; links are focusable.
- Google Slides: a dedicated screen-reader mode with slide announcements and live captions.
- Figma prototypes: hotspots are focusable and operable with Enter.

## Proposed change

1. **Hide unrevealed steps from assistive technology.** In `applyStep`, set `aria-hidden="true"` on a node while it is step-hidden and remove it when shown. `getStatusText` already honours `aria-hidden`. Do not switch to `display: none`: step-hidden elements must keep their layout box (morph and entrances measure them).
2. **Announce a reveal.** In `revealStep`, after applying the step, write the revealed elements' text (and alt text) into Reveal's status element. `deck.getRevealElement().querySelector('.aria-status')` is the node; check what `reveal-lite.ts` exposes before reaching into the DOM. Empty reveals (shapes with no alt) announce nothing.
3. **Include alt text in the slide announcement.** Either post-process the status text after Reveal sets it (append the `aria-label` of each visible `[role="img"]` in document order), or build the whole announcement in `present.ts` and stop relying on `getStatusText`. Prefer the second if `reveal-lite.ts` makes it easy to disable Reveal's own announcement, because it also lets the announcement start with the slide number ("Slide 3 of 15").
4. **Make links operable.** When rendering for the show, give a node with `data-link` `tabindex="0"`, `role="link"`, and an accessible name (its own text, its alt text, or the target slide's name). Handle Enter and Space on it with the same code path as the click (`present.ts:1442-1456`). The show's capture key handler (`present.ts:1281-1330`) currently owns Space and arrows; Space on a focused link must activate the link, not advance. Do this in the present render path only: in the editor the same node must not become a tab stop.
5. **Name each slide section.** Set `aria-label` on each `section` from the slide's `name` or its first text, so browsing by region works.

New strings (all catalogs): "Slide {n} of {total}" if introduced; possibly none otherwise.

Rejected: a separate "accessible view" of the deck (duplicates the renderer); reading order controls in the model (worth having, but a format addition and a separate issue).

## Acceptance criteria

- [ ] Arriving on a slide with unrevealed steps: the status region's text contains none of the hidden elements' text.
- [ ] Each step-hidden node has `aria-hidden="true"`; after its step it does not.
- [ ] Revealing a step updates the status region with the newly revealed text.
- [ ] Arriving on a slide with an element that has `alt`: the status text includes the alt text.
- [ ] In the show, every element with a link is reachable with Tab, exposes `role="link"` and a non-empty accessible name, and Enter follows it (slide link, state link, web link through the existing offline gate).
- [ ] Space and the arrow keys still advance when focus is not on a link.
- [ ] In the editor canvas and thumbnails, linked elements are not tab stops.
- [ ] Reduced-motion and normal modes behave the same for all of the above.
- [ ] Verified by ear with at least one screen reader; the PR says which one and what was heard.

## Tests

- Add `scripts/test-slides-present-a11y-browser.mjs` (headless Chromium): build a deck in the page with three stepped texts, one image with `alt`, and one linked shape; start the show; assert the `.aria-status` text before and after a step, the `aria-hidden` attributes, that Tab focuses the link node, and that Enter changes the current slide. Register it in a browser job in `.github/workflows/ci-slides.yml`.
- Extend `scripts/test-slides-steps.ts` only if the pure step logic changes (it should not).
- Run `scripts/test-slides-speaker-links-browser.mjs`: it covers link behaviour in the speaker view and must stay green.

## Out of scope

- An in-show help sheet (MP-08).
- Per-paragraph builds (MP-01).
- A reading-order control in the editor, live captions, and a deck-wide missing-alt check (the last belongs with the validator work in F-09 or the Showcase in SC-02).
- Editor chrome accessibility (FH-17).

## Notes for the implementer

- Zone: slides app. Files: `slides/src/present.ts` (hot file), `slides/src/render.ts`, `slides/reveal-lite.ts` (read `docs/DECISIONS.md` "The slides shell diet": Reveal is stubbed down to named controllers; do not assume a Reveal feature exists).
- `render.ts` is shared by the editor, thumbnails, the show and print. Gate the link attributes on the present render options, the way `hidePlaceholders` is gated (`render.ts:28`).
- The audience copy and present-only file run the same show code; test one of them.
- Every document string that reaches an attribute here is plain text into `aria-label`; set it with `setAttribute`, never by string-building HTML.

---
id: FH-18
title: "Speaker view popup gets `dir` and `lang`; dates follow the UI locale"
epic: 8-first-hour
type: bug
priority: P3
size: S
evidence: code
labels: [bug, "priority:P3", "size:S", "evidence:code", "area:present"]
depends_on: []
related: [MP-10, FH-16]
upstream: []
---
## Summary

The interface language chosen in Bento is applied to the main window only. The speaker-view popup is a second document that never receives `dir` or `lang`, so in Arabic, Hebrew or Persian its layout stays left-to-right and a screen reader is told nothing about its language. Separately, the editor's own timestamps (backup time, restore prompt, version history, comment dates, the speaker clock) are formatted in the browser's locale, not the language the user picked.

**Read this first:** this was found by reading code. Nobody has looked at the popup in an RTL locale. Reproduce before fixing.

## What the user experiences

- A presenter who set the interface to Arabic opens the speaker view (S). The editor is mirrored; the speaker window is not: controls sit in left-to-right order and text aligns left.
- A user whose browser is English but who chose Deutsch in Bento sees "Backed up in this browser" in German next to a time formatted the English way, and version-history rows dated "Nov 23, 10:15 AM" in a German interface.

## Reproduce

Direction:

1. Open the app, open the language menu (globe / settings), install and choose an RTL language pack (Arabic, Hebrew or Persian).
2. Confirm the editor chrome mirrors.
3. Start the slideshow and press S. In the popup, inspect `document.documentElement.dir` and `.lang` in DevTools: expected today, both empty, and the layout is left-to-right.

Dates:

1. With the browser language set to English (United States), choose Deutsch in Bento.
2. Make an edit and wait for the backup note in the top bar; open File ▸ Version history.
3. Expected today: times and dates in US format inside a German interface.

## Evidence

Nothing here was observed in the running app. Confirmed in code now:

- `slides/src/i18n.ts:129-133` `applyDirection` sets `dir` and `lang` on `document.documentElement` of the main window only.
- The popup is painted by `paintSpeaker` (`slides/src/screens.ts:58-67`): it sets `d.title`, copies the main document's `<style>` elements into the popup head, sets `d.body.className` and `d.body.innerHTML`. It sets neither `dir` nor `lang`. `openSpeakerWindow` (`screens.ts:90-102`) opens `window.open('', 'bento-speaker', …)` and calls it.
- The show's `openSpeaker` (`slides/src/present.ts:1003`) builds the body and adds a style block (`present.ts:1076-1085`); no direction is set there either.
- Browser-locale formatting (an empty locale list means "the browser's default"):
  - `slides/src/editor/editor.ts:3132` backup time, `toLocaleTimeString([], …)`
  - `editor.ts:3536` restore prompt, `toLocaleString([], …)`
  - `editor.ts:3600` version history rows, `toLocaleString([], …)`
  - `slides/src/present.ts:1098` speaker clock, `toLocaleTimeString([], …)`
  - `slides/src/editor/comments.ts:40` comment date, `toLocaleDateString()`
- The chosen UI locale is available as `locale()` from `kernel/src/i18n.ts`, imported in `slides/src/i18n.ts:24` as `localeCode`, and `isRtl()` is at `i18n.ts:113`.

Deliberately different, do not change: the `{{date}}` and `{{time}}` **document fields** (`slides/src/render.ts:85-86`) follow the viewer's locale by design; `slides/src/datefmt.ts:4-5` says so ("Bare `{{date}}` follows the VIEWER's locale"). `docs/PLATFORM.md` also rules that locale never enters the format.

Not verified: whether the copied stylesheet's logical properties are enough for the speaker layout to mirror once `dir="rtl"` is set, or whether `.sv-*` rules use physical `left` / `right` that need attention.

## How others do it

- PowerPoint and Keynote: Presenter View follows the application's language and direction; it is the same UI toolkit.
- Google Slides: the presenter window is opened with the same `lang` and `dir` as the editor.
- Any multi-window web app: every document sets `lang` on its root; WCAG 3.1.1 (Language of Page) applies per document.

## Proposed change

1. In `paintSpeaker` (`screens.ts`), set `d.documentElement.lang` and `d.documentElement.dir` from the same source `applyDirection` uses. Import `isRtl` and the locale getter from `slides/src/i18n.ts`, or export a small `directionAttrs()` helper there and use it in both places so they cannot drift. `paintSpeaker` is called on every repaint, so a language change while the popup is open is picked up on the next paint; also call it from wherever the language is switched if the popup is open (find the language-change path; `applyDirection` callers are the place).
2. Audit `.sv-*` rules in `slides/src/styles.css` and the inline style block in `present.ts` for physical `left` / `right` / `margin-left` that should be logical, and fix the ones that break the mirrored layout. Slide previews inside the speaker view must stay left-to-right, exactly as the document surface is pinned LTR in the editor (`styles.css:207-215`).
3. Add one helper, for example `uiLocale()` in `slides/src/i18n.ts`, returning the chosen locale code, and pass it as the first argument at the five call sites listed above instead of `[]` or nothing. Keep the existing option objects.
4. Leave `render.ts:85-86` alone.

No new strings.

Rejected: formatting dates by hand; `Intl` with the UI locale is enough and costs nothing.

## Acceptance criteria

- [ ] With an RTL UI language, the speaker popup's root has `dir="rtl"` and `lang` equal to the UI locale; with an LTR language, `dir="ltr"`.
- [ ] The speaker view's controls mirror in RTL; slide previews and notes text direction are unaffected (notes use `dir="auto"` if they already do; do not regress).
- [ ] Switching the UI language while the popup is open updates its `dir` and `lang` without reopening it.
- [ ] The five timestamps are formatted with the UI locale: with browser `en-US` and UI `de`, the backup time is 24-hour and the version-history month is German.
- [ ] `{{date}}` and `{{time}}` fields on slides still follow the viewer's browser locale.
- [ ] No new string, no new dependency.

## Tests

- Extend `scripts/test-slides-speaker-layout-browser.mjs` (it already opens the speaker popup against a built shell): set an RTL locale, open the popup, assert `documentElement.dir === 'rtl'` and `lang`, and assert with `getBoundingClientRect` that two named controls swapped horizontal order relative to the LTR run. If setting an RTL locale needs a language pack the rig cannot load, set the locale through the same internal call the language menu uses and say so in the rig header.
- Add a node rig `scripts/test-slides-ui-locale-dates.ts` only if the formatting is factored into a pure helper; otherwise assert in the browser rig that the backup note's text matches `new Intl.DateTimeFormat('de', …)` output when the UI locale is `de` and the context locale is `en-US` (Playwright `locale: 'en-US'`).
- The rig must fail on the parent commit (popup `dir` is empty there).

## Out of scope

- Speaker-view features: build steps, notes font size, timer (MP-10).
- A document-level language field, or a "start" text alignment for RTL slide text (both are format additions).
- Number formatting in charts and count-ups.

## Notes for the implementer

- Zone: slides app. Files: `slides/src/screens.ts`, `slides/src/i18n.ts`, `slides/src/present.ts` (hot file), `slides/src/editor/editor.ts` (hot file; three one-line changes), `slides/src/editor/comments.ts`, possibly `slides/src/styles.css`, `CHANGELOG.md`.
- `kernel/src/i18n.ts` is kernel zone: use what it already exports; do not change it.
- RTL chrome landed upstream as its own piece of work (branch names `claude/rtl-chrome`, `claude/rtl-text-direction` exist upstream); read `docs/i18n-packs.md:373-375` on what a pack cannot fix by itself before touching direction handling.

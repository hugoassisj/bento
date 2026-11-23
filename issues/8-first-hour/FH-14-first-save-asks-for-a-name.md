---
id: FH-14
title: "First save asks for a name while the title is still the default"
epic: 8-first-hour
type: enhancement
priority: P2
size: S
evidence: seen
labels: [enhancement, "priority:P2", "size:S", "evidence:seen", "area:editor"]
depends_on: []
related: [SC-05, FH-05, FH-10]
upstream: []
---
## Summary

A deck built from the starter keeps the starter's title, "Bento Slides Showcase", unless the user finds the small title field in the top bar. The first save then writes `Bento_Slides_Showcase.bento.html` without ever asking what the deck is called. Before the first save of a deck whose title is still a default, put the title field in front of the user so the file gets its own name.

## What the user experiences

- A newcomer chooses File ▸ Start from scratch, builds a quarterly update, presses Ctrl/⌘+S. The saved file is named after the demo deck. The browser tab and `{{title}}` fields also still say "Bento Slides Showcase".
- Where the browser has no in-place save (Firefox, Safari, or a file not opened through the extension), every Ctrl/⌘+S downloads another copy, so the Downloads folder fills with `Bento_Slides_Showcase (1).bento.html`, `(2)`, and so on, all carrying the demo's name.

## Reproduce

1. Open http://localhost:5173. The Showcase deck loads; the title field reads "Bento Slides Showcase".
2. File ▸ Start from scratch…, confirm. The title field still reads "Bento Slides Showcase".
3. Add a text box and type something.
4. Press Ctrl/⌘+S.
   - In a browser with the File System Access API a save dialog opens with `Bento_Slides_Showcase.bento.html` suggested.
   - Without it, a file of that name downloads immediately. Press Ctrl/⌘+S again: a second copy downloads.

## Evidence

Observed in the running app during the first-deck journey: the download was `Bento_Slides_Showcase.bento.html` with no name prompt, and each Ctrl+S downloaded another copy. This was the **download fallback only**: the native save picker cannot appear in headless Chromium, so the journey removed `showSaveFilePicker` to exercise the fallback. The picker path in step 4 above is inferred from code and has not been watched.

Confirmed in code now:

- The file name comes from the title: `suggestedFileName` in `kernel/src/save.ts:714-721` replaces non-word characters in `doc.title` and appends `.bento.html`, falling back to `Untitled`.
- The starter sets the title: `slides/src/starterdeck.ts:692` `doc.title = 'Bento Slides Showcase'`.
- Start from scratch replaces the slides and nothing else (`slides/src/editor/editor.ts:1308-1317`); the title is untouched.
- The title field is the `input.ed-title` built at `editor.ts:406-414`; its tooltip already says it is "the suggested file name".
- Save enters at `Editor.save` (`editor.ts:3653`) and goes straight to `saveRevision` / `saveFile`; nothing looks at the title first.
- Whether the open document is the app's own starter is known at boot: `bootWith(doc, docIsFresh)` in `slides/src/main.ts:151`, set from `!parsed` at `main.ts:97-105`.
- Recorded rule: "Names are typed where they appear, never in `prompt()`" (`docs/DECISIONS.md:12121`).

## How others do it

- PowerPoint and Keynote: the first save opens a Save As sheet with the name field focused and "Presentation1" / "Untitled" selected, so typing replaces it.
- Google Slides and Figma: "Untitled presentation" / "Untitled" sits in the title bar, visibly a placeholder, and clicking it renames.
- Penpot: new files are created through a named-file step.

## Proposed change

Keep the change in the slides app; do not touch `kernel/src/save.ts`.

1. Define "default title" in one helper in the editor: the title equals the starter's title while the deck is no longer the untouched starter (it has been edited or Start from scratch was used), or equals `Untitled`, or is empty. Export the starter's title as a constant from `starterdeck.ts` rather than repeating the string.
2. In `Editor.save`, before `saveRevision`, when the save is user-initiated (not auto-save), the document has never been saved to a file in this session, and the title is a default: do **not** open a dialog. Instead focus and select the top-bar title field, show a short inline hint anchored to it ("Name this deck, then press Enter to save"), and stop. Enter in the field commits the title and continues the save; Esc or a second Ctrl/⌘+S saves with the current title. This is "typed where it appears" and costs no new modal.
3. Make the default state visible at rest: when the title is a default, style the field as a placeholder (muted) so it reads as "not named yet".
4. Do not interrupt: auto-save, Save a copy, saves of a file that already has a handle or was opened from disk, or a deck whose title the user has edited.
5. On phones the title can be off-screen in the scrolled top bar; in that case skip the interception rather than focusing something invisible (phone work is parked; see PK-02).

New strings (all catalogs): the hint sentence.

Rejected: `prompt()` (ruled out); renaming the deck automatically from its first slide's text (surprising, and wrong for decks that start with a section slide); changing `suggestedFileName` (kernel zone, and other apps share it).

## Acceptance criteria

- [ ] After Start from scratch, the first Ctrl/⌘+S focuses the title field with its text selected and shows the hint; no file is written yet.
- [ ] Typing a name and pressing Enter saves once, and the suggested or downloaded file name is derived from the typed name.
- [ ] Pressing Ctrl/⌘+S a second time without typing saves with the existing title (the user is never trapped).
- [ ] A deck opened from an existing file, or whose title was already changed, saves exactly as before with no interception.
- [ ] Auto-save never triggers the interception.
- [ ] While the title is a default, the field is visibly styled as a placeholder; after a rename it is not.
- [ ] The hint string exists in every catalog.

## Tests

- Add `scripts/test-slides-first-save-name-browser.mjs` (headless Chromium, trusted keyboard input). The rig stubs `window.showSaveFilePicker` itself and records the `suggestedName` it is called with. Cases: (1) starter deck, Start from scratch, Ctrl+S: focus is on `.ed-title`, the stub was not called; type a name, Enter: the stub is called once with a name derived from what was typed. (2) Ctrl+S twice without typing: the stub is called on the second press. (3) A page booted with an embedded document block (rewrite `#bento-doc` in the served HTML) saves on the first press with no interception. Register it next to `scripts/test-slides-save-browser.mjs` in `.github/workflows/ci-slides.yml`.
- Do not add cases to `scripts/test-slides-save-browser.mjs`: it is a thin wrapper over the shared save-queue helper (`scripts/lib/savequeue-browser.mjs`) that spaces and dash also run.
- Run `scripts/test-slides-save-browser.mjs` and `scripts/test-slides-save-copy-browser.mjs` to confirm the queue behaviour is unchanged.

## Out of scope

- Resetting the title when Start from scratch is chosen (SC-05 owns that; when it lands, this issue's default-title check simply sees `Untitled`).
- The repeated-download behaviour itself where the browser cannot save in place. That is a platform limit the app already explains; improving the wording belongs with FH-10.
- Anything in `kernel/src/save.ts`.

## Notes for the implementer

- Zone: slides app only. Files: `slides/src/editor/editor.ts` (hot file: the save method and the top bar builder), `slides/src/starterdeck.ts` (export a constant), `slides/src/styles.css`, catalogs, `CHANGELOG.md`.
- The save path is serialised through a queue (`slides/src/saving.ts`); do the title check before entering the queue so an auto-save racing the user's save is unaffected.
- Reproduce the picker path in a real desktop Chrome before finishing: the audit only saw the download fallback.
- Upstream Q&A #899 and #992 show users are already confused about file identity; a deck that names itself after the demo makes that worse, which is the argument to make upstream.

---
id: SC-05
title: "Start from scratch: blank or keep this look; reset the title"
epic: 3-showcase
type: enhancement
priority: P1
size: S
evidence: seen
labels: [enhancement, "priority:P1", "size:S", "evidence:seen", "area:showcase"]
depends_on: []
related: [F-02, FH-05, FH-14, SC-04, F-01]
upstream: []
---
## Summary

Start from scratch is how a newcomer leaves the Showcase to make their own deck. It replaces the slides with one white blank slide and keeps everything else: the deck is still titled "Bento Slides Showcase", it still carries the Showcase's 18 tokens and theme, and the blank slide uses none of them. The user gets neither a clean file nor the look they just saw. Offer the choice explicitly, and reset the title.

## What the user experiences

A person chooses File, Start from scratch, confirms, and gets one empty white slide. The title in the top bar still says "Bento Slides Showcase", so the first save downloads `Bento_Slides_Showcase.bento.html`. The Tokens tab still lists the Showcase's tokens, none of which the white slide follows. If they wanted the Showcase's look for their own content, it is gone from the canvas; if they wanted a clean start, the leftovers are confusing.

## Reproduce

1. Open the app in a fresh profile.
2. File menu (the wordmark), Start from scratch…, accept the confirmation.
3. Read the top bar title, then in the console: `window.bento.doc.title`, `Object.keys(window.bento.doc.theme.tokens.set).length`, `window.bento.doc.slides[0].background`.
4. Result: `"Bento Slides Showcase"`, `18`, `"#FFFFFF"`.

## Evidence

Observed during the audit (first-deck journey): the title and tokens survive; the first save takes the demo's name; typing on the empty slide arms drawing tools (that part is FH-05). The journey also reported that three components survive.

Confirmed in code now:

- `startFromScratch` (`slides/src/editor/editor.ts:1308-1318`) asks with `window.confirm`, then commits one change: `this.store.doc.slides = [instantiateLayout(blank)]`. It touches nothing else, so `title`, `theme`, `theme.tokens`, `fonts`, `assets`, `layouts` and `meta` stay.
- The blank layout is a literal white slide: `{ id: 'layout-blank', …, background: '#FFFFFF', … }` (`slides/src/model.ts:1444`).
- The starter's title is set at `slides/src/starterdeck.ts:692`.

Not confirmed: that components survive. Components are found by scanning slides for elements marked as a main (`components()` in `slides/src/components.ts:42-56`), so replacing every slide should remove them; the journey's observation may have been the Tokens tab before a refresh. Check in the app. Also not confirmed: whether the Showcase's embedded assets and fonts stay in the file after the slides that used them are gone (no pruning step was found by search).

## How others do it

Keynote opens a theme chooser before a new deck exists. PowerPoint's File, New offers Blank or a themed template. Figma Slides opens a template picker with a blank option. In each, the choice between "blank" and "this look" is explicit and the new file is untitled.

## Proposed change

1. Replace the bare confirmation with a small dialog built on the kernel dialog primitive (`kernel/src/ui/dialog.ts`; call it, do not edit it). Two choices and Cancel:
   - **Keep this look**: one slide from the deck's own Title layout (SC-04) or, until that exists, the built-in Title layout bound to the theme (F-01). Theme, tokens, fonts and saved layouts stay. Demo slides, their components and now-unreferenced assets go.
   - **Blank**: one blank slide; theme reset to the app default; tokens, saved layouts, unreferenced assets and fonts removed.
   The dialog says how many slides will be replaced and that Ctrl+Z undoes it.
2. In both cases set the title to a localised "Untitled deck" when the current title is still the starter's, and focus the title field. Never rename a deck the user already named.
3. Keep it one undoable commit. Identity is untouched: `docId` and the live session stay the document's own (do not mint a new `docId`; that is Save, Duplicate as new deck).
4. If F-02 (theme presets) lands, its presets appear in this same dialog; design the dialog with room for them.

New strings (dialog title, two choices with one-line descriptions, "Untitled deck") go through `t()` and into all eight catalogs.

## Acceptance criteria

- [ ] Start from scratch shows the two choices; Escape and Cancel change nothing.
- [ ] Keep this look: one slide that follows the deck's palette (changing a slot recolours it); tokens intact; no demo slide remains.
- [ ] Blank: `Object.keys(doc.theme.tokens?.set ?? {}).length === 0`, `(doc.layouts ?? []).length === 0`, no asset in `doc.assets` that no element references.
- [ ] When the title was "Bento Slides Showcase" it becomes the localised untitled name in both cases; a user-set title is unchanged.
- [ ] One Ctrl+Z restores the whole previous deck, title included.
- [ ] `docId` and `collab` are identical before and after.
- [ ] The command palette entry `start-scratch` opens the same dialog.
- [ ] Strings exist in all eight catalogs.

## Tests

`scripts/test-slides-start-scratch-browser.mjs`: drives both choices with real mouse input against the built shell, asserts the criteria above, the undo, and unchanged identity. Register in `.github/workflows/ci-slides.yml`. A node unit for the pure part (what "blank" removes) can sit beside it if that logic is factored out of `editor.ts`.

## Out of scope

- Theme presets (F-02).
- What the empty slide teaches and the typing-arms-tools bug (FH-05).
- Asking for a file name at first save (FH-14).

## Notes for the implementer

Slides zone; hot file `editor.ts`. The dialog must be the kernel primitive, not another `.ed-about-overlay` (FH-09). Removing tokens and layouts is a document edit that other collaborators receive: make sure the single commit carries all of it so replicas converge. The recorded rule that names are typed where they appear, never in `prompt()`, applies: focus the title field instead of asking.

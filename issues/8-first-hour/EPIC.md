---
id: EPIC-8
title: "Epic 8 · The first hour, and editor polish"
labels: [epic]
---
# Epic 8 · The first hour, and editor polish

## Goal

A PowerPoint, Keynote or Google Slides user can build a six-slide deck in their first sitting without losing text, without the editor doing something they did not ask for, and without needing the mouse for everything.

## Why it matters

The audit's first journey played exactly that user: twenty minutes, six slides, from an empty deck. The editor's power features worked; the basics bit. Placeholder prompts were saved as real slide content and shown to the audience. Tab in a text box ended the edit and the next keystrokes wiped the text. Opening any text box selected everything, so one stray key replaced a title. Dropping a picture did nothing. Menus could not be closed from the keyboard. None of these is hard; each is a moment where a newcomer loses work or trust, and two of them (FH-01, FH-02) destroy content silently.

This epic is the long tail that the shared foundations (Epic 1) do not cover. It needs no format change except FH-04 and FH-08.

## Children, in recommended order

Take the two P0 bugs first, then the P1 items, then the rest. Items on the same line of thought are grouped.

**Content is lost or published by accident (P0)**

- [ ] FH-01 · Placeholder prompt text becomes real slide content
- [ ] FH-02 · Tab in a plain text box leaves the box; the next keystrokes replace the text

**Text behaves the way people expect (P1)**

- [ ] FH-03 · Entering text editing places the caret where you clicked (after FH-01)
- [ ] FH-05 · Empty state: open on a Title layout with the title focused; typing must not arm tools (after FH-01)
- [ ] FH-06 · Dropping an image or media file onto the canvas does nothing
- [ ] FH-09 · Menus and dialogs: keyboard and screen-reader semantics
- [ ] FH-10 · Toasts are announced; failures offer an action
- [ ] FH-04 · Style part of a line: colour, size and font on a text run (format addition; propose first)

**Friction (P2)**

- [ ] FH-07 · Image placeholders: a real picture slot that fills and crops (after FH-01; pairs with FH-06)
- [ ] FH-12 · Lists: ordered-list autoformat; bullet and number buttons in the Text section
- [ ] FH-11 · Slide list: keyboard focus; Move earlier and later
- [ ] FH-14 · First save asks for a name while the title is still the default
- [ ] FH-15 · Side panels auto-collapse in a narrow window
- [ ] FH-20 · Find in deck, and jump to a slide, from ⌘K
- [ ] FH-16 · Present mode for screen readers: hidden steps, alt text, focusable links
- [ ] FH-08 · Show on every slide: footers and repeated elements (format addition; propose first)

**Polish (P3)**

- [ ] FH-13 · Crop with edge handles
- [ ] FH-17 · Editor accessibility: landmarks, forced-colors, field border contrast
- [ ] FH-18 · Speaker view popup gets `dir` and `lang`; dates follow the UI locale
- [ ] FH-19 · Polish batch: hidden-slide thumbnail, toast overprint, layout picker thumbnails, text colour label, fractional sizes

## Dependencies and overlaps

- **FH-01 before FH-03, FH-05 and FH-07.** Today's select-all on opening a box hides the placeholder bug on the common path; changing where the caret lands, or selecting a placeholder for the user, exposes it.
- **FH-02 and FH-03** share the mechanism "a key pressed with a text box selected reopens it and replaces everything" (`typeIntoText`). FH-02 removes the Tab route into it; FH-03 decides what typing on a selected box should do.
- **FH-05 relates to F-02 and SC-05.** All three change `startFromScratch`: FH-05 chooses the first slide and where typing goes, SC-05 offers "blank or keep this look" and resets the title, F-02 adds theme presets. Land them in that order or under one owner.
- **FH-06 and FH-07** share the image-insert path; FH-10 owns the "could not be read" message both use.
- **FH-11 relates to F-05.** Move earlier/later, New slide and Duplicate slide should be registered once as commands (F-05) and then surfaced in the slide list (FH-11), not implemented twice.
- **FH-09** consumes the shared menu and dialog primitives in `kernel/src/ui/`; check upstream for an in-flight migration before proposing it there.
- **FH-12** builds on the list code FH-02 touches; do FH-02 first.
- **FH-20** builds on the command palette work in F-05 and F-06.
- **Hot files.** Almost every child edits `slides/src/editor/editor.ts` or `slides/src/editor/canvas.ts`, and anything with a new string edits all eight catalogs and `CHANGELOG.md`. Do not run two children that touch the same function in parallel; rebase small and often.

## Definition of done

- Every child is closed with a rig that failed before and passes after, registered in CI.
- The first journey can be repeated end to end (empty deck, title, bullets, a picture with a caption, two columns, three stats, a closing slide, speaker notes, present, save) with no lost text, no prompt text in the show, no dead drop, and every menu and dialog operable from the keyboard.
- `tsc -b`, `npm run build:single` and the slides CI slices are green; the shell's byte cost for the epic is recorded.
- No AI attribution anywhere; commits under the owner's identity; one concern per branch.

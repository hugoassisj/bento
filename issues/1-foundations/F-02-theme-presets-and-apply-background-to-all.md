---
id: F-02
title: "Theme presets on Start from scratch; apply a background to all slides"
epic: 1-foundations
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:design-system"]
depends_on: [F-01]
related: [SC-05, AS-10, FH-05]
upstream: ["nyblnet/bento discussion #545", "nyblnet/bento discussion #639"]
---
## Summary

There is no way to pick a look. A new deck inherits whatever the starter had, and the only theme control is editing palette slots one by one. Offer a small set of built-in palette-and-font presets when starting a deck and in the Theme section, and add "apply to all slides" for a slide background.

## What the user experiences

A PowerPoint or Keynote user looks for Themes and finds a single link, "Colors live in Tokens →". They change seven colour rows by hand and still have default fonts. In the audit, getting a coherent non-default look cost roughly 40–60 actions. Changing the background with five slides selected changed only one slide.

## Reproduce

1. Fresh load, File menu ▸ Start from scratch….
2. Look for any theme or template choice: there is none. The deck keeps the starter's tokens.
3. Right panel ▸ Theme section: one link to the Tokens tab.
4. Add four slides, shift-select all five thumbnails, change Background in the Slide section. Result: only the current slide changes.

## Evidence

- Observed in the running app during the audit (first-deck journey: no picker; background change applied to one of five selected slides).
- Confirmed in code now:
  - `slides/src/editor/editor.ts:1308` `startFromScratch()` replaces the slides with one blank slide and touches nothing else (theme, tokens, title all stay).
  - `slides/src/editor/inspector/slide.ts:281` the Theme section is the single link "Colors live in Tokens →".
- Upstream demand: discussion #545 asks for a place to discover themes; discussion #639 notes theming is limited.
- Not verified: the exact handler that applies a slide background and why a multi-slide selection is ignored. Locate it in `inspector/slide.ts` before designing the fix.

## How others do it

- PowerPoint: Design ▸ Themes and Variants, one click, live preview on hover.
- Keynote: a theme chooser on New, and Change Theme later.

## Proposed change

1. **Presets as data.** Add a small table of presets in the slides app (suggest a new `slides/src/themepresets.ts`): each is a name plus values for the existing theme keys only (`background`, `color`, `accent`, palette slots, `fontFamily`, `headingFamily`, `chartPalette`). No new format key: applying a preset writes ordinary `doc.theme` values. Four to six presets; at least one dark; fonts limited to the built-in faces and system stacks (no downloads).
2. **Where they appear.**
   - Start from scratch: replace the `window.confirm` with a small dialog built on the kernel dialog primitive (`kernel/src/ui/dialog.ts`, already used by Compress pictures) showing preset swatches plus "Keep this deck's look". Coordinate with SC-05, which owns title reset and "blank or keep".
   - Right panel ▸ Theme: a row of preset swatches above the Tokens link. Clicking applies in one undoable commit; hovering previews if cheap.
3. **Applying a preset** sets the theme values and runs the existing derive pass so every bound element follows. Elements with unbound literals are left alone; after F-01 that is only content the user styled by hand.
4. **Apply to all slides.** In the Slide section's Background row add an action "Apply to all slides" (and make a background change apply to every selected slide when several thumbnails are selected). One commit, one undo.
5. Strings: preset names, "Keep this deck's look", "Apply to all slides". All catalogs.

Rejected: shipping full template decks in the shell (byte cost; the gallery on bento.page already serves templates).

## Acceptance criteria

- [ ] Start from scratch offers at least four presets and "Keep this deck's look"; cancelling leaves the deck untouched.
- [ ] Applying a preset changes background, text, accent and font of slides built from built-in layouts (requires F-01) in one undo step.
- [ ] The Theme section shows the same presets; applying one from there behaves identically.
- [ ] Each preset passes a contrast check: text on background ≥ 7:1, accent on background ≥ 3:1.
- [ ] A preset writes only keys that already exist in `doc.theme`; `node scripts/build-schema.mjs --check` passes unchanged.
- [ ] With N thumbnails selected, a background change applies to all N; "Apply to all slides" applies to every slide; both are one undo step.
- [ ] No preset references a font that is not built in or a system stack.
- [ ] Shell byte cost reported; target under 2 KB compressed.

## Tests

- `scripts/test-slides-theme-presets.ts` (node): every preset has only known theme keys, meets the contrast thresholds, and after applying it to a document with bound layouts the resolved colours equal the preset's.
- `scripts/test-slides-theme-presets-browser.mjs`: Start from scratch → choose a preset → assert the slide background and title colour; undo restores; background apply-to-all with three slides.
- Register the node rig in `validate-slides/action.yml`, the browser rig in `ci-slides.yml` (`slides-editor-browser` job).

## Out of scope

- A gallery or downloadable themes.
- Per-mode (light/dark) palettes (DS-06).
- Generating a theme from a prompt (AS-10).

## Notes for the implementer

- Zone: slides app. No format change.
- The maintainer rejected `prompt()` and iterates on UI by taste after merge (the notes-pane toggle in upstream #976); keep the picker small and quiet.
- Hot files: `editor/editor.ts`, `editor/inspector/slide.ts`, every i18n catalog. Land after F-01; coordinate with SC-05 on the Start from scratch dialog so there is one dialog, not two.
- The starter deck travels in every file; presets do too. Keep them as compact data.

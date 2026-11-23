---
id: MP-15
title: "Present from the beginning; Present from here"
epic: 6-motion-presenting
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:present"]
depends_on: []
related: [F-05, F-06, FH-11]
upstream: []
---
## Summary

Every visible way to start the show starts at the current slide. Starting from slide 1 exists only as the F5 key, which nothing on screen mentions next to the Slideshow control, and the command palette lists a single "Present" with no hint of the difference. Add "From the beginning" to the Slideshow menu and the palette, and "Present from here" to a slide thumbnail's menu.

## What the user experiences

A speaker has been editing slide 9. They click Slideshow to rehearse the whole talk and the show opens on slide 9. They press Esc, scroll the slide list to the top, click slide 1, and click Slideshow again. PowerPoint and Keynote users look for "From Beginning" and do not find it. The reverse case is also missing: right-clicking a thumbnail offers New, Duplicate and Delete, but not "Present from here".

## Reproduce

1. Open the Showcase deck and select slide 5.
2. Click the Slideshow pill: the show opens on slide 5.
3. Esc. Open the pill's ▴ menu: "Present in this tab" and "Open speaker view". Neither starts at slide 1.
4. Press ⌘K, type "present": the palette shows one entry, "Present" (plus "Slideshow" and "Speaker view" under their own names).
5. Press F5: the show opens on slide 1. Press Shift+F5: it opens on the current slide.
6. Right-click a slide thumbnail: New slide, Duplicate slide, Delete slide.

## Evidence

Observed in the running app (audit journey 3): the pill and its menu start at the current slide (5 of 15); only F5 starts at 1; the palette shows one "Present".

Confirmed in code at `29b5c80`:

- `present(fromStart = false, fullscreen = true, at = …)` (`slides/src/editor/editor.ts:2756`) already supports both starts.
- The Slideshow pill calls `this.present(false, true)` (`slides/src/editor/editor.ts:608`); its menu has two rows, "Present in this tab" → `this.present(false, false)` and "Open speaker view" (`slides/src/editor/editor.ts:630-631`).
- The F5 command is the only caller that can pass `fromStart = true`: `{ id: 'present', label: 'Present', keys: 'F5', … run: (ev) => this.present(!ev?.shiftKey) }` (`slides/src/editor/editor.ts:3773`). A second command, `{ id: 'slideshow', label: 'Slideshow', … run: () => this.present(false, true) }` (`slides/src/editor/editor.ts:3842`), starts at the current slide.
- The thumbnail menu is `slideMenuItems` (`slides/src/editor/editor.ts:4469-4476`): New slide, Duplicate slide, separator, Delete slide.

## How others do it

- **PowerPoint**: Slide Show ▸ "From Beginning" (F5) and "From Current Slide" (Shift+F5), both as labelled buttons.
- **Keynote**: Play ▸ "Play Slideshow" starts at the selected slide; Option-click plays from the first; the toolbar Play button's behaviour is documented in the menu.
- **Google Slides**: the Slideshow button's caret offers "Start from beginning".

## Proposed change

Slides app only; no format change. This is deliberately small.

1. **Slideshow menu** (`slides/src/editor/editor.ts`, the `pItem(...)` block at 630): add a first row "From the beginning" → `this.present(true, true)`, with the key hint taken from the command list (`titleFor`), not hard-coded.
2. **Commands** (`slides/src/editor/editor.ts`, the command table around 3773 and 3842): rename so the palette shows two distinct entries, for example "Present from the beginning" (F5) and "Present from this slide" (Shift+F5), and remove the duplicate "Slideshow" entry or make it an alias with keywords. The F5 handler keeps both behaviours; give Shift+F5 its own command so its key hint is discoverable.
3. **Thumbnail menu** (`slideMenuItems`): add "Present from here" → `this.present(false, true, i)` above the separator.
4. **Tooltip** on the pill: mention F5 for "from the beginning" alongside the existing text.
5. The first-run pulse on the pill and the `bento-slideshow-started` flag (`slides/src/editor/editor.ts:617`) must keep working: starting from any of the new entries sets the flag, because it is set inside `present()`.

New strings go through `t()` into all eight catalogs; remove any label that becomes unused in the same change (the dead-key gate fails otherwise).

## Acceptance criteria

- [ ] The Slideshow ▴ menu has a "From the beginning" row that starts the show on the first linear slide regardless of the current slide.
- [ ] The main half of the pill still starts at the current slide.
- [ ] ⌘K, typing "present", shows separate entries for starting at the beginning and at the current slide, each with its key hint.
- [ ] F5 and Shift+F5 behave exactly as before.
- [ ] Right-click (and touch long-press) on a slide thumbnail offers "Present from here", and the show opens on that slide even when another slide is current.
- [ ] "Present from here" on a state slide or a hidden slide behaves sensibly: it opens on that slide's parent (state) or is not offered (hidden). State which in the change.
- [ ] After exiting, the editor returns to the slide where the show stopped, as today.

## Tests

- Extend `scripts/test-slides-menus-ia-browser.mjs` (the menus' information-architecture rig, registered in `.github/workflows/ci-slides.yml`): assert the Slideshow menu's rows and the thumbnail menu's rows.
- Extend the command-list rig used for the palette (`scripts/test-slides-command-palette-browser.mjs` if present; check the real name with `ls scripts | grep palette`): typing "present" yields both entries.
- A small browser assertion: start from the new menu row while slide 5 is current and read the show's counter (`1 / N`).

## Out of scope

- Slide, layout and list actions as commands (F-05) and palette synonyms (F-06); this issue only covers the present entries.
- Keyboard management of the slide list (FH-11).
- Rehearse mode (MP-17).

## Notes for the implementer

- Hot file: `slides/src/editor/editor.ts`. F-05 and F-06 edit the same command table; land after them or rebase carefully.
- Key hints come from the command list (`titleFor`); the 1.3.0 work removed hard-coded hints on purpose (see the commit note "the context strip's key hints come from the command list").
- `test-slides-hint-keys` gates key hints; run it.

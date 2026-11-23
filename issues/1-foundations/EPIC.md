---
id: EPIC-1
title: "Epic 1 · Shared foundations"
labels: [epic]
---
## Goal

Fix the handful of causes that both a person building a deck by hand and an AI agent building one from the documentation trip over. Every later epic assumes these.

## Why it matters

Each of these showed up at least twice in the audit of 1.3.0:

- **Theme reach.** A newcomer changed every theme colour and the slide did not change. The AI trial's layout-by-role decks came out white with navy ink regardless of the deck's theme. Same cause: built-in layouts and new elements carry hard-coded colours and fonts.
- **Text sizing.** The Text tool drops a fixed 600×120 box that can hang off the slide. An agent's automatic text height came out 635px tall. Both are "the box does not follow its text".
- **Commands.** Ctrl+M and Ctrl+D do nothing; ⌘K cannot offer slide actions and hides anything that does not apply right now. The same registry is what an in-editor assistant would call.
- **The checker.** `window.bento.validate()` reports three false overflows on the shipped starter and says nothing about unreadable contrast, overlap, an unknown element type or an invalid colour. Nothing it finds is shown in the editor.
- **Silent failure.** A document block with a JSON error opens the demo deck with no message.

## Children, in recommended order

- [ ] **F-11** An unreadable document block silently opens the starter deck (P0 bug, smallest, protects work)
- [ ] **F-07** Validator measures field tokens as literal text (P1 bug; unblocks SC-01)
- [ ] **F-08** Validator flags what it silently accepts: unknown element type, invalid colour, dangling parent, string-typed numbers
- [ ] **F-01** Built-in layouts and new elements follow the deck theme
- [ ] **F-02** Theme presets on Start from scratch; apply a background to all slides (after F-01)
- [ ] **F-05** Slide, layout and list actions become commands
- [ ] **F-06** ⌘K shows unavailable commands with the reason, and matches synonyms (after F-05 so the new commands get keywords too)
- [ ] **F-03** Text boxes size themselves
- [ ] **F-04** Text pasted onto the slide keeps its formatting, fits its box, and does not stack (after F-03)
- [ ] **F-09** Validator sees what people see: contrast, overlap, text outside its frame, clipped chart labels
- [ ] **F-10** Check deck panel (after F-07, F-08, F-09: a panel full of false findings would teach people to ignore it)

## Dependencies between them

- F-02 depends on F-01 (presets are pointless while layouts ignore the theme).
- F-06 is independent of F-05 but should land after it.
- F-04 reuses the sizing from F-03.
- F-10 depends on F-07; it is much better after F-08 and F-09.
- F-01, F-05 and F-10 all touch `slides/src/editor/editor.ts` and the i18n catalogs; do not run them in parallel without expecting conflicts there.

## Definition of done

- From Start from scratch, changing the theme's Background, Text and Accent 1 recolours a slide built from any built-in layout, and a newly inserted text box and shape.
- A text box created by a click hugs its text; overflow past the slide edge is visible in the editor.
- New slide, duplicate slide, delete slide, hide slide and apply layout are commands with shortcuts, present in ⌘K; ⌘K never answers "No matching command" for a command that exists.
- `window.bento.validate()` returns zero warnings for the shipped starter deck (with SC-01), and reports each of: unknown element type, invalid colour, dangling `parentId`, string-typed geometry, unreadable contrast, overlapping text.
- The editor has a Check deck panel listing those findings with a jump to the element.
- A file whose document block cannot be parsed shows a recovery card, never the starter deck.
- Every child has a registered rig; bug rigs fail on the parent commit.

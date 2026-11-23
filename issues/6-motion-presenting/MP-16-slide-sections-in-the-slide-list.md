---
id: MP-16
title: "Slide sections in the slide list"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:present", "format-change", "needs-upstream-discussion"]
depends_on: []
related: [FH-11, F-05, MP-09, FH-20]
upstream: ["nyblnet/bento discussion #583"]
---
## Summary

A deck has no sections. The slide list is one flat column, so a 40-slide talk cannot be folded into "Intro / Problem / Demo / Q&A", named, collapsed or moved as a block. Upstream discussion #583 asked for this; the maintainer answered "Yes, please, and thanks for offering", called sections "a real gap", and set two conditions: **propose how sections are stored before implementing** (additive, older files still open, older apps ignore sections, slide ids and the states tied to slides unchanged), and **keep the first version to the sidebar** (present mode, print and PowerPoint export can ignore sections at first). This issue is that storage proposal plus the sidebar work.

## What the user experiences

Someone with a long deck scrolls a flat list of thumbnails. There is no heading between parts of the talk, no way to collapse a finished part, and reordering a whole part means multi-selecting its slides and dragging them. PowerPoint, Keynote and Google Slides users expect sections or indented groups.

## Reproduce

1. Open the Showcase deck (19 slides, 15 in the linear flow).
2. Right-click a thumbnail: New slide, Duplicate slide, Delete slide. Nothing about sections.
3. Search the command palette (⌘K) for "section": no command.
4. Inspect `window.bento.doc.slides[0]`: no section-related key.

## Evidence

Read in code at `29b5c80` (not a behaviour that can be "seen"; it is an absence):

- The `Slide` interface (`slides/src/model.ts:646-703`) has `id`, `background`, `transition`, `elements`, `notes`, `themeRefs`, `name`, `stateOf`, `hidden`, `unnumbered`, `hover`, `comments`. No section field. `BentoDoc` has no section table.
- A slide's linear-flow membership is `inLinearFlow = (s) => !s.stateOf && !s.hidden` (`slides/src/model.ts:1551`).
- The slide list builds one thumbnail per slide in `makeThumb` (`slides/src/editor/editor.ts:2104-2160`); state slides render nested and smaller (`isState`), which is the only hierarchy today.
- Reordering works on units: `expand` (a slide plus its states) and `moveBlock` (`slides/src/editor/slidesel.ts:48`, `:78`), used by the thumbnail drop handler (`slides/src/editor/editor.ts:2370-2399`).
- The thumbnail menu is `slideMenuItems` (`slides/src/editor/editor.ts:4469-4476`).

Upstream: discussion #583 (opened 2026-09-29 by another contributor, who has not posted a proposal since; check the thread before starting so two people do not build this).

## How others do it

- **PowerPoint**: sections are named headers in the thumbnail pane; collapse, rename, move or delete a section with its slides; Section Zoom links to them.
- **Keynote**: slides are indented under a parent slide in the navigator; a parent collapses its children and moves with them.
- **Google Slides**: no sections; users ask for them.
- **Figma Slides**: slides sit in rows in grid view, which act as sections.

## Proposed change

### Storage proposal (to post upstream before building)

Three options were considered.

**A. A marker on the slide that starts a section (recommended).**
`Slide.section?: { name: string }`. A section runs from a slide carrying the marker to the slide before the next marker. Slides before the first marker belong to no section.

- Additive: one optional key on an existing object. No new table, no ids to keep in step.
- Merge-friendly: slides are keyed by id in the sync engine, and the marker travels with its slide. Two people renaming two sections touch two different slides. Moving a slide never leaves a dangling reference.
- Old shells: the key is unknown to them. A file opened and saved by an older shell keeps the key only on paths that preserve unknown fields; paths that rebuild slides key by key (paste, restore from a browser snapshot) drop it. The deck stays fully usable either way: the worst case is a deck that has lost its section headings. State this in the proposal.
- Rules: a marker on a state slide (`stateOf`) is ignored; a state always belongs to its parent's section. Deleting or moving away the slide that carries a marker hands the marker to the next slide of that section (editor behaviour, one undo step), so removing a section's first slide does not silently merge two sections.

**B. A deck-level table.** `doc.sections?: Array<{ id, name, first: <slide id> }>`. Central, but every slide move, delete or duplicate has to repair `first`, and concurrent edits to one array merge worse than edits to separate slides.

**C. A section id on every slide** plus a table of names. Robust to reordering, but writes a key on every slide and allows interleaved sections that the UI would then have to forbid.

**Never in the document:** which sections are collapsed. That is view state; keep it per browser, keyed by `docId`, as the notes-pane visibility is (`docs/DECISIONS.md`, the notes entry near the end: visibility is "never document state").

### Sidebar (first version)

In `slides/src/editor/editor.ts` (`makeThumb` at 2104 and `rebuildSidebar` at 2195, which calls it) and `slides/src/styles.css`:

1. A header row above the first slide of each section: name, slide count, a collapse chevron. Rename by typing in place (never `prompt()`).
2. Collapse hides the section's thumbnails; the header stays. The current slide's section never collapses out from under it.
3. Thumbnail menu: "Add section here", and on a header: Rename, Remove section (keeps the slides), Move section up / down, Delete section and its slides (with the existing delete confirmation rules).
4. Dragging a header moves the whole section through `moveBlock`.
5. Commands for each action so they reach the palette (see F-05).

### Explicitly not in the first version

Present mode, speaker view, print, PDF and PowerPoint export ignore sections, as the maintainer asked.

### Mechanics

- `slides/src/model.ts`: add the key with a doc comment; run `node scripts/build-modelkeys.mjs` and `node scripts/build-schema.mjs`.
- `slides/src/untrusted.ts`: gate the new key (string, bounded length, plain text).
- `docs/format.md` and `docs/agents.md`: document it.
- `convert/`: confirm the PowerPoint writer reports the key as not carried instead of failing.

## Acceptance criteria

- [ ] The storage proposal is posted to upstream discussion #583 and its outcome is recorded here before the format key is merged anywhere.
- [ ] A deck with sections opens in the 1.3.0 shell without error and presents identically.
- [ ] Add, rename, collapse, expand, move and remove a section from the slide list; each is one undo step.
- [ ] Moving or deleting the first slide of a section keeps the section (the marker moves to the next slide).
- [ ] A state slide never starts a section and always moves with its parent.
- [ ] Collapsed state survives a reload in the same browser and is not in `window.bento.serialize()`.
- [ ] `build-modelkeys --check`, `build-schema --check`, `test-schema-frozen` pass.
- [ ] The show, the speaker view and print output are unchanged by the presence of sections.

## Tests

- Node rig `scripts/test-slides-sections.ts`: pure section maths (which slides a section holds; marker hand-over on delete and move; states stay with parents), next to `scripts/test-slides-multiselect.ts`, which covers `slidesel.ts`. Register in `.github/actions/validate-slides/action.yml`.
- Browser rig `scripts/test-slides-sections-browser.mjs`: add, rename, collapse and drag a section with real mouse input; assert the document and the DOM. Register in `.github/workflows/ci-slides.yml`.
- An old-shell check in the style of `scripts/test-slides-alpha-refs.ts`: a document with the key passes the released parser.

## Out of scope

- Section-aware navigation in the show, Section Zoom, a table of contents.
- Sections in print, PDF or PowerPoint export.
- Find in deck (FH-20) and the audience-window grid (MP-09), which could later group by section.

## Notes for the implementer

- `format-change` and `needs-upstream-discussion`: build the sidebar here if useful, but the key's name and shape are the maintainer's call.
- Hot files: `slides/src/editor/editor.ts`, `slides/src/model.ts`, `slides/src/styles.css`, i18n catalogs.
- FH-11 (keyboard focus and Move earlier/later in the slide list) touches the same thumbnail code; coordinate.

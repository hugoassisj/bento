---
id: FH-20
title: "Find in deck, and jump to a slide, from ⌘K"
epic: 8-first-hour
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:commands"]
depends_on: []
related: [F-05, F-06, FH-11, AS-06]
upstream: []
---
## Summary

There is no way to search a deck. In a 40-slide deck, finding the slide that mentions "Q3 churn" means scrolling thumbnails and reading them. The command palette (⌘K) searches commands only. Make the palette also search slide content and jump to the match, and add "go to slide N". Replace comes later, as its own issue.

## What the user experiences

- Ctrl/⌘+F opens the browser's find bar, which searches the editor chrome and the one slide on the canvas. It cannot see other slides, speaker notes or table cells, and it highlights text inside thumbnails that cannot be clicked into.
- ⌘K with a word from a slide returns "No matching command".
- There is no "go to slide 17" other than scrolling the slide list or pressing PageDown sixteen times.

## Reproduce

1. Open the Showcase deck. Press Ctrl/⌘+K and type `pulse` (slide 8's title is "Charts with a pulse."). Result: No matching command.
2. Type `8` or `slide 8`. Result: No matching command.
3. Press Esc, then Ctrl/⌘+F and type `pulse`. The browser's find bar reports matches in thumbnails; Enter does not take you to that slide.

## Evidence

Observed in the running app (main session): ⌘K hides anything that is not a currently applicable command and shows "No matching command" for other input (seen with `align` and nothing selected; the same path answers a content word).

Confirmed in code now:

- The palette's whole data source is the command list: `rank(cmds, query)` filters by `when` and fuzzy-matches the label, the English label and the id (`slides/src/editor/commands.ts:88-104`); the empty state is `t('No matching command')` (`commands.ts:155-160`). `openPalette(cmds)` (`commands.ts:107`) takes only commands.
- The palette command is declared at `slides/src/editor/editor.ts:3774`; slide navigation commands are only `next-slide` and `prev-slide` (`editor.ts:3833-3834`).
- A search of `slides/src` for find or replace UI finds none (the only hit for the words is a string replace helper in `slides/src/editor/markdown.ts`). Confirmed in the earlier editor audit as well.
- Content that would need searching: text elements' `html`, table cells, code elements' `content`, slide `notes`, slide `name`, element `name` and `alt`, chart titles in `option`. There is no shared "plain text of a slide" helper exported today (a search for `plainText|textOf|stripHtml|htmlToText` exports returns nothing); upstream's unmerged Assistant branch (PR #532) has one in `slides/src/editor/assistant/material.ts` ("addressed outline"), which is not on `main`.

Not verified: how the browser's find bar behaves in the packaged single file versus the dev build.

## How others do it

- PowerPoint: Ctrl+F opens Find with Find Next across slides and notes; Ctrl+H is Replace; typing a number then Enter in slide show jumps to that slide.
- Keynote: ⌘F searches slides and presenter notes with a result list; "Find & Replace" is a mode of the same panel.
- Google Slides: Ctrl+F is an in-app find that steps through all slides; Ctrl+H replaces.
- Figma: ⌘/ quick actions search commands; ⌘F searches layers and text across pages with a result list that selects the layer.
- Penpot: layer search in the sidebar.

## Proposed change

Phase 1 (this issue): find and go-to through the palette.

1. **Index.** Add a pure module, for example `slides/src/editor/deckfind.ts`: `indexDeck(doc)` returns entries `{ slideIndex, elementId?, kind: 'text' | 'cell' | 'code' | 'notes' | 'name' | 'alt', text }`, with HTML stripped through the sanitizer's text path or `DOMParser` (never `innerHTML` on a live node), and `findInDeck(index, query)` returns ranked matches with the matched range for highlighting. Case-insensitive, diacritic-insensitive (`normalize('NFD')`), substring first, then the palette's existing `fuzzy` as a fallback. Build the index lazily when the palette opens and reuse it while it is open; a 100-slide deck must stay under a frame.
2. **Palette sections.** Extend `openPalette` to accept extra providers. With a query, show up to N command matches under "Commands" and up to N content matches under "In this deck", each row showing the slide number, a snippet with the match emphasised, and the kind (notes, table, code). With no command match, content matches fill the list; "No matching command" appears only when both are empty, reworded to "Nothing matches".
3. **Activation.** Enter on a content row goes to the slide (`store.goTo`), selects the element if there is one, scrolls it into view, and for notes opens the notes pane. Do not enter text editing.
4. **Go to slide.** A query that is a number, or `slide N`, or `#N`, offers "Go to slide N" as the first row, using audience numbering (the same numbers the thumbnails show; see `linearNumber` in `editor.ts`) and saying so when hidden or unnumbered slides make the two differ.
5. **Ctrl/⌘+F.** Bind it, on the canvas scope only, to open the palette pre-set to deck search (a `>`-free mode: a leading space or a "Find" chip). While a text field or text box has focus, leave the browser's own find alone.
6. **Read-only and present.** Search works in reader mode; it is disabled while presenting.

New strings (all catalogs): "In this deck", "Commands", "Go to slide {n}", "Nothing matches", "notes", "table", "code", the find placeholder.

Phase 2 (separate issue, do not build here): Replace. Text lives as sanitized inline HTML; a replace must operate on text nodes without breaking markup, must respect component copies and their overrides, token-bound fields and `{{…}}` field tokens, and must be one undo step with a count shown first.

Rejected: a separate find panel (a second search surface to learn, and more chrome); relying on the browser's find (cannot reach other slides or notes).

## Acceptance criteria

- [ ] ⌘K, type a word that appears only on slide 8: the list shows that slide under "In this deck" with a snippet; Enter makes slide 8 current and selects the element.
- [ ] A match in speaker notes is found, labelled as notes, and Enter opens the notes pane on that slide.
- [ ] A match in a table cell and in a code element is found.
- [ ] `17` or `slide 17` offers "Go to slide 17" first and goes there; an out-of-range number offers nothing.
- [ ] Commands still rank above content for a query that matches both, and command behaviour (recents, shortcuts shown, Esc restores focus) is unchanged.
- [ ] Ctrl/⌘+F on the canvas opens deck search; inside a text box being edited it does not.
- [ ] Document text reaches the palette only as text nodes (no markup injection): a slide containing `<img onerror=…>` in its `html` renders as inert text in the result row.
- [ ] Opening the palette on the Showcase deck stays responsive (index build under 16ms on the audit machine; record the number).
- [ ] All new strings exist in every catalog.

## Tests

- Add `scripts/test-slides-deckfind.ts` (node): `indexDeck` and `findInDeck` over a fixture deck with text, a table, code, notes, hidden and state slides; ranking; diacritics; the hostile-markup case returns plain text. Register it at the end of the slides slice in `.github/actions/validate-slides/action.yml`.
- Extend `scripts/test-slides-command-palette-browser.mjs` (registered at `.github/workflows/ci-slides.yml:547`): content match appears and navigates; go-to-slide works; commands still win; Ctrl+F behaviour in and out of a text box.

## Out of scope

- Replace (phase 2).
- Searching across files, or inside embedded documents.
- Showing unavailable commands and command synonyms (F-06).
- Natural-language fallthrough to the Assistant (AS-06) — but keep the provider interface general enough that AS-06 can add a third section.

## Notes for the implementer

- Zone: slides app. Files: a new `slides/src/editor/deckfind.ts`, `slides/src/editor/commands.ts`, `slides/src/editor/editor.ts` (hot file), `slides/src/styles.css`, catalogs, `CHANGELOG.md`.
- F-05 and F-06 also change the palette and the command list. Coordinate: land the provider interface once.
- If upstream PR #532 merges, reuse its outline code for the index instead of keeping two extractors; say so in the PR.
- State slides are numbered differently from linear slides; reuse the sidebar's numbering helpers rather than computing numbers again.

---
id: FH-12
title: "Lists: ordered-list autoformat; bullet and number buttons in the Text section"
epic: 8-first-hour
type: enhancement
priority: P2
size: S
evidence: seen
labels: [enhancement, "priority:P2", "size:S", "evidence:seen", "area:text"]
depends_on: []
related: [FH-02, F-05, MP-01]
upstream: ["nyblnet/bento#711"]
---
## Summary

Typing `- ` or `* ` at the start of a line starts a real bulleted list. Typing `1. ` does nothing, and there is no always-visible control that turns a text box into a bulleted or numbered list: the only list buttons live in a floating bar that appears only while text is selected. Add the ordered-list autoformat and two toggle buttons in the Text section.

## What the user experiences

- A PowerPoint or Google Slides user looks for bullets and numbering buttons in the Format panel. The Text section has Indent and Outdent, but no button that makes a list in the first place.
- They type `1. First point`. It stays literal text. `- First point` on the next attempt becomes a real list, which makes the missing numbered case look like a bug.
- The floating formatting bar does have Bulleted list and Numbered list, but it only shows when a range of text is selected, so a caret in an empty line never sees it.

## Reproduce

1. Open the app, add a text box with the Text tool (T), click on the slide, and type `- one` then Enter, `two`. Result: a real two-item bulleted list.
2. Add a second text box and type `1. one` then Enter, `two`. Result: literal text "1. one" and "two"; no list.
3. With the caret in that box and nothing selected, look for a bullets or numbering button in Format ▸ Text. There is none; only Outdent and Indent (disabled off a list).
4. Select the word "one". The floating bar appears with `•—` and `1.` buttons.

## Evidence

Observed in the running app during the first-deck journey: `- ` and `* ` made a real list at once with Tab / Shift+Tab nesting; `1. ` and `# ` did not convert; the panel had indent and outdent but no bullet or number buttons; the floating bar appeared only with a selection.

Confirmed in code now:

- `slides/src/editor/typedlist.ts:26-27`: `typedListAtCaret` matches only `/^([  ]{2,})?[-*][  ]$/`. There is no ordered-list branch. The header (`typedlist.ts:3-17`) records that this real-list behaviour came from upstream discussion #711.
- `slides/src/editor/markdown.ts:85` is the single call site (`autoformatAtCaret`).
- Ordered lists are already a supported block: the floating bar offers both (`slides/src/editor/richtext.ts:123-124`, `insertUnorderedList` and `insertOrderedList`), and `typedlist.ts:20` lists `OL` among block tags.
- The Text section's list controls are Indent and Outdent only (`slides/src/editor/inspector/text.ts:136-151`), wired through `p.onListIndent` to `canvas.indentList` (`slides/src/editor/editor.ts:757`).
- The bar is selection-driven by design (`richtext.ts:3` "The formatting bar that follows a text selection").

`# ` not converting is deliberate, not an oversight: `markdown.ts:12-17` keeps that module inline-only and says the bar is where a heading is asked for.

## How others do it

- PowerPoint: Bullets and Numbering buttons on the Home ribbon, always visible; typing `1. ` or `* ` then space autoformats (AutoCorrect).
- Keynote: Format ▸ Text ▸ Bullets & Lists pop-up, always in the sidebar.
- Google Slides: toolbar buttons plus `1. ` and `- ` autoformat.
- Figma and Penpot: `1. ` and `- ` autoformat; list type buttons in the text panel.

## Proposed change

1. **Ordered autoformat.** In `typedlist.ts`, extend `typedListAtCaret` to accept a number marker at line start: one to three digits followed by `.` or `)` and a space (plain or non-breaking), optionally indented like the bullet form. Build an `<ol>` instead of a `<ul>`. A start number other than 1 should set `start` only if the sanitizer keeps that attribute; check `sanitizeHtml` first, and if it does not, convert only when the number is `1` (do not silently renumber "3. "). Keep the same undo record so ⌘Z right after the conversion restores the literal characters, and the same exclusions (table cells, inline wrappers, code boxes return null).
2. **Guard against false positives.** Convert only at the very start of a line with nothing after the caret on that line, the same guard the bullet form uses (`typedlist.ts:34`). "2026. " at line start is the realistic false positive: the three-digit cap excludes it.
3. **Panel buttons.** In `inspector/text.ts`, next to Outdent / Indent, add two toggle buttons, Bulleted list and Numbered list. While a box is being edited they act on the caret's block (reuse the bar's `exec` path in `richtext.ts`); with a text element selected but not open, they convert every top-level line of the element. They show pressed when the caret (or the whole element) is in that list type. Add a new callback on the panel alongside `onListIndent` (`slides/src/editor/panels.ts:38`).
4. Update the hint text in the Text section (`inspector/text.ts:94`) to mention "1. ".

New strings (all catalogs): the two button titles if not identical to the bar's existing "Bulleted list" and "Numbered list" keys (reuse those keys), and the changed hint sentence.

Rejected: converting `# ` to a heading while typing. The module header records that as a choice; changing it belongs in its own issue with the maintainer's agreement.

## Acceptance criteria

- [ ] Typing `1. ` at the start of an empty line in a text box starts a real ordered list; Enter continues it; Enter on an empty item ends it.
- [ ] ⌘Z immediately after the conversion restores the literal `1. `.
- [ ] `2026. ` and a number marker typed mid-line do not convert.
- [ ] Table cells and code boxes are unaffected.
- [ ] The Text section shows Bulleted list and Numbered list toggles whenever a text element is selected, with or without a text selection.
- [ ] Pressing a toggle with the caret in a line converts that line; pressing it again reverts to a paragraph; the pressed state tracks the caret.
- [ ] Pressing a toggle with the element selected but closed converts all its lines in one undo step.
- [ ] The saved `html` round-trips through save and reopen as the same list.

## Tests

- Extend `scripts/test-slides-typed-list-browser.mjs` (already registered in `ci-slides.yml`) with: `1. ` converts; undo restores; `2026. ` does not; mid-line marker does not; the panel toggles exist and convert with a collapsed caret.
- Extend `scripts/test-slides-bullets.ts` if the commit-time conversion (`slides/src/editor/bullets.ts`) needs an ordered-list case.

## Out of scope

- Per-paragraph click builds on a list (MP-01).
- Tab behaviour in a plain text box (FH-02).
- Heading autoformat from `# `.
- Custom bullet glyphs, numbering styles or start numbers beyond what the sanitizer already keeps.

## Notes for the implementer

- Zone: slides app. Files: `slides/src/editor/typedlist.ts`, `markdown.ts`, `richtext.ts`, `inspector/text.ts`, `panels.ts`, `editor.ts` (callback wiring), catalogs, `CHANGELOG.md`.
- Read `typedlist.ts:3-17` and the #711 history before changing the conversion: an earlier glyph-based design painted two bullets on one line, which is the bug the current code exists to prevent.
- The maintainer left #711 open for "skip draft mode"; this issue finishes the numbered half of that request, which is worth saying when it goes upstream.

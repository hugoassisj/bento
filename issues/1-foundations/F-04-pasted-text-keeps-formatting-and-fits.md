---
id: F-04
title: "Text pasted onto the slide keeps its formatting, fits its box, and does not stack"
epic: 1-foundations
type: enhancement
priority: P2
size: S
evidence: mixed
labels: [enhancement, "priority:P2", "size:S", "evidence:mixed", "area:text"]
depends_on: [F-03]
related: [DT-01, DT-10]
upstream: ["nyblnet/bento discussion #503"]
---
## Summary

Pasting text into an open text box keeps bold, italic and lists and grows the box. Pasting the same clipboard onto the slide (nothing being edited) reads only the plain-text flavour, drops it into a fixed 600×120 box at a fixed position, and stacks every paste on the same spot. Route slide paste through the same HTML path, size the box, and offset repeats.

## What the user experiences

A user copies three paragraphs with a bold phrase and a bullet list from a document and presses ⌘V on the slide. They get one centred block of plain text overflowing a 120px-tall box in the middle of the slide. Pasting again puts a second box exactly on top of the first.

## Reproduce

1. Fresh load, click empty canvas so nothing is selected.
2. Put this on the clipboard as `text/html` with a `text/plain` fallback: `<p>Revenue <b>grew</b> 12%</p><ul><li>EMEA</li><li>APAC</li></ul>`.
3. ⌘V. Result: one text box at x = (slide width / 2 − 300), y = 260, w = 600, h = 120, plain text, no bold, no list, toast "Text pasted".
4. ⌘V again. Result: a second box at the same x and y.
5. Double-click an existing text box and ⌘V the same clipboard inside it. Result: bold and the list survive and the box grows.

## Evidence

- Observed in the running app during the audit (first-deck journey: slide paste kept h = 120 while the text overflowed, landed every paste at the same spot, dropped bold and lists; in-box paste kept them).
- Confirmed in code now:
  - `slides/src/editor/editor.ts:2874` `pasteFromText(text)` handles the slide path from a plain string only; `editor.ts:2907` builds `defaultText({ html: esc, …, x: Math.round(width / 2 - 300), y: 260, w: 600 })` from HTML-escaped plain text, so the height stays `defaultText`'s 120.
  - `slides/src/editor/paste.ts:38` `clipboardToHtml(dt)` is the sanitising HTML reader the in-box path uses (allowlisted tags, attributes dropped, parsed in an inert document).
  - Element and slide clips do offset repeated pastes: `slides/src/editor/clipboard.ts:197` `pasteOffset`. The plain-text path does not use it.
- Not verified: which call site hands the clipboard to `pasteFromText` and whether the `DataTransfer` is still available there; trace from the paste listener and from `pasteFromClipboard` (`editor.ts:4481`, the menu path, which has no `clipboardData`).

## How others do it

- PowerPoint: pasting text onto a slide creates a text box that keeps source formatting, with a Paste Options chip (keep source / use destination / text only).
- Keynote: pasted text becomes a text box sized to its content; repeated pastes cascade.

## Proposed change

1. In the slide-paste path, prefer `clipboardToHtml(dt)` when the clipboard has an HTML flavour; fall back to today's plain-text conversion (keeping the fenced-code split at `editor.ts:2899` exactly as it is).
2. Run the result through the same finishing steps a committed in-box edit gets (`bulletsToLists`, `sanitizeHtml`), so a pasted list is a real list.
3. Size the new box: left-aligned, top-aligned, width capped to the slide's content width, height from `measure.ts` (`measureText`), not the default 120. If F-03 landed, reuse its sizing helper.
4. Position: centred on the visible canvas the first time; offset repeated pastes with the same rule `pasteOffset` uses, so two pastes never coincide.
5. Do not touch tabular clipboards here: a clipboard that is a spreadsheet grid belongs to DT-01. Leave a clear seam (one function that classifies the clipboard) for it.

No new strings are required if the existing "Text pasted" toast is kept.

## Acceptance criteria

- [ ] Pasting the HTML above onto the slide produces one text element whose `html` contains `<b>` and a `<ul>` with two `<li>`.
- [ ] The element's `h` is within 2px of `window.bento.measure(id).height`.
- [ ] Two consecutive pastes produce elements with different `x`/`y`.
- [ ] A plain-text clipboard still produces a text element with the same content as today; a fenced ``` block still becomes a Code element.
- [ ] Hostile clipboard HTML (`<img onerror>`, `<script>`, `style` attributes, `javascript:` links) leaves none of it in the stored element (reuse the cases in the existing paste rigs).
- [ ] Nothing from the clipboard is ever attached to the live document before sanitising (the property `paste.ts` documents).
- [ ] Pasting inside an open text box behaves exactly as before.

## Tests

Extend or sit beside `scripts/test-slides-paste-position-browser.mjs` with `scripts/test-slides-paste-slide-html-browser.mjs`: dispatch a paste `ClipboardEvent` carrying both flavours onto the canvas; assert stored `html`, measured height, and that a second paste is offset; assert the hostile cases. Register in `.github/workflows/ci-slides.yml`.

## Out of scope

- Spreadsheet and table clipboards (DT-01).
- Code detection without fences (DT-10).
- A Paste Options chip.

## Notes for the implementer

- Security: this widens what untrusted input can become. Keep to `clipboardToHtml` and the one sanitiser; upstream fixed two style-injection holes after 1.3.0 (#969, #970) and will look hard at this path.
- The plain-text path converts markdown as it goes; decide and state whether pasted HTML also gets markdown conversion (it should not).
- Hot file: `slides/src/editor/editor.ts`.

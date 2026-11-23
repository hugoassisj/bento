---
id: DT-14
title: "Maths: show the reason for invalid LaTeX"
epic: 7-data
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:data"]
depends_on: []
related: [DT-12, F-10]
upstream: []
---
## Summary

When a formula cannot be rendered, the source stays on the slide with a dotted underline and nothing visible says why. The engine knows the reason ("missing }", "unexpected end", an unknown command) and already attaches it to the marked text as a hover tooltip, but a tooltip on canvas text is easy to miss, absent on touch, and invisible to anyone who does not think to hover. Show the reason where the author is looking.

## What the user experiences

They type `$\frac{a}{b$`, commit, and see their source back, underlined with dots. They do not know whether the dollar signs were not recognised, the command is unsupported, or a brace is missing. They retype it a few times. A formula that renders but contains a command the engine does not know is drawn with the command's name in it, with the same quiet marking.

## Reproduce

1. Fresh load. Add a text box and type `$\frac{a}{b$`. Press Escape to commit.
2. Result: the raw text remains, with a dotted underline. No message in the inspector, no toast.
3. Hover the underlined text for about a second: a browser tooltip appears with the reason (verify; see Evidence).
4. Type `$x = \notacommand{2}$` in another box: the formula renders with the unknown command shown as its name, marked the same way.
5. Select either box: the Text section of the inspector says nothing about the formula.

## Evidence

- Seen in the running 1.3.0 app during the data journey: invalid LaTeX stays raw with a dotted underline and no reason was visible to the tester.
- Code, verified now:
  - `slides/src/maths/ast.ts:55` `class MathError extends Error`; the parser throws it with specific messages, for example "dangling backslash" (`slides/src/maths/latex.ts:35`), "missing }" (`latex.ts:153`), "macro loop" (`latex.ts:173`), "unexpected end" (`latex.ts:217`).
  - `slides/src/maths/delimiters.ts:130-131`: a failed run is wrapped as `<span class="bento-math-miss" title="…reason…">`, and a rendered formula containing an unknown command gets the same wrapper (`delimiters.ts:139-141`). The wrapper is only produced when a `hint` function is supplied, which is the editor's render path (`opts.mathHint` at `slides/src/render.ts:749`); the show does not mark anything.
  - Styling for the marker: `.bento-math-miss` at `slides/src/styles.css:599`.
- So the reason exists but only as a `title` attribute. Not verified in a browser during this write-up: that the tooltip appears on hover in the editor canvas (the canvas intercepts pointer events for selection, which may suppress it).

## How others do it

- Overleaf and most LaTeX editors: an inline error marker plus a message in a log or gutter naming the problem and the position.
- Notion and Obsidian: an invalid equation shows a red inline error with the parser's message in place of the formula.
- Keynote's equation editor: a live preview that shows "Invalid equation" while typing.

## Proposed change

1. **Inspector status** (`slides/src/editor/inspector/text.ts`): when the selected text element's rendered content contains `.bento-math-miss`, add a status line in the Text section: an icon, "A formula could not be drawn:" and the reason from the marker's `title`, one line per distinct miss, with the offending source truncated to about 40 characters. For the unknown-command case say "Unknown command \name is shown as its name". Compute it from the same hint function the renderer uses rather than scraping the DOM, if the inspector can call it (it is passed to the renderer as `mathHint`; find where the editor defines it).
2. **While editing**: when the caret is inside a text box being edited, run the hint for each formula run on `input` (debounced) and show the same status in the inspector, so the author sees "missing }" before committing. Do not render formulas live in the edited box; the editor deliberately shows raw source while editing.
3. **Accessible marking**: the dotted underline alone fails for colour-blind and screen-reader users. Add `aria-invalid="true"` or a visually hidden text equivalent in the editor path only. The marker must stay out of the show, print and export, as today.
4. **Reason text**: `MathError` messages are terse English strings from the parser. Map the handful of message kinds to translated sentences through `t()` in the editor (unknown messages fall back to a generic "The formula could not be read"), and add them to every catalog. Do not put `t()` inside `slides/src/maths/`; keep the engine free of UI strings.
5. **Check deck**: when F-10 lands, list formula misses there too. A `math-unrendered` validator finding would also help agents; propose it under F-09 rather than adding it here, but expose a pure function this issue and that one can share, for example `mathMisses(html): Array<{ source, reason }>`.
6. Table cells (after DT-12) and Typst-syntax formulas go through the same resolver; confirm the status works for both or say which is left out.

No format change.

## Acceptance criteria

- [ ] Selecting a text box containing `$\frac{a}{b$` shows a status line in the inspector naming the missing brace.
- [ ] A box with two bad formulas lists both.
- [ ] A formula with an unknown command renders, and the status names the command.
- [ ] Fixing the formula and committing removes the status.
- [ ] While editing, the status updates within about half a second of typing without moving the caret or re-rendering the box.
- [ ] Reason sentences are translated in every catalog; an unmapped parser message shows the generic sentence, never a raw English fragment in a non-English UI.
- [ ] Nothing about the marking appears in the show, thumbnails, print or exported images (unchanged from today).
- [ ] The marker carries an accessible indication, not colour or underline alone.

## Tests

- Node: a rig case for `mathMisses` (pure) with the sources above, an empty formula, prose containing two dollar signs (must not be flagged; see the `sure`/`MATHY` rule in `delimiters.ts:126-143`), and a Typst formula. Put it beside `scripts/test-slides-math-delims.ts` or extend that rig; it is already registered.
- Browser: extend the maths browser rig family (`scripts/test-slides-math-morph-browser.mjs` is the existing one; a new `scripts/test-slides-math-status-browser.mjs` is cleaner) to select a box with a bad formula and assert the inspector status text. Register a new rig in `.github/workflows/ci-slides.yml`.
- Keep `scripts/test-maths-lite.ts`, `scripts/test-maths-coverage.ts` and `scripts/test-slides-math-href.ts` green.

## Out of scope

- New LaTeX commands or better coverage.
- A formula editor or live preview.
- Position-accurate error underlining inside the source.

## Notes for the implementer

- First confirm step 3 of Reproduce in a real browser: if the tooltip already appears reliably, the gap is smaller (discoverability only) and steps 1–2 remain worth doing; say what you found.
- The maths engine is bundled and size-sensitive; add no strings or UI code under `slides/src/maths/`.
- `inspector/text.ts` is a hot file for Epic 8's text work; keep the addition to one helper call.

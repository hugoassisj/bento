---
id: DT-10
title: "Code blocks: Tab indents; paste detects code; language guess"
epic: 7-data
type: bug
priority: P1
size: S
evidence: mixed
labels: [bug, "priority:P1", "size:S", "evidence:mixed", "area:data"]
depends_on: []
related: [FH-02, F-04]
upstream: []
---
## Summary

Pressing Tab while typing in a code block leaves the block, and the keystrokes that follow are read as editor shortcuts: typing `return x` armed the Shape tool. Code pasted onto the slide becomes a centred proportional text box with its indentation gone unless it was wrapped in ``` fences. A new code block is always JavaScript. Make Tab indent, make paste recognise code, and guess the language.

## What the user experiences

They double-click a code block, type a line, press Enter and Tab to indent. Focus jumps out of the block. They keep typing `return x`: `r` selects the rectangle tool, the rest fires other shortcuts, and nothing reaches the code. Separately, they copy a function from their editor and paste it on a slide: it arrives as body text, centred, in the deck's font, flattened.

## Reproduce

Tab:
1. Fresh load. Toolbar ▸ Code. Double-click the block.
2. Type `function f() {`, press Enter, press Tab, type `return x`.
3. Result: after Tab the block is no longer being edited; the Shape tool is armed; the code holds only the first line.

Paste:
4. Put this on the clipboard as `text/plain`:
```
def area(r):
    import math
    return math.pi * r ** 2
```
   and as `text/html`: `<div style="white-space: pre; font-family: Menlo, monospace"><div>def area(r):</div><div>    import math</div><div>    return math.pi * r ** 2</div></div>` (what an editor such as VS Code writes).
5. Click the empty canvas and paste. Result: a centred text element in the deck font; indentation not shown as code. Toast "Text pasted".
6. Paste the same text wrapped in ```` ```python ```` fences: a real Code element is created (this path works).
7. Insert a new Code block and look at Language in the inspector: `js`.

## Evidence

- Seen in the running 1.3.0 app during the data journey (Tab exit, Shape tool armed, unfenced paste becoming text, fenced paste working).
- Code, verified now:
  - Code elements are edited through the same path as text: `startTextEdit` in `slides/src/editor/canvas.ts` swaps in the raw source for a code model at `canvas.ts:2212-2215` and shares the text `keydown` handler.
  - That handler only intercepts Tab inside a list: `canvas.ts:2250-2259` ("anywhere else Tab does what it always did"). Outside a list the event is not prevented, so the browser moves focus, the `blur` listener commits the edit (`canvas.ts:2309`), and later keys reach the global shortcut handler.
  - Canvas paste reads `text/plain` only (`slides/src/editor/editor.ts:2849-2863`); `pasteFromText` makes a Code element only when `splitFences` finds a fence (`editor.ts:2897-2904`), otherwise a `defaultText` box (`editor.ts:2906-2911`). `clipboardToHtml`'s preformatted handling (`slides/src/editor/paste.ts:62-87`) is used only when pasting **into** an open text box.
  - Language default: `slides/src/editor/inspector/media.ts:295` shows `el.grammarName ?? 'js'`; `defaultCode` (`slides/src/model.ts:1112-1126`) sets no `grammarName`.
- The same Tab mechanism destroys text in plain text boxes; that is tracked as FH-02. Fix them together or in a compatible way.

## How others do it

- FigJam and Figma Slides code blocks, Notion, and every code editor: Tab indents, Shift+Tab outdents, Escape leaves.
- Notion and Slack: pasted monospace or multi-line indented text becomes a code block; language is detected or picked from a menu.
- PowerPoint and Keynote have no code blocks, so this is a place Bento can simply be better.

## Proposed change

1. **Tab in a code block** (`slides/src/editor/canvas.ts`, in the shared `keydown`, guarded by `model?.type === 'code'`):
   - Tab with a collapsed caret inserts two spaces (match what the starter deck's code uses; make it a constant). With a multi-line selection, indent every selected line.
   - Shift+Tab outdents the current or selected lines by one level.
   - Enter keeps the previous line's indentation.
   - Always `preventDefault()` for Tab while a code block is being edited, so focus never leaves. Escape remains the way out.
2. **Paste recognises code** (document paste handler and `pasteFromText` in `slides/src/editor/editor.ts`):
   - If a code element is selected (not editing), a text paste replaces its `content` after confirmation by toast-with-undo.
   - Else, classify the clipboard as code when the HTML flavour's root or all its text sits in `<pre>`, `<code>`, or an element whose inline style is `white-space: pre*` or a monospace `font-family` (inspect in an inert `DOMParser` document, as `paste.ts` does); or when the plain text has two or more lines and at least half of the non-empty lines after the first begin with two or more spaces or a tab, or it contains typical code punctuation at line ends (`{`, `}`, `;`, `:`) on most lines. Keep the heuristic in one pure function with a table of cases.
   - Code becomes a `defaultCode` element with `content` set to the plain text verbatim, placed like other inserts. Toast "Pasted as code" with an action "Paste as text".
3. **Language guess**: a pure `guessLanguage(text): string | undefined` scoring a handful of high-signal patterns for the built-in grammars (list them from the grammar table the Language select uses in `inspector/media.ts`). Only assign when the score is clear; otherwise leave `grammarName` unset (today's `js` fallback). Used for pasted code and when a fenced block has no language tag.
4. New strings in all catalogs: two toasts and one action.

No format change (`grammarName` exists).

## Acceptance criteria

- [ ] In an edited code block, Tab inserts indentation and focus stays in the block; no tool is armed and no shortcut fires.
- [ ] Shift+Tab outdents; a multi-line selection indents and outdents as a block; Enter keeps indentation.
- [ ] Escape still ends editing; the committed `content` contains the typed indentation exactly.
- [ ] Pasting the Python sample (either flavour) on the canvas creates one Code element whose `content` equals the plain text, with `grammarName` `python` (or the grammar table's name for it).
- [ ] Pasting an ordinary sentence or a bulleted list still creates a text element.
- [ ] "Paste as text" gives the previous behaviour.
- [ ] Fenced paste keeps working, including a fence with an explicit language.
- [ ] Tab inside a bulleted list in a text box still indents the list item.

## Tests

- Extend `scripts/test-slides-code-fence.ts` (node) or add `scripts/test-slides-code-paste.ts` for the pure classifier and `guessLanguage` (code samples in several languages, prose, lists, a single line, a URL). Register in `.github/actions/validate-slides/action.yml`.
- New browser rig `scripts/test-slides-code-tab-browser.mjs`: type with real keyboard input, press Tab, assert `document.activeElement` is still inside the block and that no tool is armed, then assert `content`. It must fail on the parent commit. Register in `.github/workflows/ci-slides.yml`. Related rigs to keep green: `scripts/test-slides-code-fence-browser.mjs`, `scripts/test-slides-code-run-exit-browser.mjs`, `scripts/test-slides-typed-list-browser.mjs`.

## Out of scope

- Line numbers, line highlight and step-through (a `highlight` key would be a format addition; propose separately).
- New grammars.
- The typewriter effect.

## Notes for the implementer

- `canvas.ts` text-edit `keydown` is shared with FH-02 (Tab in plain text boxes). Coordinate: one change should not undo the other. If both are open, do FH-02 first or do both in one branch only if the owner agrees to widen it.
- Untrusted clipboard HTML is only ever parsed in a detached document; only strings leave it.
- Code morph pairs tokens by identity; do not change how `content` is tokenised.

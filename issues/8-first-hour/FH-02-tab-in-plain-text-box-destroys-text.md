---
id: FH-02
title: "Tab in a plain text box leaves the box; the next keystrokes replace the text"
epic: 8-first-hour
type: bug
priority: P0
size: S
evidence: mixed
labels: [bug, "priority:P0", "size:S", "evidence:mixed", "area:text"]
depends_on: []
related: [FH-03, FH-12, DT-10]
upstream: []
---
## Summary

Inside a bullet, Tab indents. Anywhere else in a text box, Tab is left to the browser, which moves focus out of the box. That commits the edit, and because the box is still selected, the next printable key reopens it with everything selected and replaces the whole text. A user who presses Tab to indent a plain line loses what they wrote.

## What the user experiences

Typing a short list without bullets and pressing Tab to indent the third line silently ends the edit. The following keystrokes wipe the first two lines. If the next key is Enter instead, it activates whatever control took focus: in the audit that was the panel-collapse handle, so the Format panel folded away.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Press `T`, click the slide, type `Revenue`, Enter, `Costs`, Enter.
3. Press Tab.
4. Type `Cloud spend`.
5. Read the element's `html` in `window.bento.doc`: it is only `Cloud spend`. Expected: three lines, the third indented.
6. Variant: after step 3 press Enter instead. The Format panel collapses.

## Evidence

- **Seen (journey 1):** steps 2–6, including the final html and the collapsed panel.
- **Confirmed in code now:**
  - `slides/src/editor/canvas.ts:2250-2260` — the edit keydown handler calls `preventDefault` for Tab only when the caret is `inList(...)`. The comment says "anywhere else Tab does what it always did", which is the browser's focus move.
  - `slides/src/editor/canvas.ts:2313` — `blur` on the editable calls `commitTextEdit()`.
  - `slides/src/editor/editor.ts:4008-4022` (`typeIntoText`) — with exactly one text element selected and nothing being edited, a printable key calls `canvas.editElement(...)` and then `insertText`. `startTextEdit` selects all on opening (`canvas.ts:2236`), so the key replaces the content.
  - Focus landing on the panel handle: the handle is a real button (`.ed-panel-toggle`, `editor.ts:849`); which control receives focus depends on DOM order. The journey observed that one.
- **Unverified:** nothing further.

## How others do it

- **PowerPoint, Keynote, Google Slides:** Tab inside body text demotes the paragraph one level (or inserts a tab stop in a title); focus never leaves the box.
- **Figma, Penpot:** Tab inside a text layer inserts a tab or indents a list item; the edit stays open. Esc is the only key that leaves.

## Proposed change

`slides/src/editor/canvas.ts`, in the edit keydown handler of `startTextEdit`:

1. Always `preventDefault()` on Tab and Shift+Tab while a text box is being edited (no modifier keys). Focus must never leave an open edit because of Tab.
2. Outside a list, decide the behaviour and keep it small. Recommended: Tab on a plain line turns it into a first-level bullet (the same result as typing `- ` at the line start, through the existing `typedlist.ts` / `listindent.ts` path) and Shift+Tab on a first-level bullet turns it back into a plain line. This matches the PowerPoint reflex and reuses code that already exists. If that proves too invasive, the minimum acceptable fix is: swallow the key and do nothing.
3. The same rule for the table-cell editor is already different by design (Tab moves across cells); do not change it.
4. Code elements: Tab is covered by DT-10; make sure the two fixes do not conflict (the handler is shared, the branch on `model.type === 'code'` is separate).

The fix makes the destructive sequence unreachable through Tab, but the second half of the mechanism (a stray key replacing a selected box's whole text) is still there for anyone who leaves an edit by clicking a panel. That is FH-03's subject; note it there, do not fix it here.

No model change. One or two tooltip strings may change if the formatting bar's Indent button title (`richtext.ts:126-127`) should stop implying "lists only"; if so, update every catalog.

## Acceptance criteria

- [ ] With the caret on a plain line, Tab keeps `document.activeElement` inside the editable and the edit stays open.
- [ ] The reproduction sequence ends with all three lines present in `html`.
- [ ] Tab on a plain line produces a first-level list item containing that line's text (or, if the minimal fix is chosen, changes nothing); the PR says which.
- [ ] Shift+Tab on a first-level bullet returns it to a plain line; on a plain line it does nothing and does not move focus.
- [ ] Tab and Shift+Tab inside nested bullets behave exactly as before.
- [ ] ⌘Z immediately after a Tab conversion restores the previous text (same contract as the other autoformats, `undoIndent`).
- [ ] Tab inside a table cell still moves to the next cell.

## Tests

Extend `scripts/test-slides-typed-list-browser.mjs` or `scripts/test-slides-fmtbar-indent-browser.mjs` (both already drive Tab in a live editable), or add `scripts/test-slides-tab-in-text-browser.mjs`. Use real keyboard input. Assert the acceptance criteria and that `document.activeElement` is the editable after each Tab. The new assertions must fail on the parent commit. Register a new file in `.github/workflows/ci-slides.yml`. Run `scripts/test-slides-bullets.ts` and `scripts/test-slides-edit-listeners.ts` as regression.

## Out of scope

- Caret placement and select-all on opening (FH-03).
- Ordered lists and list buttons (FH-12).
- Tab in code blocks (DT-10).

## Notes for the implementer

- Zone: slides app. Hot files: `slides/src/editor/canvas.ts`, `slides/src/editor/listindent.ts`, `slides/src/editor/typedlist.ts`.
- Keyboard users rely on Tab to move between controls, but not from inside an open text edit: Esc is the documented way out, and the shortcut sheet says so. Keep Esc working.
- Before changing list conversion read the header comments of `slides/src/editor/listindent.ts`, `typedlist.ts`, `bullets.ts` and `markdown.ts`: they record why typed bullets are glyphs during the edit and real list items after it.
- Add a `CHANGELOG.md` `[Unreleased]` fix line.

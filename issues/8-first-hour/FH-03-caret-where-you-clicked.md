---
id: FH-03
title: "Entering text editing places the caret where you clicked"
epic: 8-first-hour
type: enhancement
priority: P1
size: S
evidence: mixed
labels: [enhancement, "priority:P1", "size:S", "evidence:mixed", "area:text"]
depends_on: [FH-01]
related: [FH-02, FH-04, PK-01]
upstream: []
---
## Summary

Opening any text box for editing selects all of its text. One stray character then replaces the whole box. Every mainstream tool puts the caret where the user clicked. Change the default to a caret at the click point, and keep select-all only where it is the right gesture.

## What the user experiences

- Double-click a title to fix one word, type a letter: the entire title is replaced by that letter.
- With a text box merely selected, typing any letter opens it and replaces everything (this one is by design, see below, but it is the same surprise).
- On touch, tap-tap then a key did the same in the audit, and the first tap inside an open box did not place a caret in emulated Chromium.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 (the Showcase deck).
2. Double-click between "The file" and "is the" in the title on slide 1.
3. Type `X`.
4. `window.bento.doc.slides[0].elements.find(e => e.id === 'sd-title').html` is now `X`. Expected: `X` inserted at the click point.

## Evidence

- **Seen (journey 4, design features and phone):** tap-tap on the title then one typed character replaced the whole title with "X". The caret-on-tap observation is from emulated touch only and needs a real iOS check.
- **Confirmed in code now:**
  - `slides/src/editor/canvas.ts:2234-2237` — `startTextEdit` makes the node editable, focuses it, then `document.getSelection()?.selectAllChildren(inner)` and sets `editAutoSelected = true`.
  - `canvas.ts:2241` and `:2266-2267` — `editAutoSelected` is cleared by the first mousedown or key; it exists so that a backtick typed on the automatic selection does not wrap the whole box as code.
  - Callers: double-click on the canvas (`canvas.ts:434`), second click on a selected text (`canvas.ts:501`), `editElement` from the context menu and from `typeIntoText` (`canvas.ts:2179`, `editor.ts:4018`), and a freshly inserted box (`canvas.ts:3021`).
  - No use of `caretRangeFromPoint` / `caretPositionFromPoint` anywhere in `slides/src/editor/`.
- **Unverified:** real-device touch behaviour.

## How others do it

- **PowerPoint, Keynote, Google Slides:** double-click places the caret at the click (double-click on a word selects that word); typing with a box selected replaces its text only in Keynote, and only for placeholder text.
- **Figma, Penpot:** double-click enters the layer with the caret at the click; Enter on a selected text layer enters with everything selected.

## Proposed change

`slides/src/editor/canvas.ts`:

1. Give `startTextEdit` an optional point (`{ clientX, clientY }`) or a mode argument. The two pointer callers (`:434` double-click, `:501` second click) pass the event's coordinates.
2. With a point: after `inner.focus()`, resolve a collapsed range with `document.caretPositionFromPoint` (standard) or `document.caretRangeFromPoint` (WebKit/Blink fallback) and set the selection to it. If the point resolves outside `inner`, place the caret at the end. Do not set `editAutoSelected`.
3. Without a point, keep select-all in exactly these cases, because there it is what the user expects:
   - a box that was just inserted (`canvas.ts:3021`): its starter text is meant to be overtyped;
   - an empty placeholder (after FH-01 there is nothing to select, the caret is simply inside);
   - `typeIntoText` (`editor.ts:4008-4022`): typing with a box selected. Decide deliberately: either keep "type replaces" (Keynote's behaviour, and what the code comment promises) or change it to "type appends at the end". Recommended: keep it for empty placeholders and freshly inserted boxes, and for a box with real content open it with the caret at the end and insert there. That removes the last silent-destruction path noted in FH-02.
   - the context menu's "Edit text" (`editor.ts:4413`): select all, as Figma does on Enter.
4. Double-click on a word: browsers select the word natively on the second click of a double-click only when the element is already editable. Decide whether to emulate word selection; the minimum is a caret at the point.
5. Raw-source swap: when the box contains fields or maths, `startTextEdit` replaces the rendered view with raw source before editing (`canvas.ts:2196-2216`). Resolve the caret after that swap; if the layout changed under the pointer, fall back to the end.

No model change, no strings.

## Acceptance criteria

- [ ] Double-click in the middle of existing text and type `X`: `X` is inserted at that position; the rest of the text is intact.
- [ ] Second click on an already selected text box behaves the same.
- [ ] A newly inserted text box still opens with its starter text selected.
- [ ] An empty placeholder opens with the caret inside and no selection.
- [ ] Typing with a non-empty text box selected no longer deletes its content (state the chosen behaviour in the PR).
- [ ] Typing a backtick immediately after a pointer entry types a backtick (no whole-box code wrap).
- [ ] A box containing `{{page}}` or `$…$` opens without throwing and with a caret somewhere sensible.
- [ ] Works in Chromium, Firefox and WebKit (both caret-from-point APIs covered).

## Tests

Add `scripts/test-slides-caret-entry-browser.mjs` with real mouse input: double-click at a measured text position (use a `Range` over a known character to get its client rect), type, assert the html. Cover each acceptance criterion. Register it in `.github/workflows/ci-slides.yml`. Regression: `scripts/test-slides-edit-listeners.ts`, `scripts/test-slides-typed-list-browser.mjs`, `scripts/test-slides-fields-browser.mjs`, and the code-fence rigs, which rely on `editAutoSelected`.

## Out of scope

- Touch gestures and the on-screen keyboard (parked, PK-01).
- Styling a text range (FH-04).

## Notes for the implementer

- Zone: slides app. Hot file: `slides/src/editor/canvas.ts` (large and shared; keep the diff tight).
- Land FH-01 first: today's select-all is what hides the placeholder bug on the common path.
- Several rigs and one shipped behaviour ("type to replace") depend on the automatic selection. Grep for `editAutoSelected` and for rigs that type immediately after opening a box before changing defaults.
- This changes a long-standing interaction. Record the decision (what selects all, what does not) in `docs/DECISIONS.md` and in `CHANGELOG.md` `[Unreleased]`.

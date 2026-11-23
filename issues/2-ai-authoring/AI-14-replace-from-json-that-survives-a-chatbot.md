---
id: AI-14
title: "Replace from JSON that survives a chatbot: fences, trailing commas, truncation, summary before applying"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:editor"]
depends_on: []
related: [AI-11, AI-15, F-11, FH-09, FH-10]
upstream: []
---
## Summary

Replace from JSON is how a person brings a chatbot's edit back into a deck. Six of the ten realistic replies tried in the audit were refused with a red border and no explanation, and a reply that contained only half the slides was applied without a word, deleting ten slides. The dialog has no instructions, no preview and no summary of what will change, and the report of what was dropped goes to the browser console.

## What the user experiences

A person copies the deck JSON, asks a chatbot to tidy slide 3, and pastes the answer back. The answer arrives wrapped in a Markdown code fence, or with a sentence before it, or with a trailing comma, or cut off because the reply hit a length limit. The textarea border turns red and the Apply button reads "Invalid document JSON" for under two seconds. Nothing says what is wrong. When the reply does parse but the chatbot quietly returned 9 of 19 slides, the deck becomes 9 slides and the toast says "Loaded: 0 fields dropped, 3 warnings — see console".

## Reproduce

1. `cd slides && npm run dev`. File menu (the wordmark), Copy document JSON.
2. File menu, Replace from JSON…, paste each of these and press Apply:
   - the JSON inside a ```` ```json ```` fence;
   - "Here is your updated deck:" followed by the fence;
   - the JSON with a trailing comma before the final `}`;
   - the JSON cut off at 60% of its length;
   - `{"hello": "world"}`;
   - nothing.
   Each gives the red border and the transient button label only.
3. Paste the valid JSON with half of `slides` removed. It applies; the deck loses those slides; the toast does not mention it. Ctrl+Z restores.

## Evidence

Observed during the audit (AI trial, part 3): the six refusals above, the silent 19 to 9, a foreign `docId` and `collab` correctly ignored, and Ctrl+Z restoring every applied case. The trial described the refusals as wordless; the code shows a transient label.

Confirmed in code now (`slides/src/editor/editor.ts`):

- `openReplaceJson` at `editor.ts:1464`: a title, an 8-row textarea with the placeholder "Paste document JSON here…", Apply and Cancel. No other text.
- Apply calls `parseDocInputReport(ta.value, { live: this.store.doc })` (`editor.ts:1489`) and replaces the document immediately on success (`editor.ts:1491`).
- On success with drops or warnings the report is written with `console.info` and summarised in a toast (`editor.ts:1496-1498`).
- On failure the border is set to `#C0392B` and the button text becomes "Invalid document JSON" for 1800 ms (`editor.ts:1501-1505`). No reason is available because `parseDocInputReport` returns `null` for every failure (`slides/src/compactload.ts:76-82`).
- The overlay is the older `.ed-about-overlay` pattern with no dialog role or focus trap (see FH-09).

## How others do it

PowerPoint's Reuse Slides and Paste Options show what will be inserted before it happens. Editors that accept pasted structured data (VS Code's settings, GitHub's suggestion blocks) point at the line and column of a parse error. Chat tools wrap code in fences by default; a paste target meant for chatbots has to accept that.

## Proposed change

1. Tolerant input, in a small pure function `cleanPastedJson(text)` (new file `slides/src/editor/pastejson.ts`, node-testable):
   - take the contents of the first fenced block if there is one, otherwise the span from the first `{` to the last `}`;
   - remove trailing commas before `}` and `]` outside strings;
   - return `{ json, repaired: string[] }` naming what it did.
2. Reasons. Make the parse path report why it refused: JSON syntax error with line and column; "ends before the document closes — the reply was cut off" when brackets are unbalanced at end of input; "not a Bento document (no `format` and not compact)"; "no slides". Either widen `parseDocInputReport` to return `{ error }` or add a sibling `explainRejection(text)`; do not change the meaning of `null` for existing callers.
3. Summary before applying. Parse first, then show in the dialog: slides added, removed and changed (by id), elements changed, fields dropped, warnings. Removing slides needs a second, explicit confirmation line ("This removes 10 slides"). The button becomes "Apply changes".
4. The report in the dialog, not the console: a scrollable list of dropped paths and findings with a Copy report button, so the person can paste it back to the chatbot.
5. One sentence of instructions above the textarea, and move the dialog onto the kernel dialog primitive (`kernel/src/ui/dialog.ts`) as FH-09 asks; call it, do not edit it.

New strings go through `t()` and into every catalog.

Alternative rejected: accepting JSON5 or a lenient parser dependency. Two targeted repairs cover what chatbots actually emit; no dependency.

## Acceptance criteria

- [ ] Fenced JSON, prose followed by a fence, and a trailing comma all load, and the dialog says what was repaired.
- [ ] A truncated reply is refused with a message that says it was cut off; a syntax error names line and column; a non-document says so.
- [ ] Nothing is applied until the summary has been shown and confirmed.
- [ ] A paste that removes slides shows the count and needs an explicit confirmation.
- [ ] Dropped fields and findings are listed in the dialog and can be copied.
- [ ] Applying is still one undo step; the deck's `docId` and `collab` are still its own.
- [ ] Escape closes the dialog and focus returns to where it was.
- [ ] Every new string exists in all eight catalogs.

## Tests

- `scripts/test-slides-pastejson.ts` (node): table of inputs for `cleanPastedJson` and the rejection reasons, including strings that contain `}` and `,]`.
- `scripts/test-slides-replace-dialog-browser.mjs`: drives the dialog for the cases in Reproduce and asserts messages, the summary counts, and that nothing changed before confirmation. Register it in `.github/workflows/ci-slides.yml`.
- `scripts/test-replace-json-gate.ts` must still pass unchanged.

## Out of scope

- Applying a small patch instead of a whole document (AI-07, AI-15).
- The unreadable document block at boot (F-11), though it should reuse the rejection reasons.

## Notes for the implementer

Slides zone; hot file `editor.ts`. The pasted text is foreign input: keep it going through the gate exactly as today. Byte cost matters; keep the diff summary to ids and counts, not a visual diff (AS-07 owns that).

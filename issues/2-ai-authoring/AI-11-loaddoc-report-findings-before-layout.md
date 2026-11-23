---
id: AI-11
title: "`loadDoc` report computes findings before the layout pass"
epic: 2-ai-authoring
type: bug
priority: P1
size: S
evidence: mixed
labels: [bug, "priority:P1", "size:S", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-10, AI-12, AI-14, F-10]
upstream: []
---
## Summary

`window.bento.loadDoc()` and Replace from JSON return a load report whose `findings` are computed on the document before frames, tokens and components have been derived. For any deck that uses auto layout the report describes geometry that is about to change. The trial saw it wrong in both directions: 0 warnings reported while 29 were real, and 28 reported while 0 were real.

## What the user experiences

An agent's loop is "load, read the report, fix, reload". It loads a deck built with frames, the report says the deck is clean, and the agent stops. The slide is in fact off the canvas. On the next attempt the report lists 28 problems for boxes the layout then moves into place, and the agent "fixes" things that were never wrong.

A person using Replace from JSON sees the same numbers in the toast ("Loaded: N fields dropped, M warnings").

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Build a deck whose only slide is a frame with children written at `x:0, y:0` and placeholder sizes (the pattern the frames documentation encourages), wide enough that the placeholders sit inside the canvas but the laid-out result does not, or the reverse.
3. In the console:
   ```js
   const r = window.bento.loadDoc(JSON.stringify(deck))
   console.log(r.findings.counts)                    // what the report says
   console.log((await window.bento.validate()).counts) // what is true after layout
   ```
4. The two differ.

## Evidence

Observed during the audit (AI trial, part 2): first load reported 0 warnings while `validate()` then gave 29; a later load reported 28 while `validate()` gave 0.

Confirmed in code now:

- `slides/src/compactload.ts:83` (full input) and `compactload.ts:111` (compact input) call `validateDoc(doc)` on the gated document and put the result in the report.
- No derive pass has run at that point. `derive` (`slides/src/derive.ts:49`) is called at boot (`slides/src/main.ts:160`), in the editor constructor (`slides/src/editor/editor.ts:251`), and on the store's `replace` event (`editor.ts:252`), which fires only after `loadDoc` hands the parsed document to `store.replaceDoc`.
- `derive` is what writes frame children's boxes (`layoutAll`), follows tokens (`syncTokenRefs`) and syncs component copies (`syncComponents`), so every finding that depends on geometry or bound values is stale.

Still unverified: nothing material; the trial's exact decks are not in the repo.

## How others do it

Anthropic's skill guidance asks for a validator loop the agent can trust ("run, fix, repeat"); a report that disagrees with the next `validate()` call breaks the loop. Figma's agent skills take one screenshot after composition, that is, after layout has run.

## Proposed change

In `parseDocInputReport` (`slides/src/compactload.ts`), run the derive pass on the gated document before calling `validateDoc`, in both branches:

```
const mem = deriveMemory(doc); derive(doc, mem)
```

then build the report. The document handed to the store is then already derived, and the editor's own pass on `replace` is a no-op. Keep the module DOM-free where it is today: `derive` is pure, so this does not add a DOM dependency.

Add one field to the report so a caller can tell the two apart: `derived: true`. Agents written against the old report ignore it.

Check the second caller: `openReplaceJson` (`slides/src/editor/editor.ts:1489`) uses the same function and benefits without change.

Alternative rejected: validating lazily after `replace` and patching the report asynchronously. `loadDoc` is synchronous and returns the report; keep it so.

## Acceptance criteria

- [ ] For every deck in `scripts/fixtures/agent-decks/`, `loadDoc(json).findings.counts` equals `(await validate()).counts` taken immediately afterwards, for the non-measured checks.
- [ ] The same holds for a frame deck written with placeholder coordinates.
- [ ] After `loadDoc`, the editor's `derive` on `replace` returns false (nothing left to derive).
- [ ] The report carries `derived: true`.
- [ ] `scripts/test-replace-json-gate.ts` and `scripts/test-slides-compact.ts` still pass.
- [ ] Token and component behaviour on load is unchanged (a binding that is dropped today is still dropped; reporting it is AI-12).

## Tests

Add `scripts/test-slides-load-report.ts` (node, bundled with esbuild like `test-replace-json-gate.ts`): for each fixture and for a frame deck with placeholder geometry, assert the report's findings equal `validateDoc` run on a separately derived copy. It must fail on the parent commit for the frame deck. Register it at the end of the slides slice in `.github/actions/validate-slides/action.yml`.

## Out of scope

- Fitting text heights after layout (AI-10).
- New findings for dropped bindings (AI-12).
- Showing the report inside the Replace dialog (AI-14).

## Notes for the implementer

Slides zone. `deriveMemory` reads tokens as unmoved, which is also what the editor does on `replace`; do not pass a different memory here or the report and the editor will disagree. The measured checks (`text-overflow`, `table-overflow`) need a DOM and fonts; in a node rig compare with `{ measure: false }`.

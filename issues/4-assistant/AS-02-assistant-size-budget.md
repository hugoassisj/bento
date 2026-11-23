---
id: AS-02
title: "Assistant size budget: what to cut to approach 15 KB"
epic: 4-assistant
type: enhancement
priority: P2
size: S
evidence: code
labels: [enhancement, "priority:P2", "size:S", "evidence:code", "area:assistant", needs-upstream-discussion]
depends_on: [AS-01]
related: [AS-06, AS-07]
upstream: ["nyblnet/bento#532"]
---
## Summary

The Assistant's page side costs about 24.5 KB in a shell that travels inside every saved file. The maintainer's target was 15 KB and the PR stalled on the choice of what to cut. This issue measures each part on the current build and lands the cuts that do not hurt, so the question put to the maintainer is a table of numbers, not an open choice.

## What the user experiences

Nothing visible. Every `.bento.html` a user saves carries the whole editor; bytes spent on the Assistant are paid by people who never open it.

## Reproduce

1. After AS-01, run `cd slides && npm run build:single` on the port and on its parent commit; compare `slides/dist-single/Bento_Slides.bento.html`.
2. Repeat with each candidate removed (below).

## Evidence

From the PR body (the maintainer's numbers, not re-measured here):

- Shell 698,881 B against 674,344 B on its base: **+24,537 B (+3.6%)**.
- Parts, minified and gzipped: panel 6.1 KB, ops 2.9 KB, material 2.6 KB, transport 2.1 KB, exthint 0.8 KB, sidebar tabs and CSS about 2 KB, catalogs about 6.6 KB (about 47 strings in eight locales; "the install card and two hint sentences are the longest").
- The PR leaves to "the maintainer's call" which of the pop-out window, the model picker, the transcript renderer and the explanatory strings to keep.

Confirmed in code on the PR branch:

- `slides/src/editor/assistant/panel.ts`: `popOut()` and `dockBack()` (the floating window), `buildPicker()` (the model picker), `proseHtml()` (the transcript's small markdown renderer), `installCard()` (two long paragraphs).
- The decision entry of 2026-09-18 ("Where model knowledge lives") records an earlier cut: moving prompts and model tables to the extension took the page side from +25,294 B to +18,239 B.

Changed since: `main` now packs the runtime with LZMA in base91 and stores the translation table one run per language (`scripts/size-budgets.json`, slides entry; `docs/DECISIONS.md` entries of 2026-11-19 and 2026-11-20). The gzip figures above do not transfer. Every number must be re-measured.

## How others do it

Not a product comparison. The relevant precedent is in this repo: "The slides shell diet" (`docs/DECISIONS.md`, 2026-11-19) recovered 136 KB after the 1.3.0 editor by measuring after each commit and removing nothing a user could see.

## Proposed change

Measure first, then cut in this order, stopping when the total is near 15 KB:

1. **Explanatory strings.** The install card's two paragraphs and the two hint sentences are the largest catalog entries and are multiplied by eight locales. Replace them with one short sentence and a link to a help page on bento.page; the long text lives there. Expect the largest saving per line changed.
2. **Transcript renderer.** `proseHtml()` renders a subset of markdown in replies. Fall back to plain text with paragraphs and line breaks, or reuse the editor's own typed-markdown conversion (`slides/src/editor/markdown.ts`) if it can be called on a string.
3. **Pop-out window.** If AS-01 homes the dock in the inspector tab bar, the floating window is a second presentation of the same thing. Removing it also removes its drag, resize and persistence code and CSS. Keep it only if AS-01 chose the pop-out as the sole home.
4. **Model picker.** Keep. Without it a person with two providers configured must leave the editor to switch, and it is the only place the active model is visible. If it must go, the status line should still show host and model, and the gear should open the extension's settings.
5. **`exthint.ts`.** Its save and update hints are about the extension, not the Assistant. Measure it separately and let the maintainer decide; do not cut it here.
6. **Shared code.** `ops.ts` and `material.ts` are also what AI-07 (`window.bento.outline()` and `patch()`) exposes to file agents. Once both land, the bytes serve two features; say so in the table.

Deliver the result as a table in the change description: part, bytes before, bytes after, what the user loses.

## Acceptance criteria

- [ ] A table of measured bytes for each part on the current packer, produced by building with the part removed.
- [ ] The explanatory strings are reduced to one sentence per surface in all eight catalogs, and the dead-key gate passes.
- [ ] Each cut that lands has its saving recorded next to the commit that made it.
- [ ] Every #532 rig still passes after each cut, with assertions on removed parts deleted in the same commit, not skipped.
- [ ] The final shell size and the remaining gap to 15 KB are stated.
- [ ] Nothing a user can do with one provider configured is lost.

## Tests

No new rig. `scripts/test-slides-assistant.ts` covers the picker and the transcript; update it with each cut. `scripts/test-spaces-size.mjs` prints the tracked shell sizes; quote its output.

## Out of scope

New Assistant features (AS-06 to AS-10). Moving more knowledge to the extension. Any change to the patch language.

## Notes for the implementer

- This is the question that stalled the maintainer's PR. Bring numbers; do not decide the keep-or-cut for the picker or `exthint.ts` on their behalf.
- Slides has no hard size ceiling (`scripts/size-budgets.json`: `enforce: false`), but growth "must say what bought them". The 15 KB figure is the maintainer's stated target for this feature, not a CI gate.
- Sizes differ by about 1 KB between node versions; compare builds made on the same machine.
- Property mangling stays off (`docs/DECISIONS.md`, shell diet entry). Do not reach for it.
- Later children (AS-06, AS-07, AS-08) add UI. Each must report its own byte cost against this baseline.

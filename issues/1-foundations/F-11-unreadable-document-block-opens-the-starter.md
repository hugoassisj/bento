---
id: F-11
title: "An unreadable document block silently opens the starter deck"
epic: 1-foundations
type: bug
priority: P0
size: S
evidence: seen
labels: [bug, "priority:P0", "size:S", "evidence:seen", "area:editor"]
depends_on: []
related: [AI-14, AI-08, AI-04]
upstream: []
---
## Summary

When the JSON in a file's `#bento-doc` block cannot be parsed, or parses but is not a full `bento/slides` document, the app boots the built-in Showcase starter deck instead, with no message. The user opens their file and sees the demo. Their content is still in the file but nothing says so, and nothing offers it back.

## What the user experiences

- An agent edits a deck in place and leaves a trailing comma, or a write is truncated. The owner double-clicks the file: the Bento Slides Showcase opens, titled "Bento Slides Showcase". No toast, no banner, nothing in the console.
- An agent writes the compact authoring form straight into the file (the docs present compact as the agent format). Same result.
- The natural next move is to assume the work is gone, or to press Save. What a save does from this state was **not** tested in the audit; if it writes the starter over the file, the original content is destroyed.

## Reproduce

Serve the app with a modified document block (the audit intercepted `/` on the dev server and replaced `id="bento-doc"></script>` with a block containing the JSON below, `<` escaped as `\u003c`). Equivalent on a built file: edit the `#bento-doc` block by hand.

1. Truncated: `{"format":"bento/slides","version":1,"title":"My real deck","slides":[{"id":"s1","elements":[{"id":"a","type":"text","x":10`
2. Trailing comma: `{"format":"bento/slides","version":1,"title":"My real deck","slides":[{"id":"s1","elements":[]},]}`
3. Compact form: `{"compact":true,"title":"My real deck","slides":[{"layout":"title","title":"Hello"}]}`
4. Control (valid): `{"format":"bento/slides","version":1,"title":"My real deck","size":{"w":1280,"h":720},"slides":[{"id":"s1","elements":[]}]}`

Results for 1–3: `window.bento.doc.title === "Bento Slides Showcase"`, 19 slides, no toast or banner. Result for 4: title "My real deck", 1 slide.

## Evidence

- Observed in the running app during the audit: all four cases were run with exactly these results; the AI authoring trial reproduced cases 2 and 3 on a built single file ("the starter opens with no notice and nothing in the console").
- Confirmed in code now:
  - `slides/src/main.ts:86` `const embedded = readEmbeddedDoc()`; `:98` `const parsed = embedded ? parseDoc(embedded) : null`; `:105` `bootWith(parsed || starterDoc(), !parsed)`. A non-empty block that fails to parse is treated exactly like an empty block.
  - `slides/src/model.ts:1647` `parseDoc()` returns `null` for a JSON syntax error, a wrong or missing `format`, an empty `slides` array, or a failed `fillRequired`, with no reason.
  - `kernel/src/save.ts:80` `readEmbeddedDoc()` returns the block's text or `null`.
  - A compact-aware parser exists but is not used at boot: `slides/src/compactload.ts` ("the agent entry point for a document that may be compact"), used by `loadDoc` and Replace from JSON.
- Not verified: what Save or autosave writes from this state, and whether the local recovery store offers anything. Establish both before choosing the wording of the recovery card.

## How others do it

- PowerPoint: "PowerPoint found a problem with content in file.pptx. PowerPoint can attempt to repair the presentation." It never opens a blank template in place of the file.
- Keynote: "The presentation can't be opened" with the file left untouched.

## Proposed change

1. In `slides/src/main.ts`, distinguish three cases: **no block content** (the bare app: boot the starter as today), **a valid document** (as today), and **content that did not load**.
2. For the third case, do not boot the editor on the starter. Show a recovery card (plain DOM, no dependency) that:
   - says the file's document could not be read and that the file has not been changed;
   - gives the reason: the JSON parse error with its position (line and column, or an excerpt around the offset), or "this is not a bento/slides document" (missing or wrong `format`), or "the document has no slides";
   - offers **Copy the document text**, **Download the document text** (the raw block), and **Open the starter deck instead** (explicit, so nothing is overwritten by accident);
   - if the text parses as the compact form, offers **Open it** by expanding it through the existing compact loader, and says that saving will write the full form.
3. To report a reason, `parseDoc` needs a sibling that says why it failed (suggest `parseDocReport(json): { doc } | { error: 'syntax' | 'format' | 'empty' | 'required', detail }`); keep `parseDoc`'s signature for its other callers.
4. While the card is shown, the save and autosave paths must be inert: there is no document to write.
5. `window.bento` must still be published in this state (the shell loader decides the app mounted by reading it; see the comment at `main.ts:88`–`93`). Publish a stub such as `{ format: 'bento/slides', unreadable: true, reason }` so a headless tool can detect the state.
6. Strings in every catalog.

Rejected: silently repairing JSON (trailing commas) at boot. A repair that guesses wrong is worse than a clear error; tolerant parsing belongs in the paste dialog (AI-14), where the user sees a summary before anything is applied.

## Acceptance criteria

- [ ] Cases 1–3 show the recovery card; the editor does not mount on the starter deck.
- [ ] The card names the reason; for case 2 it gives the position of the syntax error.
- [ ] Copy the document text puts the exact block text on the clipboard; Download saves it; neither modifies the file.
- [ ] Case 3 offers Open it, which loads a one-slide deck titled "My real deck".
- [ ] Open the starter deck instead boots the starter and marks the session so that a save cannot silently target the unreadable file (state the mechanism in the PR).
- [ ] An empty block still boots the starter with no card.
- [ ] Case 4 and every existing deck boot exactly as before.
- [ ] `window.bento.unreadable === true` in the card state, and the shell loader does not report a failed boot.
- [ ] No save, autosave or recovery snapshot is written while the card is shown.

## Tests

`scripts/test-slides-unreadable-doc-browser.mjs` (headless Chromium against the built shell, the way `scripts/test-csp-boot-browser.mjs` serves one): the four cases above plus the empty block; assert the card, the reason text, the clipboard content, the compact Open path, and that no write primitive is called. It must fail on the parent commit (cases 1–3 show the starter). Register in `.github/workflows/ci-slides.yml`. Also run `scripts/test-shell-loader.ts` and `scripts/test-fileopen-gate.ts` to confirm the loader contract is intact.

## Out of scope

- Tolerant parsing and summaries in Replace from JSON (AI-14).
- Accepting compact form as a normal on-disk format; this only rescues it.
- Encrypted files (the password gate path at `main.ts:87`–`95` is separate and unchanged).

## Notes for the implementer

- This touches the boot path. Read `docs/PLATFORM.md` §1–2 (single-file promise, splice contract) and `docs/architecture.md` first; the release process gates on boot invariants. Change `slides/src/main.ts` and `slides/src/model.ts` only; if you find you need `kernel/src/save.ts` to change, stop and split that out (kernel zone).
- `guardOpenedDoc` (`slides/src/restoregate.ts`) already handles "a file from a newer Bento": do not confuse an unknown-but-valid newer document with an unreadable one.
- Upstream has an open report of a related restore problem (issue #895, Restore offered after a download save); keep clear of the restore banner logic.
- P0 because the failure is silent and the affected user believes their work is gone. Smallest change in the epic; take it first.

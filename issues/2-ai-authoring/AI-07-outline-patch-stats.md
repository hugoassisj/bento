---
id: AI-07
title: "`window.bento.outline()`, `patch(ops)`, `stats()`: targeted edits for slides"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:ai", "needs-upstream-discussion"]
depends_on: []
related: [AI-04, AI-12, AI-15, AI-16, AS-01, AS-03]
upstream: ["nyblnet/bento#532"]
---
## Summary

The only way to change a slides document from outside is to replace all of it: `window.bento.loadDoc(json)` or *Replace from JSON*. An agent that wants to retitle one slide must read the whole deck and emit the whole deck. Add three calls that let it read a deck cheaply and change it surgically: `outline()`, `patch(ops)` with a dry run, and `stats()`.

The patch language already exists. The maintainer wrote it for the in-editor Assistant in upstream PR #532 (open, unmerged): `slides/src/editor/assistant/ops.ts` and `material.ts`. This issue lifts that format-side code into a place both the Assistant and outside agents use, which is why it carries `needs-upstream-discussion`.

## What the user experiences

From the audit's trial (edit the starter deck: change the accent, retitle slide 3, add a slide, add notes):

- The document block is 183–186 KB, about 50k tokens. The agent read an 11 KB outline it built itself and then rewrote all 186 KB. The same change as a patch is about 1.5 KB.
- A person using a chatbot must get roughly 40k tokens back; a truncated reply is the normal result (AI-14).
- "Slide 3" and "after slide 4" are ambiguous once state slides exist (19 slides, 15 shown); nothing defines the numbering.
- Whole-document replacement overwrites anything a person typed in the meantime and collapses undo to one step.

## Reproduce

```js
Object.keys(window.bento).filter(k => /outline|patch|stats/.test(k))   // []
JSON.stringify(window.bento.read()).length                              // ~151000 for the starter
```

## Evidence

Confirmed at `29b5c80`:

- `loadDoc` parses the input and calls `store.replaceDoc(parsed.doc)` (`slides/src/main.ts:382-400`; `slides/src/store.ts:90`).
- No outline, patch or stats entry on the surface (`slides/src/main.ts:308-496`).
- Spaces has exactly this and warns against whole-document replacement: "Use the patch verbs, not `loadDoc`. Rewriting the document to add a paragraph flattens undo to one entry and overwrites anything a person typed while you were thinking" (`docs/spaces-agents.md`, the `window.bento` section, lines ~643–676), with tagged results `{ok:true,…}` / `{ok:false, err, detail}`.
- The extension side of the Assistant is on main and already teaches the ops verbs: `edits`, `notes`, `cells`, `chart`, `style`, `add`, `remove`, `move`, `set`, `insert`, `delete`, `slide` (`home/webext/src/prompt.js:76-87`), and tools `outline`, `slide`, `patch` (`prompt.js:144-148`).
- The page side is NOT on main: `slides/src/editor/assistant/` does not exist. It is in upstream PR #532, head `b5fca9f` (`git fetch upstream pull/532/head`): `ops.ts` (343 lines: what each verb means, applied to a compact copy, then the gate), `material.ts` (382 lines: the addressed outline `<slide number>/<element id>`, the focus, asset elision).

Seen during the audit on that branch with a simulated extension: an `edits` + `notes` + `set` patch applied as one undoable step; two junk fields (`bogusKey`, `onclick`) were refused and listed by path.

## How others do it

- Canva edits through transactions; Gamma's `edit_gamma` takes card ids (https://www.canva.dev/docs/mcp/tools/, https://developers.gamma.app/mcp/mcp-tools-reference.md); Slidev's tool server edits and reorders slides (https://sli.dev/guide/work-with-ai).
- Figma returns selection-scoped, sparse metadata rather than the whole file (https://github.com/figma/mcp-server-guide).

## Proposed change

1. Move the format-side modules to a shared home, for example `slides/src/ops.ts` and `slides/src/outline.ts`, ported from PR #532's `ops.ts` and `material.ts` and brought up to 1.3.0 (they predate frames, tokens and components; see AS-03 for what the outline must add). The Assistant imports them from there.
2. Add to `window.bento` (`slides/src/main.ts`):

```ts
outline(opts?: { slide?: number }): string | object
  // every slide numbered 1-based over doc.slides (state slides included and marked,
  // hidden slides marked), every text, table cell and chart addressed "<n>/<elementId>",
  // notes included, assets elided, collab never included

patch(ops: object, opts?: { dryRun?: boolean }):
  { ok: true, applied: string[], skipped: { op: string, reason: string }[],
    findings: Finding[], outline?: string }
  | { ok: false, err: 'bad-patch' | 'readonly', detail: string }

stats(): { slides, shown, elements, bytes, assets: [{ key, bytes }], fonts, bound, literal }
```

3. `patch` semantics: apply to a copy; pass the result through the same untrusted gate pasted JSON meets (`parseDocInputReport`, `slides/src/compactload.ts:72`); report only findings the patch **introduced**; commit as ONE undoable step; `dryRun: true` commits nothing and returns the same report. A refused patch changes nothing, including undo history.
4. Element addresses are `<n>/<id>`; slide numbers are positions in `doc.slides`. Write the numbering rule into `docs/agents.md`.
5. Prefer `store.commit` on the live document over `replaceDoc` if the gate can run on the touched slides only, so collaborators' concurrent edits to other slides survive. If not feasible, say so and keep `replaceDoc`.
6. Add `outline` and `patch` verbs to AI-04's script (they need the browser path) and document all three calls.

## Acceptance criteria

- [ ] `outline()` for the 1.3.0 starter is under 15 KB and contains every text, with no `collab` value and no asset data.
- [ ] `patch({ edits: [{ id: '1/sd-title', text: 'X' }] })` changes that element's text only; `JSON.stringify` of every other element is unchanged; one `undo()` restores the document byte for byte.
- [ ] `patch(..., { dryRun: true })` returns the same `applied`/`skipped`/`findings` and leaves `doc` and the undo stack untouched.
- [ ] An unknown verb, an address that does not resolve and a field the gate drops are each listed in `skipped` with a reason; none throws.
- [ ] `patch` never changes `docId`, `collab` or `readonly`, whatever the ops contain.
- [ ] Hostile content in a patch (`<img onerror>`, `javascript:` link, a `<script>` in svg markup) does not reach the stored document.
- [ ] `stats()` reports the largest assets by byte size.

## Tests

Port the relevant cases of PR #532's `scripts/test-slides-assistant.ts` (990 lines; it drives the real apply with hostile payloads) into `scripts/test-slides-ops.ts`, registered at the end of the slides slice in `.github/actions/validate-slides/action.yml`, plus a browser rig `scripts/test-slides-patch-api-browser.mjs` in `.github/workflows/ci-slides.yml` for the undo and dry-run criteria.

## Out of scope

The Assistant drawer and its transport (AS-01); teaching the outline about tokens, components and frames (AS-03); protected-by-default behaviour for the design system (AI-16); the chatbot prompt (AI-15).

## Notes for the implementer

- This reuses the maintainer's unmerged work. In this fork that is fine; for upstream, raise it with the maintainer before proposing it, and credit the source in the change description. PR #532's `docs/DECISIONS.md` entries of 2026-09-18 hold the reasoning ("the assistant reads the deck whole and writes it surgically; the model never hands the deck back").
- PR #532 is based on 1.2.3; expect conflicts in `slides/src/editor/editor.ts` and `slides/src/render.ts`. Take only the format-side modules here.
- Slides zone; no format change; no new UI strings. Report the shell's byte cost: in PR #532 `ops` was 2.9 KB and `material` 2.6 KB minified and gzipped.
- Security conditions A–G recorded in that PR's decision entry apply to `patch` unchanged; do not weaken the clean-on-the-way-in step.

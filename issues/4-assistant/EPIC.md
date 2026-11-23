---
id: EPIC-4
title: "Epic 4: The Assistant, finished and extended"
epic: 4-assistant
type: epic
labels: [epic, "area:assistant", needs-upstream-discussion]
---
## Goal

A person editing a deck can ask for a change in plain words, see exactly what will change, accept or reject it, and undo it, using a model they chose and pay for. The key they use never touches the document or the document's page. The Assistant works inside the deck's own design system (`issues/00-READ-FIRST.md` §6) and every app function still works with no model at all.

## What exists today

**Extension side: on `main`.** `home/webext/src/` holds the whole model side, shipped with the bento/home browser extension:

- `assistant.js` (766 lines): config, per-document consent, model listing, `run` and `runTurn` (line 558), the agent loop. Deliberately free of extension APIs: every function takes an `env` argument (`env.fetch`, `env.LanguageModel`, `env.t`, `env.models`, `env.builtinTokens`).
- `providers.js`: request shaping for `openai`, `anthropic`, `gemini` (`DEFAULTS` at line 39) and the on-device `builtin` model.
- `prompt.js` (297 lines): `OPS_PROMPT` (line 76), `QUESTION_PROMPT`, `AGENT_TOOLS` (line 144: `outline`, `slide`, `patch`).
- `web.js`, `relay.js`, `page-bridge.js` (line 149 announces the `assistant` capability), `consent.html`, the Assistant card in `home.html`.
- Rig: `scripts/test-webext-assistant.ts`.

**Page side: only in upstream PR #532** (`nyblnet/bento`, branch `slides-assistant-2`, one commit `b5fca9f`, opened 2026-09-19, no reviewer, based on 1.2.3):

- `slides/src/editor/assistant/transport.ts` (421 lines): the bridge contract and `ExtensionTransport`.
- `material.ts` (382): what a turn sends (plain outline, addressed outline, focus JSON, theme), elision of assets and private keys, `mergeReply`, `cleanDoc`.
- `ops.ts` (343): the patch language (`edits notes cells chart style add remove move set insert delete slide`).
- `panel.ts` (679): the drawer, pop-out window, model picker, transcript renderer, install card.
- `exthint.ts` (68), rigs `scripts/test-slides-assistant.ts` (990 lines, 224 checks), `scripts/test-slides-exthint.ts`, and a block in `scripts/test-export-secrets.ts` asserting the page has no place to put a key.
- Two `docs/DECISIONS.md` entries dated 2026-09-18.

**Why it stalled** (from the PR body and the decision entries):

1. Size. +24,537 B on the shell against a 15 KB target. The maintainer left open which of the pop-out window, the model picker, the transcript renderer and the explanatory strings to keep.
2. It predates the 1.3.0 editor. It wraps the right sidebar in a "Properties | Assistant" tab pair (`buildPropsTabs`, `showPropsTab` in its `editor.ts`), and 1.3.0 rebuilt that sidebar with its own Format / Animate / Interact tab bar (`slides/src/editor/panels.ts` `mountTabs`, line 224). It no longer applies.
3. `home/webext/src/prompt.js` was last touched 2026-10-21, before 1.3.0. It never mentions tokens, palette bindings, components or frames.

**Observed in this audit.** The #532 branch was run locally with a simulated extension answering `assistant.describe`, `assistant.models`, `assistant.check`, then `assistant.turn` followed by the `assistant.document` handshake and an `assistant.done` frame carrying ops. The slide title and notes changed in one undoable step and the card read "Applied 3 changes · Undo · 2 fields dropped, 0 warnings", listing `/slides/0/elements/28/bogusKey — unknown key for a text element`. No real model was called.

## Where the key can live

The recorded rule (decision entry of 2026-09-18 on the PR branch): the page never sees a key and has no field to put one in, "not in the document, not in localStorage, not in a module variable".

| Option | Key lifetime | Works where | Fits the rule | State |
|---|---|---|---|---|
| Browser extension | Extension storage, until removed | Chrome and Edge, decks opened from disk (`docKeyOf` in `assistant.js` accepts `file:` only) | Yes | Extension side on main; page side in #532 |
| Key window (AS-04) | Memory of a separate window; closing it forgets the key | Any browser, no install, decks from disk or served | Yes: the deck page never sees it | Prototyped in this audit; not built |
| On-device model (AS-05) | No key exists | Chrome 148+ desktop | Nothing to leak | Supported through the extension today |
| Key typed into the editor | Until the tab closes | Decks from disk only; a served deck's CSP blocks it | No: contradicts the recorded decision | Built once by the maintainer, then cut |
| Native apps (iOS, Android, desktop hosts) | Operating-system keychain | Inside those apps | Yes | Not built; out of scope for this epic |

## Children, in order

- [ ] **AS-01** Port the drawer onto the 1.3.0 editor. Everything else depends on it.
- [ ] **AS-02** Size budget. Depends on AS-01.
- [ ] **AS-03** Design-system awareness. Depends on AS-01, AI-08, AI-09.
- [ ] **AS-06** Actions where you work. Depends on AS-01, F-05, F-06.
- [ ] **AS-07** Review before apply. Depends on AS-01; shares the patch result shape with AI-07 and the findings list with F-10.
- [ ] **AS-04** Key window. Depends on AS-01.
- [ ] **AS-05** On-device model with no key. Depends on AS-01; easiest after AS-04.
- [ ] **AS-08** Variants as thumbnails. Depends on AS-07, AI-06.
- [ ] **AS-09** Deck review. Depends on AS-01, F-09, F-10, AI-06, AI-07.
- [ ] **AS-10** Assistant tasks. Depends on AS-03.

## Questions to put to the maintainer before proposing any of this upstream

1. Is #532 still wanted, and would a port onto the 1.3.0 editor be welcome as a contribution, or is it being reworked privately?
2. Which of the pop-out window, model picker, transcript renderer and explanatory strings should go to meet the size target, and is 15 KB still the target after the LZMA re-pack?
3. Where should the drawer live in the 1.3.0 inspector (see AS-01's options)?
4. Would a key window served from `bento.page` be acceptable as a second host for the same bridge contract (AS-04)? It needs a page in the ops zone and a decision on whether the provider code is shared with the extension or copied.
5. May the page side gain knowledge of tokens, components and frames (AS-03), given the decision that the page holds format knowledge and the extension holds model knowledge?
6. Is an Assistant for decks served from `bento.page` in scope at all? Today the extension attaches to `file:` pages only.

## Definition of done

- The drawer runs in the 1.3.0 editor with every #532 rig passing, plus the rigs added by the children.
- `scripts/test-export-secrets.ts` still asserts that no module under `slides/src/editor/assistant/` makes a request, names a credential header, or writes a key, endpoint or model to storage, and that `slides/src/model.ts` has no field for one.
- With no extension, no key window and no on-device model, the editor behaves exactly as it does today apart from one install card. Offline mode disables every Assistant entry point.
- A turn never changes theme, tokens, component mains, layouts or fonts unless the request named them.
- The shell's byte cost is recorded for each child.

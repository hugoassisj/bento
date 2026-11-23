---
id: AI-15
title: "Copy prompt for a chatbot: outline plus patch instructions, reply applied as a patch"
epic: 2-ai-authoring
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:editor"]
depends_on: [AI-07, AI-14]
related: [AI-13, AI-16, AS-06, AI-02]
upstream: []
---
## Summary

The chat round trip asks a chatbot to return the whole deck: about 40,000 tokens for the starter. Truncation is therefore the normal outcome, and it is the failure the app explains least. Add a File menu item that copies a ready prompt containing instructions, the deck's design system, a text outline of the deck and the selected slide in full, and asks for a small patch in reply. Replace from JSON accepts that patch.

## What the user experiences

Today: File menu, Copy document JSON gives 151 KB on one line. The person pastes it into a chatbot with their own request. The chatbot must reproduce all of it to change one title. Many replies are cut off; some drop slides; a few rewrite colours the user chose.

After: the person selects the slide they care about, chooses Copy prompt for a chatbot, pastes, and types the request at the end. The reply is a few hundred bytes. Pasting it back shows "2 texts changed, speaker notes added on slide 3" and applies as one undo step.

## Reproduce

Current state, in the running app: File menu, Advanced lists Copy document JSON, Copy compact JSON (for agents) and Replace from JSON…. There is no item that copies instructions. Copy compact JSON on the starter puts about 136 KB on the clipboard (the trial measured 151 KB full, 136 KB compact).

## Evidence

Observed during the audit (AI trial): the copy is two clicks; compact form saved about 10% on real decks; a patch for the trial's edit was about 1.5 KB against a 186 KB rewrite.

Confirmed in code now:

- The three items are built at `slides/src/editor/editor.ts:1234-1243` and registered as commands at `editor.ts:3862-3864`.
- `copyDocJson` (`editor.ts:1451-1461`) strips the live-session keys before copying.
- A patch language and an addressed outline already exist in the tree for the unmerged Assistant: the extension's prompt in `home/webext/src/prompt.js` (`OPS_PROMPT` at line 76 describes the operations; the outline shapes are described at lines 18-33). The page-side modules that build the outline and apply the patch (`slides/src/editor/assistant/material.ts`, `ops.ts`) exist only in upstream PR #532, not on `main`.

Still unverified: how reliably current chatbots return the patch shape from a pasted prompt. Measure it as part of this issue with at least three assistants and record the results in the PR.

## How others do it

Gamma and Canva expose edit calls that take the ids of what to change, not the whole document (https://developers.gamma.app/mcp/mcp-tools-reference.md, https://www.canva.dev/docs/mcp/tools/). Figma's agent guidance scopes context to the selection. For people without a tool-calling agent, a copy-and-paste prompt is the same idea by hand.

## Proposed change

Builds on `window.bento.outline()` and `patch()` from AI-07 and the dialog from AI-14.

1. A new File menu item under Advanced and a matching command: **Copy prompt for a chatbot**. It copies plain text with four parts:
   - Instructions (fixed text, kept short): reply with one JSON object of operations and nothing else; use only addresses that appear in the outline; never change the theme, tokens, fonts or components unless asked; reuse the listed colours and tokens by name.
   - The design system: palette slots and tokens by name and value, fonts, component names, layout names (the same inventory AI-04 `inspect` prints).
   - The addressed outline of the whole deck.
   - The current slide, or the selection, in compact form.
   The live-session keys never appear, exactly as in `copyDocJson`.
2. Replace from JSON recognises a patch (an object with operation keys and no `format`/`slides`) and applies it through `patch()` with a dry run first, showing the per-change summary from AI-14: applied, refused and why.
3. The instruction text lives in one module shared with the skill reference (AI-02) so the two cannot drift. It is English: it is written for the model. The menu label, tooltip and dialog strings go through `t()`.
4. Say in the dialog what leaves the device: "This copies your slide text and speaker notes. Comments and sharing keys are not included."

No format change. No network: the app only writes to the clipboard.

Alternative rejected: an in-page field for a model key and a Send button. Recorded decision: the page never holds a key (upstream PR #532, `docs/DECISIONS.md` "AI is additive, never load-bearing").

## Acceptance criteria

- [ ] The copied prompt for the starter is under 20 KB and contains no `collab` material and no asset data.
- [ ] It lists every palette slot, token, component and deck layout by name.
- [ ] Pasting a valid patch into Replace from JSON shows a per-change summary and applies as one undo step.
- [ ] A patch that addresses an element not in the deck is refused for that operation only, with the address named.
- [ ] A patch that tries to change tokens or the theme without the request naming them is reported as refused (ties to AI-16).
- [ ] The instruction text has one source used by both the menu item and the skill reference.
- [ ] New strings exist in all eight catalogs.
- [ ] The PR records a trial with three chatbots: request, reply size, whether the patch applied.

## Tests

- `scripts/test-slides-chat-prompt.ts` (node): builds the prompt for `starterDoc()`, asserts size, absence of keys and assets, and presence of every token and slot name.
- Extend the Replace dialog browser rig from AI-14 with a patch paste.
- `scripts/test-export-secrets.ts`: add the prompt to the paths that must not carry session keys.

## Out of scope

- Any model call from the page.
- The in-editor Assistant (epic 4), which uses the same outline and patch over the extension bridge.

## Notes for the implementer

Slides zone. Coordinate with AS-01: if the Assistant port lands first, reuse its `material.ts` and `ops.ts` instead of writing a second outline builder. The outline format is agent-facing API once shipped; keep it stable and versioned in the reference.

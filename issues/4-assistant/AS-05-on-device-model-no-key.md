---
id: AS-05
title: "On-device model path with no key"
epic: 4-assistant
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:assistant", needs-upstream-discussion]
depends_on: [AS-01]
related: [AS-04, AS-06]
upstream: ["nyblnet/bento#532", "nyblnet/bento#513"]
---
## Summary

Chrome ships a small language model that runs on the user's machine. With it the Assistant needs no key, no account and no network: nothing to leak and nothing to pay. The extension already routes to it. This issue makes that path reachable without the extension, and makes it good at the tasks a small model can do, so "try the Assistant" costs a user nothing.

## What the user experiences

The install card on the PR branch promises: "By default it runs on Chrome's built-in model: nothing leaves your computer, no account, no key." That is true only after installing the extension. Without it there is no Assistant at all, although the browser the user is sitting in may already have the model.

## Reproduce

1. On the PR branch, read `installCard()` in `slides/src/editor/assistant/panel.ts`.
2. In Chrome 148 or later on desktop, open any `.bento.html` from disk and evaluate `typeof LanguageModel` in the console.
3. Evaluate `await LanguageModel.availability()`.

## Evidence

Seen in this audit: in the test Chromium, `typeof LanguageModel` was `function` on a page opened from `file://` (which reports `isSecureContext: true`) and on a page served over HTTP from localhost. **No model was downloaded or run**; `availability()` was not called. Whether a real Chrome exposes a usable model to a `file://` page is unverified.

Confirmed in code:

- `home/webext/src/assistant.js`: `PROVIDERS = ['builtin', 'gemini', 'anthropic', 'openai']` (line 47); `builtinAvailability(LanguageModel)` (line 341) returns `'unsupported'` when `LanguageModel.availability` is not a function; `builtinContext()` (line 315) creates a session to read the input quota; `models()` (line 195) and `describe()` (line 354) take the model from `env.LanguageModel`.
- The bridge already has what the page needs: `describe` may say `local: true` with an empty host, `check` may fail with `code: 'consent-pending'` while Chrome asks about the download, and the page renders "on this device · Gemini Nano" from `MODEL_NAMES` in `panel.ts`.
- The 2026-09-18 decision entry sizes turns for this model: an assumed 6k-token on-device window gets the outline alone for the starter deck's first slide, or the focus for a single selected element, and the strict words-and-choices schema is sent because "a small model asked in prose answers in prose".
- The same entry explains why prompts live in the extension and not the page: +25,294 B when they were in the page.

From documentation, not tested: the Prompt API is available to web pages in Chrome 148 on desktop, in secure contexts, needs a recent user gesture to create a session, downloads the model on first use, and accepts English, Japanese and Spanish (https://developer.chrome.com/docs/ai/prompt-api).

## How others do it

- Keynote 15.3 generates presenter notes from slide content (https://support.apple.com/en-lb/guide/keynote-iphone/tan700f60676/ios); Figma Slides adjusts tone and length and adds notes (https://www.figma.com/blog/how-teams-tap-into-the-power-of-design-with-figma-slides/). These are exactly the short, text-only jobs a small local model handles.
- None of them runs offline on the user's own machine. This is a place Bento can be first.

## Proposed change

**Step 0, before any code: find out what is real.** In a current desktop Chrome, from a `.bento.html` opened from disk and from a served page, record `typeof LanguageModel`, `await LanguageModel.availability()`, whether `create()` succeeds after a click, the reported input quota, and one prompt's latency. Write the results into the issue. Everything below depends on them.

**Preferred: the key window hosts it (needs AS-04).** The key window already loads `assistant.js` with an `env`. Give it `env.LanguageModel = window.LanguageModel` and the `builtin` provider works there with no new page code and no prompt in the shell. The window's first screen offers "On this device (no key)" above the hosted providers when `availability()` is not `'unsupported'`. The download prompt and progress live in the window, where there is room to explain them.

**Alternative: directly in the deck page, no window.** Only if step 0 shows `file://` pages get a working model and the maintainer wants a zero-click path. A third carrier, in-process: a small module that answers the bridge ops by calling `LanguageModel` itself. No request primitive and no credential are involved, so the secrets rig's assertions about `fetch` and key shapes still hold, but the prompts (`OPS_PROMPT`, the strict schema, the question detector) would have to ship in the page, which is the 25 KB the maintainer already moved out. A trimmed, words-only prompt (edits, notes, style) might fit in 2 to 3 KB. Do not build this without a size number and the maintainer's answer.

**Make the small model useful, whichever host.**

- Offer only what it does well: rewrite, shorten, fix grammar, translate between its supported languages, write speaker notes for this slide, suggest a title. These are `edits` and `notes` ops on the selection.
- Refuse the rest in words, with the reason and the alternative: "Adding slides needs a larger model. Open the key window to use one."
- Size the turn from the real quota (`describe.contextTokens`), not the 6k assumption, once step 0 has the number.
- Language: if the UI language is not one the model accepts, say so before the first turn.

**Status line.** "On this device · Gemini Nano · nothing leaves this computer". In offline mode this path stays available only if the model is already downloaded; never start a download while offline.

## Acceptance criteria

- [ ] The step 0 measurements are recorded in this file for Chrome on `file://` and on a served page.
- [ ] With the model available and no key anywhere, a "shorten this" request on a selected text box completes and applies as one undo step, with no network request made (asserted by a request log).
- [ ] The host reports `local: true`, an empty host, and the real `contextTokens`.
- [ ] A request outside the small model's set is refused in plain words and changes nothing.
- [ ] While Chrome is asking about the download, the drawer shows waiting text and re-checks once on focus, as the existing `consent-pending` handling does.
- [ ] In a browser without the API, the option is not shown at all.
- [ ] `scripts/test-export-secrets.ts` passes unmodified.
- [ ] If the in-page alternative is built: its byte cost is recorded and no prompt text is duplicated between page and extension without a test that keeps them in step.

## Tests

- `scripts/test-webext-assistant.ts` already drives `assistant.js` with a fake `LanguageModel`; add cases for the key window's `env` and for the refusal of non-text ops on a small window.
- `scripts/test-slides-assistant.ts`: the `local: true` rendering, `consent-pending`, and the request log proving no network use.
- A manual check in a real Chrome is required; a headless build may expose the API with no model behind it. Say which Chrome version was used.

## Out of scope

Bundling a model. WebGPU or WebLLM runtimes (a runtime dependency and megabytes of weights). Local servers such as Ollama: they are already reachable through the extension's OpenAI-compatible provider with an editable base URL, and from the key window once AS-04 lands.

## Notes for the implementer

- Needs the maintainer's agreement before going upstream: it changes how their unmerged feature is reached, and the in-page alternative reverses a size decision they measured.
- "AI is additive, never load-bearing". The option's absence must be invisible.
- The page never holds a key. This path has none, which is its point; do not let it become a reason to add in-page provider calls for hosted models.
- Offline mode disables the drawer today (`AssistantPanel.submit` returns when `offlineEnabled()`). An on-device model sends nothing, so offline mode could allow it; that is a wording change to a promise the app makes ("nothing leaves your machine") and belongs to the maintainer.
- A small model follows the design-system rule (`issues/00-READ-FIRST.md` §6) by construction if it is only allowed `edits`, `notes` and `style`: it cannot write a colour or a font.
- The +24.5 KB against 15 KB budget applies. Report bytes.

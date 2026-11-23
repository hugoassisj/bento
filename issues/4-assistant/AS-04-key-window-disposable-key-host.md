---
id: AS-04
title: "Key window: a disposable-key host that needs no extension"
epic: 4-assistant
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:assistant", needs-upstream-discussion]
depends_on: [AS-01]
related: [AS-05, AS-02]
upstream: ["nyblnet/bento#532", "nyblnet/bento#513"]
---
## Summary

Today the Assistant needs the bento/home browser extension: Chrome or Edge only, an install, decks opened from disk only, and a key stored until removed. This issue adds a second host for the same bridge contract: a small separate window that holds the provider choice and the key **in its own memory only**. Close the window and the key is gone. The deck page still never sees a key, so the maintainer's rule holds. It works in any browser and for served decks.

**What this is not.** It is not a key typed into the editor. A key held by the document's page, even in a module variable that is never saved, contradicts the recorded decision ("not in the document, not in localStorage, not in a module variable"), was built by the maintainer as far as the request shapers and then cut, and is asserted absent by `scripts/test-export-secrets.ts`. Do not build that.

## What the user experiences

Without the extension the drawer shows an install card and nothing else. Firefox and Safari users have no path (the extension is Chromium-only, `home/webext/README.md`). A deck served from bento.page has no path even with the extension: `docKeyOf` in `home/webext/src/assistant.js` (line 63) returns null for anything but `file:`. A person who only wants to try it for ten minutes must install an extension and store a key in it.

## Reproduce

1. Open the port (AS-01) in Firefox, or in Chrome without the extension: the install card.
2. Read `transport.ts` on the PR branch: `extensionPresent()` (line 258) is the only way a transport exists.

## Evidence

Prototyped in this audit (headless Chromium, two throwaway pages):

- A page opened from `file://` (origin `null`) called `window.open()` on a page served from another origin and exchanged `{ __bento_tray__: true, dir: 'req' | 'res', id, op }` frames with it using `postMessage`. The reply arrived with `event.origin` equal to the window's origin.
- The opener tried to read the key field in that window's DOM: `SecurityError`. Cross-origin access is blocked both ways.
- `assistant.describe` answered `configured: false`, then `configured: true` after a key was typed into the window. The opener learned only that boolean.
- `typeof LanguageModel` was `function` on the `file://` page and on the served page in that Chromium; no model was run.

Confirmed in code:

- `home/webext/src/assistant.js` states it is "deliberately `chrome`-free: it takes its environment as an argument". Its functions read `env.fetch`, `env.LanguageModel`, `env.t`, `env.models`, `env.builtinTokens`. In `assistant.js`, `providers.js`, `prompt.js` and `web.js` the `chrome.*` APIs appear only in comments; `background.js` supplies the real environment.
- PR branch `transport.ts`: `ExtensionTransport` posts to `this.w` and accepts only frames where `ev.source === this.w`. The op set is `assistant.describe | models | select | check | turn | document | abort | settings.open`.
- `kernel/src/gate1.ts` `hostPolicy()` (line 416) serves verified documents with `connect-src https://bento.page https://sync.bento.page wss://sync.bento.page`. That blocks a served deck from calling a provider. It does not restrict `window.open` or `postMessage`.
- A deck opened from disk carries no CSP of its own, which is why an in-page key would technically work there, and why the rule against it has to be a rule.

Not verified: any real provider call from such a window; popup behaviour in Safari and Firefox; whether bento.page sets a `Cross-Origin-Opener-Policy` that would sever the opener (if it does, this page needs `unsafe-none` or the design needs a `MessageChannel` handed over at open).

## How others do it

- Browser-side bring-your-own-key is established practice: Anthropic's API accepts browser calls with an explicit opt-in header (https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access), which `home/webext/src/providers.js` already sends.
- Sign-in instead of pasting a key: OpenRouter's PKCE flow returns a user-controlled key to a callback page (https://openrouter.ai/docs/guides/overview/auth/oauth).
- PowerPoint, Figma Slides and Keynote tie AI to a vendor account; none lets the user bring a provider.

## Proposed change

**1. The host page.** One static page, for example `https://bento.page/assistant/`, built from `site-src/` with the extension's `assistant.js`, `providers.js`, `prompt.js` and `web.js` bundled unchanged (import them; do not fork them). It supplies an `env`: `fetch` is the page's own, `LanguageModel` the page's own, `t` a small English table (later the extension's `_locales`), storage an in-memory object. It shows the provider selector, the key field, the model list, and one line: "This window holds your key until you close it. The document never sees it."

**2. Pairing.** The window serves exactly one deck: the one that opened it. It accepts frames only where `event.source === window.opener`, replies only to that reference, and ignores everything if it was not opened by script. The deck accepts frames only where `event.source` is the window it opened **and** `event.origin` is the pinned host origin. The deck's origin is `null` for files, so the window cannot check an origin; the opener relationship is the pairing.

**3. Consent.** The window shows what the opener claims to be (the deck title sent in a `hello` frame, labelled as a claim) and asks once before the first turn, as the extension does per document. Nothing of the document is requested before consent: the existing order (`assistant.turn`, consent, `assistant.document`) already guarantees this.

**4. Key lifetime.** Memory only by default. An optional checkbox, off by default, stores the key in the host origin's own storage, which no deck can read. No key is ever sent in a frame; `describe` returns host and model only, bounded by the page's existing shape guards (`HOST_RE`, `MODEL_RE`).

**5. Deck side.** Split the carrier out of `ExtensionTransport`: a `Carrier { post(frame), accepts(ev) }` with two implementations, the same-window one and a `WindowProxy` one. Add `openKeyWindow()` behind a user gesture (a button on the install card: "Use a key without installing anything"). Selection order: extension if present, else an open key window, else the card. The page gains no request primitive and no key field, so the secrets rig passes unchanged.

**6. Failure handling.** Popup blocked: say so and show a plain link. Window closed mid-turn: an `assistant.error` with code `host-closed`; the drawer returns to the card. Offline mode: the button is disabled.

**7. Later, same window.** Sign-in through a provider's OAuth-style flow, with the callback landing on the host page.

**Threat model.**

- A hostile local file opens the window: it gets an empty window with no key. To spend a key it must persuade the user to type one into a window that names the opener; the consent screen is the control.
- A hostile deck that is the legitimate opener (the user's own deck with injected content): it can send turns, which costs tokens, and receive replies. It cannot read the key. This is the same exposure the extension accepts, and per-document consent bounds it.
- Phishing: a page can open a look-alike window on another origin. The address bar is the defence; say the real origin on the install card.
- The reply is data. It reaches the document only through `applyOps`, the gate and `cleanDoc`, exactly as now.

Rejected: a sandboxed iframe inside the shell (the parent controls its content and its CSP is inherited); a key in the page's memory (see Summary).

## Acceptance criteria

- [ ] From a `file://` deck with no extension, one click opens the key window and, after a key is entered there, `assistant.describe` reports `configured: true` to the deck.
- [ ] A full simulated turn (describe, check, turn, consent, document, done) completes through the window carrier and applies as one undo step.
- [ ] Reading the window's DOM or globals from the deck throws; a rig asserts it.
- [ ] No frame sent to the deck contains the key string; a rig greps every frame.
- [ ] Closing the window ends the session: the next `describe` times out and the drawer shows the card. Reopening shows an empty key field unless "remember" was ticked.
- [ ] Frames from any window other than the one opened, or from another origin, are ignored by the deck.
- [ ] `scripts/test-export-secrets.ts` passes unmodified in its assertions about `slides/src/editor/assistant/` and `slides/src/model.ts`.
- [ ] The same flow works from a served deck under `hostPolicy()`'s CSP.
- [ ] Offline mode disables the button and no window opens.

## Tests

- `scripts/test-slides-keywindow-browser.mjs`: two origins (a file page and a local server), the pairing rules, the SecurityError, the no-key-in-frames grep, close and reopen.
- Extend `scripts/test-slides-assistant.ts` with a `WindowProxy` carrier double.
- Extend `scripts/test-webext-assistant.ts` to run `assistant.js` under the window's in-memory `env`, proving the shared code needs no extension API.
- `scripts/test-export-secrets.ts`: unchanged, and must stay green.

## Out of scope

Native app hosts. Storing keys in the document under any encoding. Proxying requests through a Bento server. Billing.

## Notes for the implementer

- This needs the maintainer twice: the host page lives on bento.page (`site-src/`, the ops zone), and it is a second implementation of the contract in their open PR. Build and prove it locally against a local server; do not propose it upstream without their answer.
- "AI is additive, never load-bearing". With no window and no extension the editor is unchanged.
- The page never holds a key. If a design step seems to need the key on the deck side, the design is wrong.
- The +24.5 KB already spent on the drawer is the constraint; the carrier split and one button must cost well under 1 KB. Report it.
- Design-system rule: `issues/00-READ-FIRST.md` §6 applies to whatever the model returns, whichever host answered.

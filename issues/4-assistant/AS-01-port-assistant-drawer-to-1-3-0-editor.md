---
id: AS-01
title: "Port the Assistant drawer (upstream PR #532) onto the 1.3.0 editor"
epic: 4-assistant
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:assistant", needs-upstream-discussion]
depends_on: []
related: [AS-02, AS-03, AS-06, AS-07, AI-07]
upstream: ["nyblnet/bento#532", "nyblnet/bento#512", "nyblnet/bento#513"]
---
## Summary

Upstream PR #532 adds an Assistant drawer to the slides editor: describe a change in words, a model returns a small patch, the page applies it as one undoable step. It was written against 1.2.3 and has sat unmerged since 2026-09-19. The 1.3.0 editor rebuilt the sidebar it lives in, so it no longer applies. This issue ports the page side onto the current editor, unchanged in behaviour, with every one of its rigs passing. Everything else in this epic builds on it.

## What the user experiences

On 1.3.0 there is no Assistant. The only AI path in the product is File menu, Advanced, "Copy compact JSON (for agents)" and "Replace from JSON…" (`slides/src/editor/editor.ts`), which asks a person to carry a whole deck through a chatbot and back.

## Reproduce

1. `git fetch upstream pull/532/head` and read `git show FETCH_HEAD --stat`: 47 files, +4,203 lines, one commit `b5fca9f`.
2. Try to apply it to `main`: `slides/src/editor/editor.ts`, `slides/src/editor/panels.ts`, `slides/src/styles.css`, the i18n catalogs and `.github/workflows/ci.yml` all conflict.
3. Serve the PR branch itself and open the "Assistant" tab in the right sidebar: with no extension it shows an install card ("Chat with your deck — on your device").

## Evidence

Seen in this audit (PR branch served locally, extension simulated by a script answering the bridge frames):

- Frames in order: `assistant.describe`, `assistant.models`, `assistant.check`, `assistant.turn` (120 B: the request and the focus only), then the extension asks with an `assistant.document` event and the page answers with the material (35,957 B for the 19-slide starter: `outline`, `addressed`, `open`, `size`, `focus`, `theme`).
- An `assistant.done` frame with `ops: { edits, notes, set }` changed the title and the notes in one step. The card read "Applied 3 changes", with Undo, "2 fields dropped, 0 warnings", and two lines of the form `/slides/0/elements/28/bogusKey — unknown key for a text element`. A toast said "Deck updated by the assistant — ⌘Z undoes".
- Sending `done` without the `assistant.document` handshake first gives "The reply changed nothing I could apply": the elision map is built when the material is requested.

Confirmed in code:

- PR side: `slides/src/editor/assistant/{transport,material,ops,panel}.ts`, `slides/src/editor/exthint.ts`; `AssistantPanel.submit`, `.apply` (the `cleanDoc(next, …)` line sits inside `apply(` before `store.replaceDoc(next)`); wiring in its `editor.ts` through `buildPropsTabs()` and `showPropsTab()`, which wrap the sidebar as `ed-props-tabs` / `ed-props-body` / `ed-assist-dock` and construct `new PropsPanel(this.propsBody, …)`.
- `main`: the sidebar is `this.props = div('ed-props')` (`editor.ts:662`) and `new PropsPanel(this.props, this.store)` (`editor.ts:746`); `PropsPanel.mountTabs()` (`panels.ts:224`) renders the Format / Animate / Interact icon tab bar inside that host and switches with `host.dataset.tab`.
- Helpers the PR needs: `parseDocInputReport` (`slides/src/compactload.ts:72`), `sanitizeHtml` (`slides/src/render.ts:400`) and `sanitizeSvgCss` (`kernel/src/svgsafe.ts:412`) exist on main. `sanitizeSvgMarkup` is not exported on main (the PR adds it to `render.ts`), and `mintId` in `slides/src/compact.ts:195` is not exported (the PR's two-line change to `compact.ts` exports it).
- Extension side on main: `home/webext/src/page-bridge.js:149` lists `assistant` among the host's ops; `relay.js` carries turns on the `bento-assistant` port.

Not verified: the PR against a real extension and a real model. The PR's own numbers (224/224 rig checks, +24,537 B) are the maintainer's.

## How others do it

- PowerPoint puts Copilot in a side pane and adds entry points on the ribbon (Review Presentation on the Review tab, Visualize Slide on the Design tab): https://techcommunity.microsoft.com/t5/microsoft-365-blog/what-s-new-in-powerpoint-smarter-faster-ways-to-build-and-edit/ba-p/4469061
- Figma Slides keeps AI on the selection (tone and length, generated notes) rather than in a separate column: https://www.figma.com/blog/how-teams-tap-into-the-power-of-design-with-figma-slides/
- The maintainer already rejected "a third sidebar for the assistant (three columns on a 13" laptop)" in the 2026-09-18 decision entry.

## Proposed change

1. **Bring the four assistant modules, `exthint.ts` and the three rigs across byte for byte.** They are self-contained. Then make the two small supporting changes (`sanitizeSvgMarkup` in `render.ts`, exported `mintId` in `compact.ts`) by hand against current `main`.
2. **Re-home the drawer in the 1.3.0 inspector.** Do not stack a second tab strip above Format / Animate / Interact. Options, in order of preference:
   - (a) A fourth entry in the existing icon tab bar (`PropsPanel.mountTabs`) that hides the inspector sections and shows a full-height dock. One strip, one mental model. `PropsPanel` gains an optional `extraTab` hook so the panel stays ignorant of the Assistant.
   - (b) Pop-out only: a top-bar button and a `⌘K` command open the floating window `AssistantPanel.popOut()` already implements. Cheapest, and it removes the tab CSS, but the window covers the canvas.
   - (c) A dock under the canvas beside the notes pane (`mountNotesPane`, `ed-centre` at `editor.ts:664`). Keeps the inspector visible while chatting; costs vertical space.
   Build (a) and keep the pop-out; record why in `docs/DECISIONS.md`.
3. **Register the entry points as commands** in the command list in `editor.ts` (`open-assistant`, `assistant-pop-out`) so they appear in `⌘K` and the shortcut sheet.
4. **Catalogs.** The PR carries about 47 strings in eight locales, written before the catalogs were re-laid (`scripts/build-i18n.mjs`, `slides/src/i18n/packed.ts`). Re-add each string at the top of each catalog map and rebuild; do not copy the old packed table.
5. **CI.** Register `test-slides-assistant.ts` and `test-slides-exthint.ts` at the end of the slides slice in `.github/actions/validate-slides/action.yml` (the PR registered them in the old single `ci.yml`).
6. **Docs.** Carry the two 2026-09-18 decision entries, and add one `[Unreleased]` changelog block.

Rejected: rewriting the drawer first. Port it as it is so the rig stays meaningful, then change it in AS-02, AS-06 and AS-07.

## Acceptance criteria

- [ ] `slides/src/editor/assistant/` and `exthint.ts` exist on the branch and differ from `b5fca9f` only where 1.3.0 forces it; the diff of those files against the PR is listed in the change description.
- [ ] `node scripts/test-slides-assistant.ts` passes with the PR's check count or higher; `test-slides-exthint.ts` and `test-export-secrets.ts` pass.
- [ ] With no extension, the dock shows the install card, the composer is disabled, and zero `__bento_tray__` frames are posted.
- [ ] With a simulated extension, one edit turn applies as a single undo step and the Format / Animate / Interact tabs still work before and after.
- [ ] Offline mode disables the composer and posts nothing.
- [ ] The right sidebar shows exactly one tab strip.
- [ ] `tsc -b` and `npm run build:single` pass; the shell's size before and after is recorded.
- [ ] All new strings are in all eight catalogs; the literal-key and dead-key gates pass.

## Tests

- Carry `scripts/test-slides-assistant.ts` and `scripts/test-slides-exthint.ts`; register both.
- Add a browser rig `scripts/test-slides-assistant-dock-browser.mjs`: opens the dock from the tab bar and from `⌘K`, runs one simulated turn (describe, check, turn, document handshake, done), asserts the document changed, one undo restores it byte for byte, and the inspector tabs survive.

## Out of scope

Any change to the patch language, the prompt, the transport contract, the model picker or the pop-out (AS-02, AS-03, AS-06, AS-07). The extension side.

## Notes for the implementer

- #532 is the maintainer's open PR. Build the port here; do not propose it upstream without asking first (see the epic's questions).
- The page never holds a key: "not in the document, not in localStorage, not in a module variable". Do not add a key field anywhere to make testing easier; simulate the bridge instead.
- "AI is additive, never load-bearing": the editor must be fully usable with the dock closed and no host present.
- The PR's +24.5 KB against a 15 KB target is why it stalled. Record the size, do not trim here (AS-02).
- `editor.ts` on main is about 5,000 lines and the most contended file in the repo. Keep the wiring to a handful of lines and put everything else in the assistant modules.
- The simulated-bridge recipe used in this audit: define `window.__bentoHost = { name: 'home/webext', ops: ['assistant'] }` before load, answer `dir:'req'` frames on `window` with `dir:'res'`, and for a turn send `evt assistant.document`, wait for the page's `assistant.document` request, then send `evt assistant.done`.

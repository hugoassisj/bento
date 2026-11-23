---
id: AS-06
title: "Actions where you work: selection bar, ⌘K fallthrough, starter prompts"
epic: 4-assistant
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:assistant"]
depends_on: [AS-01, F-05, F-06]
related: [AS-05, AS-07, AS-10]
upstream: ["nyblnet/bento#532"]
---
## Summary

The Assistant on the PR branch is an empty chat box in a sidebar tab. A person has to know it is there, open it, and work out what to type. This issue puts the Assistant where the work already happens: on the text selection, on the selected element, in the command palette, and as suggested first steps in the empty drawer. Each entry point sends an ordinary turn; none adds a second code path.

## What the user experiences

With a host configured, the drawer opens blank: a "Clear" control, an empty transcript, "Ask for a change…", a model name and Send. Nothing suggests what it can do. Selecting a sentence shows the formatting bar (bold, italic, lists) with no way to say "shorten this". Typing "translate this slide" into `⌘K` returns "No matching command".

## Reproduce

1. Run the port (AS-01) with a simulated extension that reports `configured: true`. Open the Assistant.
2. Select a word in a text box: the floating formatting bar appears (`slides/src/editor/richtext.ts`).
3. Press `⌘K`, type "shorten": "No matching command".

## Evidence

Seen in this audit:

- The configured, empty drawer on the PR branch is blank apart from the composer.
- On 1.3.0, `⌘K` with a query that matches no command shows one line, "No matching command"; so do "align" with nothing selected, "distribute", "tidy" and "line up".

Confirmed in code:

- PR branch `panel.ts`: `submit()` reads the textarea, pushes a user turn and calls `transport.turn(request, history, focus, …)`. There is no public way to start a turn from outside the panel, and no suggestion list.
- `slides/src/editor/richtext.ts`: the formatting bar is built in `build()` (line 133, `role="toolbar"` at line 136) and kept in step by `syncFormatBar()` (line 73).
- `slides/src/editor/commands.ts`: the `Command` interface (line 18) has `id`, `label`, `keys`, `match`, `scope`, `when`, `run`; the palette writes "No matching command" at line 158. Commands are declared once in `editor.ts`.
- The turn's focus is the selection (`material.ts`, `Focus { index, selection }`): "the selection is the scope" is already the design.

Not verified: how many of these actions a small on-device model completes well (AS-05).

## How others do it

- Figma Slides: rewrite, tone and length on the selected text; generated presenter notes (https://www.figma.com/blog/how-teams-tap-into-the-power-of-design-with-figma-slides/).
- PowerPoint: named entry points beside the tools they relate to, Review Presentation on the Review tab and Visualize Slide on the Design tab (https://techcommunity.microsoft.com/t5/microsoft-365-blog/what-s-new-in-powerpoint-smarter-faster-ways-to-build-and-edit/ba-p/4469061).
- Keynote 15.3: one button that writes presenter notes from the slide (https://support.apple.com/en-lb/guide/keynote-iphone/tan700f60676/ios).

## Proposed change

**1. One entry function.** `AssistantPanel.ask(request: string, opts?: { focus?: Focus; label?: string })`: opens the dock if closed, shows the request as the user's turn (using `label` when the literal request is long), and runs it exactly as `submit()` does. Every surface below calls it. If no host is present, it opens the dock on the install card and sends nothing.

**2. Text selection.** One "Ask" control at the end of the formatting bar. It opens a short menu: Shorten, Make it clearer, Fix spelling and grammar, Translate…, and a one-line field for anything else. Each item is a fixed English request plus the selected text's address; the reply is an `edits` op, reviewed as in AS-07. The control exists only when a host reports `configured`.

**3. Element and slide.** In the context menu (`slides/src/editor/ctxmenu.ts`) an "Ask the assistant" submenu, by selection type:

- text box: the four above;
- picture or chart: Describe for screen readers (writes `alt`);
- several elements: Tidy this up (only once AI-09 and DS-10 give a deterministic tidy to fall back on);
- nothing selected: Write speaker notes for this slide, Suggest a title, Check this slide.

**4. Command palette.** Register the same actions as commands with `when: () => assistantReady()`, so they appear in `⌘K` and obey F-06's rule for unavailable commands (shown greyed with the reason "Needs a model: open the Assistant"). When a query matches no command and a host is ready, the empty state becomes one selectable row: "Ask the assistant: ‘<query>’", which calls `ask(query)`. With no host the row is not shown and F-06's message stands.

**5. Starter prompts.** The empty transcript shows up to four suggestions derived from the document, not a fixed list: the selection's type decides the first two; then "Write notes for slide N" when notes are empty; then "Check this deck" when the validator has findings (F-10). Clicking one calls `ask`. They disappear after the first turn.

**6. Strings.** About a dozen new strings. Keep the requests sent to the model in English in code (they are prompts, not UI); only the labels go through `t()`.

Rejected: a separate "AI" toolbar or ribbon; inline ghost text in text boxes (it would need a streaming path into the editable and its own undo handling).

## Acceptance criteria

- [ ] `AssistantPanel.ask()` exists and `submit()` is implemented through it; one code path runs a turn.
- [ ] With a host ready, the formatting bar shows the Ask control; choosing Shorten sends a turn whose focus is the selected element and whose reply changes only that element.
- [ ] The context menu shows the submenu items appropriate to the selection type, and none when no host is ready.
- [ ] `⌘K` lists the actions; an unmatched query offers "Ask the assistant: ‘…’" when a host is ready and does not when none is.
- [ ] The empty drawer shows suggestions that differ between a text selection, a picture selection and no selection; they vanish after the first turn.
- [ ] With no host, none of the new controls is rendered and zero frames are posted.
- [ ] Offline mode hides or disables every entry point.
- [ ] Every label is in all eight catalogs; the literal-key and dead-key gates pass.
- [ ] The byte cost is recorded.

## Tests

- Extend `scripts/test-slides-assistant.ts`: `ask()` with and without a host; the focus sent for each surface; the palette fallthrough row.
- Add `scripts/test-slides-assistant-entry-browser.mjs`: selection bar, context menu and palette each start one turn against a simulated bridge; real mouse events for the canvas (synthetic pointer events do not drive it).
- Extend the existing command-palette browser rig (listed under `slides-editor-browser` in `.github/workflows/ci-slides.yml`) with the fallthrough case.

## Out of scope

New model capabilities (AS-10). The preview and accept flow (AS-07). Voice input. Any action that edits theme, tokens or components.

## Notes for the implementer

- The drawer is the maintainer's unmerged work (#532). The entry points are additive, but they change its surface; expect the maintainer to have opinions, and ask before proposing upstream.
- Depends on F-05 (slide and list actions as commands) and F-06 (the palette shows unavailable commands with a reason). Without F-06 the palette would hide these commands whenever no host is present, which is the dead end this issue is meant to remove.
- "AI is additive, never load-bearing": every one of these controls must be absent, not broken, when there is no model. A user who never configures a host should not see the word "assistant" outside the install card.
- The page never holds a key; nothing here touches the transport.
- The fixed requests must respect `issues/00-READ-FIRST.md` §6: none of them may ask the model to restyle. "Tidy this up" in particular must not invent colours or fonts.
- The +24.5 KB against 15 KB budget applies; this issue adds UI, so measure it against AS-02's baseline.

---
id: AS-10
title: "Assistant tasks: outline to deck, speaker notes, translate as a copy, alt text"
epic: 4-assistant
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:assistant"]
depends_on: [AS-03]
related: [AS-06, AS-07, AS-09, AI-09, AI-08]
upstream: ["nyblnet/bento#532"]
---
## Summary

Four whole-deck jobs people actually ask a model for, built as guided tasks on top of the patch language instead of free-form chat: turn an outline or pasted notes into slides, write speaker notes for every slide, translate the deck as a separate copy, and describe every picture and chart for screen readers. Each is a sequence of ordinary turns driven by the page, with progress, a stop button and one review.

## What the user experiences

On the PR branch all of these are "type it and hope". A request for notes on all 19 slides is one turn that must fit one reply. "Translate this deck" rewrites the only copy. Pasting three paragraphs and asking for slides gives whatever the model decides `add` should mean. There is no progress, and a long reply that is cut off applies partially or not at all.

## Reproduce

1. Run the port (AS-01) with a simulated extension; read `home/webext/src/prompt.js` `OPS_PROMPT` (line 76) for what one reply may contain.
2. Read `ADD_MAX`, `TEXT_EDIT_MAX`, `SET_MAX`, `INSERT_MAX` in `slides/src/editor/assistant/ops.ts` on the PR branch.

## Evidence

Nothing in this issue was run against a model. It rests on code and on the trial's measurements.

Confirmed in code:

- PR branch `ops.ts`: `notes: [{slide, text}]`, `edits: [{id, text}]`, `cells`, `add: [{after, layout, title?, …, notes?, elements?}]`, `set: [{id, …fields}]`; limits `ADD_MAX = 20` slides, `TEXT_EDIT_MAX = 20000` characters, `SET_MAX = 200`, `INSERT_MAX = 40` per reply. `LAYOUTS` is the nine built-ins.
- PR branch `material.ts`: `outlineDeck()` gives every text, table cell and chart with its address; the 2026-09-18 decision entry measured the outline at "a few KB" and the starter deck at 22k tokens when sent whole.
- The turn is sized to the model's window by the extension (`windowFor` in `home/webext/src/assistant.js`, line 541); when the outline does not fit, the turn is refused "with the numbers".
- Main: `alt?: string` on every element (`slides/src/model.ts:191`), drawn as `role="img"` with an `aria-label`; the starter deck has 61 visuals and no alt text on any of them. "Duplicate as new deck…" exists in the Save menu (`slides/src/editor/editor.ts:1165`).
- `home/webext/src/providers.js` has no image input, so a model cannot see a picture today (AS-09 part B).

From the trial: layout-by-role produced slides with no coordinates but ignored the deck's theme, and an unknown role silently deleted a column (AI-09). An outline-to-deck task inherits both until AI-09 and F-01 land.

## How others do it

- PowerPoint Copilot creates a deck from a prompt or a file, and summarises and organises an existing one (https://techcommunity.microsoft.com/t5/microsoft-365-blog/what-s-new-in-powerpoint-smarter-faster-ways-to-build-and-edit/ba-p/4469061).
- Keynote 15.3 generates presenter notes from slide content (https://support.apple.com/en-lb/guide/keynote-iphone/tan700f60676/ios); Figma Slides adds presenter notes and adjusts tone (https://www.figma.com/blog/how-teams-tap-into-the-power-of-design-with-figma-slides/).
- Penpot's MCP server exports and creates from real layouts and tokens rather than free generation (https://community.penpot.app/t/penpot-2-15-master-of-puppets/10529).

## Proposed change

**A task runner on the page.** `runTask(steps)`: each step is one `AssistantPanel.ask()`-style turn with a page-written request and an explicit focus; results are collected as proposals (AS-07), not committed. The drawer shows "Notes: slide 7 of 19", a Stop button, and at the end one review with everything, accepted per slide. Committing the accepted set is one `replaceDoc`, so one undo. Stop keeps what has arrived. A failed step is listed and skipped, never fatal. The requests are English prompts in code; only labels are translated.

**1. Outline to deck.** A dialog with a text area ("Paste an outline, notes or a document") and two choices: add after the current slide, or start a new deck. Steps:

- one question turn that returns a slide plan as a numbered list (title and one line each), shown to the user to edit before anything is built;
- then `add` turns in batches under `ADD_MAX`, each naming a layout from the deck's own layouts first, the built-ins second (AS-03, AI-09).
The plan step is what makes this controllable: the user approves ten titles before ten slides exist.

**2. Speaker notes for every slide.** Batches of slides sized to the window; each reply is `notes` ops only. A choice up front: fill empty notes only (default), or rewrite all. Existing notes are never overwritten in the default mode; a rig asserts it.

**3. Translate as a copy.** Never in place. The task duplicates the deck first (the same operation as "Duplicate as new deck…", giving the copy its own identity) or, if the user prefers, writes into a downloaded copy, then translates slide by slide: `edits`, `cells` and `notes` only, addressed by the outline. Fields such as `{{page}}`, code blocks and maths are sent as-is with an instruction to leave them. Element geometry is untouched; overflow caused by longer text is reported by the checker in the final review (F-10), with "Shrink to fit" offered.

**4. Alt text.** Two tiers:

- charts, tables and shapes with text: described from their data and labels, text-only, any model. `set` with `alt`.
- pictures: need AS-09 part B (the model must see them). Until then the task lists the pictures and focuses the Accessibility field for each, so the user can write them by hand.
Never overwrite an existing `alt`.

**Entry points.** Four commands in `⌘K` and the Assistant's starter prompts (AS-06), each greyed with a reason when no host is ready (F-06).

## Acceptance criteria

- [ ] `runTask` runs N page-driven turns, shows per-step progress, and stops on request leaving the store untouched until review.
- [ ] Outline to deck shows an editable plan before any `add` turn is sent; the slides created match the approved plan's count and order.
- [ ] Created slides use a deck layout when one fits, and no created element carries a literal colour or font where the deck has a slot or token (asserted on a tokenised fixture).
- [ ] Speaker notes in the default mode changes only slides whose notes were empty; a rig compares every other slide's notes byte for byte.
- [ ] Translate never modifies the open document: the rig asserts the original serializes identically before and after, and the copy has a different `docId`.
- [ ] Translate leaves fields, code elements and maths delimiters unchanged in the copy.
- [ ] Alt text is written only where `alt` was absent; with a text-only model, pictures are listed and not described.
- [ ] Committing a finished task is one undo step.
- [ ] A step that fails or is refused for size is listed with its reason and the task continues.
- [ ] Strings in all eight catalogs; byte cost recorded.

## Tests

- Extend `scripts/test-slides-assistant.ts` with fixture replies per task: batch boundaries at `ADD_MAX`, the empty-notes rule, the never-overwrite-alt rule, the translate-copy identity rule, a mid-task failure, Stop.
- Add `scripts/test-slides-assistant-tasks-browser.mjs`: the plan dialog, progress text, final review, one undo.
- Fixture decks: the tokenised brand deck shared with AS-03 and AI-17, and a deck with fields, code and maths.

## Out of scope

Generating pictures. Summarising a deck into a document. Translating in place. Importing files other than pasted text (PowerPoint import is `convert/`, a separate tool by decision). Scheduling or background runs.

## Notes for the implementer

- Everything here sits on the maintainer's unmerged drawer and sends many turns through their bridge. Ask before proposing upstream; the page-driven design was chosen so that no bridge op and no extension code changes.
- Depends on AS-03: without design-system awareness, outline-to-deck produces off-brand slides at scale, which is worse than producing none.
- "AI is additive, never load-bearing": each task must be absent, not broken, with no host. Alt text's hand-written path is the no-model version of that task.
- The page never holds a key. Many turns means many consent-checked requests through the host, nothing more.
- Token cost is real and the user pays it. Say how many requests a task will make before it starts ("About 5 requests").
- Design-system rule (`issues/00-READ-FIRST.md` §6): translation changes words only; notes change notes only; none of these tasks may restyle.
- Size: the runner and four dialogs add to a feature already at +24.5 KB against a 15 KB target. Measure against AS-02 and consider shipping the runner with one task first (speaker notes is the smallest and the most asked for).
- Offline mode disables all four.

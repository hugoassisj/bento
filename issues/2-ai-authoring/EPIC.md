---
id: EPIC-2
title: "Epic 2 · AI authoring that works"
labels: [epic]
---
# Epic 2 · AI authoring that works

## Goal

An AI agent, or a person pasting between a chatbot and Bento, can create and edit a deck that looks designed, checks clean, and stays inside the deck's own design system, without guessing, without hand-computed coordinates, and without rewriting the whole document.

Read [`../00-READ-FIRST.md`](../00-READ-FIRST.md) first. Rule 6 there ("the deck's own design system wins") governs every issue in this epic.

## Why it matters: what the trial measured

During the audit an agent was given exactly what an outside agent gets, the one-file skill and the published guide, and asked for a 7-slide investor update, then for an edit of the starter deck.

| Measure | Result |
|---|---|
| Hand-estimated coordinates for seven slides | about 400 |
| Guesses at field values | 17 |
| Token-bound style values written / literals | 0 / 444 (the starter deck binds 48% of its own) |
| First-pass warnings that were false | 6 of 13 |
| Visible defects the checker flagged | none (clipped chart labels, half-empty cards) |
| Runs of the repo's render tool that worked | 0 of 4 |
| Bytes rewritten for a 1.5 KB change to the starter | 186 KB |
| Stale colours left after changing the accent | 50, and it validated clean |
| Realistic chatbot replies that produced a wordless red border | 6 of 10 |
| Self-rated quality against the starter | about 6 against 9 |

## Children, in recommended order

Wave 1, independent and small; unblock everything else:

- [ ] **AI-03** Correct the wrong and missing statements in today's agent docs (interim patch). Stops the bleeding: fonts, menu path, required fields, tags, line endings.
- [ ] **AI-05** `scripts/bento-check.mjs` fails to produce a report. Reproduce, make failures legible, make cleanup unable to fail.
- [ ] **AI-11** `loadDoc` report computes findings before the layout pass. The report said 0 warnings when 29 were real.
- [ ] **AI-09** (part 1) Layout and role: an unknown role never drops content. A silent loss of the author's text.

Wave 2, the tools:

- [ ] **AI-06** `window.bento.render()`: a public slide rasteriser. Lets any browser-capable harness see a slide.
- [ ] **AI-07** `window.bento.outline()`, `patch(ops)`, `stats()`: targeted edits for slides. Ports the patch language from upstream PR #532.
- [ ] **AI-12** Report silent binding losses; add a stale-token finding. Token mismatch, unknown token, copy without signature, dangling parent.
- [ ] **AI-08** Compact input speaks the design system: token and slot names as values, `use`, `like`, theme defaults. Makes reuse the shortest path.
- [ ] **AI-10** Frames for agents: fit text after layout, fix stretch with hug, equal-height rows.
- [ ] **AI-09** (part 2) Stats, timeline, big-number and chart layouts.
- [ ] **AI-13** Change the accent as one operation; no stale bound values on disk.

Wave 3, the package:

- [ ] **AI-02** Generated agent reference; rebuild the published guide from it; docs-drift test.
- [ ] **AI-04** `bento` agent CLI: new, extract, inspect, lint, render, apply.
- [ ] **AI-01** Skill package rebuild: structure, precedence protocol, workflow, gotchas.
- [ ] **AI-16** Design-system-wins guard: protected-by-default patch; `unbound-literal` and `off-system` findings.
- [ ] **AI-17** Eval suite for the skill: baseline, brand-preservation cases, trigger set.

Wave 4, the chatbot path and reach:

- [ ] **AI-14** Replace from JSON that survives a chatbot: fences, trailing commas, truncation, summary before applying.
- [ ] **AI-15** Copy prompt for a chatbot: outline plus patch instructions, reply applied as a patch.
- [ ] **AI-18** Tool server exposing outline, read slide, inspect, patch, validate, render.

## Dependencies

- AI-15 needs AI-07 (patch) and AI-14 (a dialog that accepts a patch).
- AI-16 needs AI-07 (there must be a patch to protect) and AI-12 (the binding findings).
- AI-17 needs AI-01 and AI-04 to have something to evaluate; write its fixtures early, they are shared with AI-04.
- AI-18 needs AI-06 and AI-07.
- AI-04's `render` gets simpler after AI-06; its `lint` wording comes from AI-02's generated table.
- AI-01 can land before AI-02 and AI-04 if it degrades honestly: it names the references and scripts that exist.
- Outside this epic: **F-01** (layouts follow the theme) is what makes layout-by-role output on-brand; **F-07**, **F-08**, **F-09** (validator) are what make the checker trustworthy; **F-11** (an unreadable document block opens the starter) is the file-harness data-loss case; **SC-01** and **SC-04** make the starter a clean reference deck; **AS-01** and **AS-03** are the in-editor Assistant that runs on AI-07.

## Every trial failure, and the issues that fix it

| # | What went wrong | Fixed by |
|---|---|---|
| 1 | About 400 hand-placed coordinates | AI-02, AI-09, AI-10, AI-01 |
| 2 | 17 guesses at field values | AI-02, AI-03 |
| 3 | 0 bound values, 444 literals | AI-01, AI-08, AI-16 |
| 4 | Layouts ignore the theme; an unknown role deleted a column | F-01, AI-09 |
| 5 | Frames: text height measured before layout; stretch with hug collapses cards; no equal heights | AI-10 |
| 6 | Load report said 0 warnings while the real count was 29 | AI-11 |
| 7 | 6 of 13 warnings false; every visible defect unflagged | F-07, F-08, F-09 |
| 8 | The agent could not look: render tool failed, skill never mentions it | AI-05, AI-06, AI-04, AI-01 |
| 9 | 186 KB rewritten for a 1.5 KB change | AI-07, AI-04 |
| 10 | Accent change left 50 stale colours and validated clean | AI-13, AI-12 |
| 11 | Silent traps: token literal mismatch, copy without signature, frame order, dangling parent | AI-12, AI-08, AI-01 |
| 12 | Compact form or a trailing comma in the file opens the demo deck | F-11 |
| 13 | Chatbot paste: wordless red border; half a deck vanished silently | AI-14, AI-15 |
| 14 | Wrong instructions: menu path, fonts, "theme is required", undocumented show options | AI-03, AI-02 |
| 15 | No way to tell whether the skill helps | AI-17 |

## The precedence protocol

Every tool and every line of guidance in this epic follows this order. Lower levels only fill gaps left by higher ones.

1. What the user said in this conversation.
2. What the deck or brand already defines: `theme` slots, `theme.tokens` and modes, component mains, `doc.layouts`, `doc.fonts`.
3. What the deck already does, by usage: its recurring colours, sizes and margins.
4. The skill's defaults.

Detection, before any edit: read `theme`; `theme.tokens`; the share of style values bound through `themeRefs`; components; `doc.layouts`; fonts; a usage histogram. A design system exists if any of the first six is non-empty or the histogram is tight.

When a system exists:

- Colour, size, spacing and font come from an existing token or slot, written as literal plus `themeRefs` with the literal equal to the token's value.
- Repeated blocks are copies of an existing main; new slides use the deck's own layouts.
- A new value is added only when nothing fits; it becomes a new token, never an edit to an existing one, and the hand-off names it.
- Without an explicit request: no change to theme, token values, modes, palette slots, fonts, component mains or layouts; no detaching copies; no restyling of slides that were not asked about; no "fixing" contrast or density inside the user's system. Report the issue instead.

## Definition of done for the epic

- [ ] Re-running the trial with the new skill produces a first-pass deck with zero hand-estimated coordinates outside explicit design choices, zero false warnings, and no visible defect the checker missed.
- [ ] Editing a tokenised brand deck leaves an empty design-system diff unless the request names a change, and every new style value is bound.
- [ ] A one-line edit to the starter deck is a patch under 2 KB, applied as one undoable step.
- [ ] An agent with only the skill folder and Node can extract, inspect, lint and apply; with Chrome it can render.
- [ ] No instruction in the skill requires the network.
- [ ] The eval suite shows a measured improvement over the no-skill baseline and passes its brand-preservation cases.
- [ ] Every statement in the agent docs is either generated from the code or held by a test.

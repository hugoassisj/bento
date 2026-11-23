---
id: AI-17
title: "Eval suite for the skill: baseline, brand-preservation cases, trigger set"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: code
labels: [enhancement, "priority:P1", "size:M", "evidence:code", "area:skill"]
depends_on: [AI-01, AI-04]
related: [AI-02, AI-16, SC-04]
upstream: []
---
## Summary

There is no way to tell whether the Bento skill helps an agent, hurts it, or changes nothing. The plugin is two files and has no evals. Add an evaluation suite that runs each scenario with and without the skill, checks most outcomes automatically with the agent CLI, and includes scenarios that fail if a deck's brand, tokens or components are touched.

## What the user experiences

A maintainer edits `SKILL.md` and cannot know if agent-made decks got better. A contributor adds a paragraph of design advice that makes agents restyle existing decks, and nothing catches it. The audit had to run a manual trial to learn that the current guidance produces 0 token-bound values and that the render-and-check tool is never mentioned.

## Reproduce

`find plugins -type f` lists `plugins/bento-slides/.claude-plugin/plugin.json` and `plugins/bento-slides/skills/bento-slides/SKILL.md` (plus `.claude-plugin/marketplace.json` at the repo root). There is no `evals/` folder, no fixture decks for the skill, and no CI step that exercises the skill.

## Evidence

Observed during the audit: the manual trial (7-slide deck from a brief, an edit of the starter, a rebuild with frames and tokens) and its numbers; see AI-01 and the epic file.

Confirmed in code now: the plugin's file list above; `scripts/fixtures/agent-decks/` holds four compact decks (`layouts-and-roles.json`, `markdown-auto-height.json`, `three-cards.json`, `title-and-bullets.json`) used by `scripts/test-slides-agent-decks.ts`, which tests the loader, not agent behaviour.

Still unverified (from the research pass, not from running it here): the exact case-folder format `claude plugin eval` reads, and that Anthropic's `skill-creator` writes the same format. The research found the two documented as different in one place and compatible in another. Confirm against https://code.claude.com/docs/en/plugin-evals before writing the first case.

## How others do it

Anthropic's skill-authoring guidance: build evals first; at least three scenarios; compare against a no-skill baseline; run each case several times; test on the smallest and largest models you support; keep a set of about twenty trigger queries to check the description fires when it should and not otherwise (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices). Published slide-agent work the research found reports large drops without a rendered view or a schema (https://arxiv.org/html/2501.03936v3) and that geometric checks catch what image-reading evaluators miss (https://arxiv.org/abs/2604.22840); the numbers were read from summaries, not the papers.

## Proposed change

Add `plugins/bento-slides/evals/`, one folder per case, each with a prompt, a fixture set-up script, and graders. Automatic graders call the agent CLI from AI-04 (`lint`, `lint --base`, `render`) and read the resulting file; "look" graders are a short rubric for a model or a person.

Fixtures (new, under `plugins/bento-slides/evals/fixtures/`): a tokenised brand deck with light and dark modes, components and its own layouts; a deck with deliberate off-default choices (three accents, a serif, tight margins); a deck with five overflowing text boxes; a shared deck carrying `collab` keys (test keys, never real ones).

Cases:

1. Fresh deck from a one-page memo. Auto: skill was used; lint and render pass; a chart exists for the numeric section; no text overflow. Look: hierarchy and variety.
2. Add three slides to the brand deck. Auto: design-system diff is empty; every new colour and size is bound; new slides use the deck's own layouts; switching mode re-renders clean.
3. "Make slide 4 better" on the off-default deck. Auto: only slide 4 changed; `theme` is byte-identical.
4. Explicit override, "change our accent to #0A7". Auto: the slot changed; bindings intact; no literal rewritten elsewhere (AI-13).
5. Change one component copy's label. Auto: the main is untouched; `sig` present; `over` lists only that key.
6. Swap two cards in an auto-layout row. Auto: order by coordinate matches the request; frame geometry valid.
7. Shared deck. Auto: the transcript never contains a key value; `collab` and `docId` are byte-identical.
8. Overflow repair. Auto: zero overflow findings; no font size below the deck's body size.
9. No network. Auto: no fetch or curl call; the deck boots.
10. Trigger set: twenty queries, including near misses such as ".pptx file" and "Google Slides".

Each case runs three times with the skill and three without; the report is the delta. Add a short `plugins/bento-slides/evals/README.md` on how to run it and how to read the numbers.

CI: do not run model calls in the required checks. Add a node rig that validates the eval folder's structure and that every fixture loads clean, so the suite cannot rot silently.

## Acceptance criteria

- [ ] Ten case folders exist and each has a prompt, a set-up script and at least one automatic grader.
- [ ] Every fixture deck loads through the gate with zero drops and zero errors.
- [ ] Cases 2, 3, 5 and 7 fail when run against a deliberately bad edit (a restyled theme, a detached copy, a leaked key); the PR shows the failing output.
- [ ] A baseline run without the skill is recorded in the PR next to a run with it, three repetitions each.
- [ ] The test key material in the shared-deck fixture is marked as a fixture and matches nothing real.
- [ ] `scripts/test-slides-skill-evals.ts` passes and is registered in CI.

## Tests

`scripts/test-slides-skill-evals.ts` (node): walks `plugins/bento-slides/evals/`, checks each case's required files, loads each fixture with the same loader `test-slides-agent-decks.ts` uses, and runs each automatic grader against a known-good and a known-bad sample output. Register at the end of the slides slice in `.github/actions/validate-slides/action.yml`.

## Out of scope

- Rewriting the skill (AI-01) and the CLI (AI-04); this depends on both.
- Evaluating the in-editor Assistant (epic 4), which needs its own harness.

## Notes for the implementer

Docs and plugin zone plus one rig. The release script zips the skill for claude.ai (`scripts/release.mjs`); make sure `evals/` is not shipped inside the skill folder that gets zipped. Fixtures add repository bytes, not shell bytes. Keep prompts free of any real company or person.

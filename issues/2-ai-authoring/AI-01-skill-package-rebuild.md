---
id: AI-01
title: "Skill package rebuild: structure, precedence protocol, workflow, gotchas"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:skill"]
depends_on: []
related: [AI-02, AI-03, AI-04, AI-08, AI-12, AI-16, AI-17, F-01]
upstream: []
---
## Summary

The Claude Code skill for Bento Slides is one 141-line `SKILL.md` with no bundled reference, script, template or example. It tells the agent to fetch its real instructions from the network, has no verification step an unattended agent can run, and its design rules are unconditional, so an agent applies them to a deck that already has its own design system. Rebuild it as a package that meets the current skill-authoring standard and makes one rule checkable: **the deck's own design system wins**.

## What the user experiences

In the audit's agent trial (an agent given only the skill and `docs/agents.md`, asked for a 7-slide investor update):

- 17 guesses at field values; about 400 hand-estimated coordinates.
- Output: **0 token-bound style values, 444 literals**. The Showcase deck binds 48% of its own style values.
- No way to render: the skill says "open it and look at every slide", which a headless agent cannot do.
- Editing the Showcase deck, the agent wrote literal colours and fonts into a deck whose every colour is bound to a token, because nothing told it bindings exist.

## Reproduce

1. Give an agent only `plugins/bento-slides/skills/bento-slides/SKILL.md`.
2. Ask: "add a two-column slide after slide 4 of this deck" on a file saved from the 1.3.0 starter.
3. Inspect the new elements: no `themeRefs`, literal `color` and `fontFamily`, hand-picked `x/y/w/h`.

## Evidence

Confirmed in the file at `29b5c80` (`plugins/bento-slides/skills/bento-slides/SKILL.md`):

- The package is three files: `SKILL.md`, `plugins/bento-slides/.claude-plugin/plugin.json` (version 1.0.6), `.claude-plugin/marketplace.json`.
- Network dependency: lines 50–52 and 106–108 ("Fetch https://bento.page/agents.md BEFORE authoring").
- Wrong menu path: lines 26–27 say *Save ▾ → Copy document JSON*; the commands are in the File menu on the wordmark, under the "Advanced" caption (`slides/src/editor/editor.ts:1234-1241`).
- "`size` and `theme` … are **required**" (lines 51–52). The trial opened a file with no `theme` without error. Unverified here; see AI-03.
- "Fully specify element fields … text needs `fontFamily`/`align`/`valign`" (lines 53–55): this forces a literal font stack onto every text element.
- Unconditional design rules: "reach for it liberally" (line 93), "every cover / divider → at least one ambient motion" (line 100), "Respect one accent colour, ≤2 typefaces, 96px side margins" (lines 108–109, repeated in the self-audit at line 116).
- "Images/fonts must be embedded" (lines 129–130) ignores the built-in faces (`slides/src/fonts.ts:25-26`).
- No occurrence of `themeRefs`, `component`, `compact`, `md`, `bento check`, `validate` or `measure` anywhere in the file (grep).
- `scripts/release.mjs:464` zips only `bento-slides/SKILL.md` for claude.ai, so a multi-file skill would ship incomplete.

From the audit (not re-run): the trial numbers above; the research pass's 15-rule checklist.

## How others do it

- Anthropic's skill guidance: name ≤ 64 chars matching the directory, description ≤ 1,024 chars in the third person stating what and when; body under 500 lines; references one level deep, each with a "read when" trigger; gotchas in the main file; fragile steps as scripts; evals first (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices, https://agentskills.io/specification).
- Claude Code truncates description plus `when_to_use` at 1,536 chars and re-attaches only the first 5,000 tokens of a skill after compaction, so the rules that must survive go first (https://code.claude.com/docs/en/skills).
- No runtime network: the API surface has none (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview).
- Figma's agent skills: "Your code should match what's already there, not impose new conventions"; "Always search before building" (https://github.com/figma/mcp-server-guide, `skills/figma-use`, `figma-generate-design`).
- Anthropic's own presentation skill scopes its design advice to decks the agent creates and tells it to match an existing deck's sizes; it makes render-and-look QA mandatory.

## Proposed change

New layout under `plugins/bento-slides/skills/bento-slides/`:

```
SKILL.md                       ~280 lines, in this order
references/design-system.md    tokens, modes, themeRefs, palette slots, components (main/copy/sig/over), frames, fonts
references/design-defaults.md  "Defaults for when the deck doesn't decide"
references/motion.md           morph, builds (fx.step), entrances, loops, states, hover
references/data.md             charts, tables, code, maths, media
references/editing.md          editing an existing deck: collab, assets line, ids, patching
references/format.md           GENERATED (AI-02)
references/compact.md          GENERATED (AI-02)
references/verify.md           GENERATED (AI-02)
scripts/                       AI-04
assets/                        the app file, schema, example decks (AI-04, AI-17)
```

`SKILL.md` order (the first 5,000 tokens must hold 1–3):

1. **File contract**: the `#bento-doc` block, `<` escaping, `collab` handled by name only, the assets-last line, never regenerate `docId`.
2. **Precedence protocol**: what the user said; then what the deck defines; then what the deck already does; then the skill's defaults. Detection order: `theme` → `theme.tokens` (set, modes) → share of values bound through `themeRefs` → component mains and copies → `doc.layouts` → `doc.fonts`. "A system exists if any of these is non-empty."
3. **Workflow**: inspect → plan → author (compact form, layout plus role or frames, never coordinates when a layout fits) → lint → render → look → apply. Until AI-04 lands, the verify step uses `window.bento.validate()` wherever the agent has a browser and says plainly when it has none.
4. **Material-to-feature map** (kept from today's file, with "liberally" and "every cover" removed).
5. **Gotchas**: a token-bound literal that differs from its token loses the binding; a component copy without `sig` turns every difference into an override; frame children order by coordinate then array order; a dangling `parentId` is removed silently; chart series data must be plain numbers.
6. **Reference index** with a "read this when…" line for each file.

Rewrite every design rule as a default: "If the deck has no X, a good default is Y, because Z." `design-defaults.md` opens with "These never override the deck's own choices or the user's words."

When a system exists, the skill states: write literal and `themeRefs` together with the literal equal to the token's value; a new value is a new token named in the hand-off, never an edit to an existing one; do not change theme, tokens, modes, slots, fonts, mains or layouts unless asked; do not "fix" contrast or density inside the user's system, report it.

Update `scripts/release.mjs` so the claude.ai zip contains the whole skill folder; bump `plugin.json`.

## Acceptance criteria

- [ ] `SKILL.md` body is under 500 lines and its first 5,000 tokens contain the file contract, the precedence protocol and the workflow.
- [ ] Front matter: `name` equals the directory, description ≤ 1,024 characters, third person, names the triggers (`.bento.html`, deck, slides, presentation).
- [ ] No instruction requires a network fetch to author or edit a deck.
- [ ] Every design rule is phrased as a default with a reason; none uses "always", "never" or capitals for emphasis outside the file contract.
- [ ] The five gotchas are in `SKILL.md`, not in a reference.
- [ ] Each reference is linked from `SKILL.md` with a "read when" line; no reference links to another reference.
- [ ] The menu path, built-in fonts and "required" statements match the app (AI-03).
- [ ] The published zip contains every file of the skill folder.

## Tests

Add `scripts/test-skill-package.ts` (node), registered at the end of the slides slice in `.github/actions/validate-slides/action.yml`. It asserts: front-matter limits; body line count; no `curl`, `fetch`, `https://bento.page/agents.md` instruction in `SKILL.md`; every file named in the reference index exists; every relative link resolves; the five gotcha phrases are present; `plugin.json` version changed when `SKILL.md` changed is NOT asserted (manual). The behavioural proof is AI-17's eval suite.

## Out of scope

The generated references (AI-02), the script (AI-04), compact-input changes (AI-08), the evals (AI-17), a tool server (AI-18).

## Notes for the implementer

- Docs and plugin only: no shell bytes.
- `scripts/release.mjs` is the maintainer's ops zone upstream; keep that edit to the single zip line and call it out.
- `docs/DECISIONS.md` (line 2842, "Agents get tools to measure and check, not a layout engine") predates frames and compact `h:"auto"`; the skill should steer agents to layout-plus-role and frames, and say so.
- Do not copy Anthropic's presentation skill's palette tables: prescriptive palettes are exactly what the precedence protocol forbids.

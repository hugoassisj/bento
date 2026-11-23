---
id: AI-02
title: "Generated agent reference; rebuild the published guide from it; docs-drift test"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:skill"]
depends_on: []
related: [AI-01, AI-03, AI-09, AI-12]
upstream: []
---
## Summary

The agent-facing documentation is hand-written and has drifted from the app. The published guide (`docs/agents.md`, served at bento.page/agents.md) has no usable coverage of auto-layout frames, tokens, components, paint stacks, click builds or the compact form, while the contributor file `AGENTS.md` documents the compact form the published guide omits. Generate the reference parts from the code, assemble the published guide from the same source the skill bundles, and add a test that fails when they drift.

## What the user experiences

An agent reading the published guide made 17 guesses at field values in the audit's trial (`valign` and `fx.enter` values, line thickness, `countUp` with a currency string, bullets in `html`, chart colours on dark, how to render headlessly). It never learned that layout-by-role, `md` text, `h:"auto"`, tokens or components exist, and hand-placed about 400 coordinates.

## Reproduce

```
grep -c '"compact": true' docs/agents.md     # 0
grep -c 'themeRefs' docs/agents.md            # 0
grep -c 'fx.step\|"step"' docs/agents.md      # 0
grep -n 'compact input form' site-src/llms.txt # line 7 claims agents.md has it
```

## Evidence

Confirmed at `29b5c80`:

- `docs/agents.md` (515 lines) contains no `"compact": true`, `themeRefs`, `"md"`, `h:"auto"`, `fx.step`, `bento check` or schema URL (grep, zero hits each). Frames get one clause pointing to `format.md` (lines 320–321).
- `AGENTS.md:93-184` documents the compact form, `md`, `h:"auto"`, layout plus role and the load report; `AGENTS.md:199` documents `bento check`; `AGENTS.md:220` the schema. None of it is published.
- `site-src/llms.txt:7` says the guide includes "the compact input form (omit defaults, they are filled on load)".
- What is already generated and gated in CI: `slides/src/modelkeys.generated.ts` from `scripts/build-modelkeys.mjs` (`.github/actions/validate-slides/action.yml:197`), `schema/slides.json` from `slides/src/schema.ts` via `scripts/build-schema.mjs` (`action.yml:205`).
- `scripts/test-slides-compact-layouts.ts:139-147` already pins a layout-and-role table, but only inside `AGENTS.md`.
- `scripts/release.mjs:191-201,454` publishes `docs/agents.md` to `/slides/agents.md` and `/agents.md`.
- `docs/format.md:3-4` says "current as of bento/slides v1.0.6"; line 146–147 lists seven element types and omits `code` and `embed`; line 64 lists three `present` keys where `slides/src/model.ts` has six.

From the first code audit (spot-checked, not exhaustively re-verified): fields absent from the published guide include the `code` and `embed` element types; `fx.step`, `fx.enterDur`, `fx.typeWriter`; slide `unnumbered`, `hover`, `themeRefs`; `showOnHover`; `tokens`, `component`, `layout`/`sizing`; `fills`/`strokes`, `blend`, `strokeGradient`, `colorGradient`, `textStroke`, `blur`, `backdropFilter`, `bool`, `crop`, `locked`, `groupId`; `present.morphSeconds`, `typeWriterSeconds`; `builtin:` fonts; maths `$…$`; eight of eleven line endings.

## How others do it

- Anthropic's guidance asks for references one level deep with a table of contents past 100 lines, and for no time-sensitive or duplicated information (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
- shadcn's skill reads the project's own `components.json` rather than a copied list (https://ui.shadcn.com/docs/skills).
- A published slide-agent study reports success falling from 95.0% to 78.8% without a schema (https://arxiv.org/html/2501.03936v3; figure from the research pass, paper not read during the audit).

## Proposed change

1. New `scripts/build-agent-docs.mjs` with `--check`, modelled on `scripts/build-schema.mjs`. It writes into `plugins/bento-slides/skills/bento-slides/references/`:
   - `format.md`: one section per element type and for doc, theme, slide, `fx`, `present`, built from `MODEL_KEYS` (`slides/src/modelkeys.generated.ts`) and the schema's types and enums, with hand-written one-line meanings kept in a side table `scripts/agent-docs/meanings.json`. A key with no meaning fails the build, so a new model key forces a doc line.
   - `compact.md`: the layout and role table from `builtinLayouts()` and `layoutRoles()` (`slides/src/model.ts:1357`, `slides/src/compact.ts:235`), the aliases (`compact.ts:257`), and the defaults that may be omitted.
   - `verify.md`: every validator finding code with severity and meaning. Add an exported table in `slides/src/validate.ts` (code → severity → one line) and type `add()` against it, so a new code cannot be emitted without a row.
2. Assemble `docs/agents.md` from hand-written prose plus generated blocks between markers (`<!-- generated:format -->` … `<!-- /generated -->`). The prose moves the compact form, `md`, `h:"auto"`, layout plus role, the load-report loop, `bento check`, the schema URL and `measure`/`validate` out of `AGENTS.md` into the published guide; `AGENTS.md` keeps a pointer.
3. Add sections with a JSON example each: click builds (`fx.step` with `unnumbered`), the code element and code morph, maths, frames, tokens and modes, components, paint stacks.
4. Fix `site-src/llms.txt:7` so it is true, and add the references to it.
5. Regenerate `docs/format.md`'s tables from the same source, or reduce it to prose that links to the generated reference; remove the "v1.0.6" header.

## Acceptance criteria

- [ ] `node scripts/build-agent-docs.mjs --check` exits non-zero when any generated file is stale, and is registered in CI.
- [ ] Every key in `MODEL_KEYS` appears in `references/format.md` with a non-empty meaning.
- [ ] Every finding code `validateDoc` can emit appears in `references/verify.md`.
- [ ] `docs/agents.md` documents the compact form, `md`, `h:"auto"`, layout plus role, frames, tokens, components, paint stacks and click builds, each with a JSON example.
- [ ] Every fenced `json` block in `docs/agents.md`, `SKILL.md` and `references/*.md` that carries `"format"` or `"compact": true` loads through `parseDocInputReport` with zero `dropped` entries and zero `error` findings.
- [ ] `site-src/llms.txt` makes no claim the guide does not satisfy.
- [ ] `docs/format.md` no longer names a version older than the shell's.

## Tests

Add `scripts/test-agent-docs.ts`, bundled and run the way `scripts/test-slides-agent-decks.ts` is (`action.yml:421-422`), registered at the end of the slides slice. It asserts the criteria above: key coverage, code coverage, snippet loading, and the `llms.txt` claims (each phrase it lists is findable in the published guide). Extend `scripts/test-slides-compact-layouts.ts` so its layout-table check reads `references/compact.md` and the published guide, not only `AGENTS.md`.

## Out of scope

The skill's main file (AI-01), the interim hand corrections (AI-03), new layouts (AI-09), new finding codes (AI-12, F-08, F-09).

## Notes for the implementer

- Docs, plugin and scripts only: no shell bytes. The exported finding table in `validate.ts` is the one source change; keep it a table of strings so the shell cost is a few hundred bytes, and report it.
- `scripts/` and `site-src/` are the maintainer's ops zone upstream: keep those edits minimal and separate commits.
- Released `schema/slides-<version>.json` files are frozen (`action.yml:702`); do not regenerate them.
- If AI-03 lands first, its corrections become the starting prose; do not lose them.

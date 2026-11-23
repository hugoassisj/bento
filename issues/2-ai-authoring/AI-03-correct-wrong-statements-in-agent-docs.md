---
id: AI-03
title: "Correct the wrong and missing statements in today's agent docs (interim patch)"
epic: 2-ai-authoring
type: bug
priority: P1
size: S
evidence: mixed
labels: [bug, "priority:P1", "size:S", "evidence:mixed", "area:skill"]
depends_on: []
related: [AI-01, AI-02]
upstream: []
---
## Summary

Several statements in the files agents read today are wrong or stale. Each one cost the audit's trial agent a guess or a worse deck. This is the small hand patch that can land before the skill rebuild (AI-01) and the generated reference (AI-02): correct them, and add a test for the ones a test can hold.

## What the user experiences

- The agent is told the app provides no fonts, so it writes `system-ui` everywhere; the starter deck it is compared against uses two built-in faces.
- A person told to use *Save ▾ → Copy document JSON* cannot find it: the command is in a different menu.
- The agent is told `theme` is required for the app to boot; in the trial a file with no `theme` opened without error.
- The agent learns three line endings out of eleven and three text tags out of seventeen.
- The show draws its own page counter and progress bar over the agent's hand-made page numbers, because the options that control them are not in the guide.

## Reproduce

Read the lines below against the code beside them.

## Evidence

All confirmed at `29b5c80` unless marked.

| # | Statement | Where | What the code says |
|---|---|---|---|
| 1 | "*Save ▾ → Copy document JSON*", "*Save → Replace from JSON…*" | `docs/agents.md:80`, `:101-102`; `plugins/bento-slides/skills/bento-slides/SKILL.md:26-27`; `AGENTS.md:161-162` | The three commands are items in the File menu opened from the wordmark, under the caption "Advanced" (`slides/src/editor/editor.ts:1234-1241`). They are also palette commands `copy-json`, `copy-compact-json`, `replace-json` (`editor.ts:3862-3864`). |
| 2 | Fonts "appear in the starter deck … because those files embed them in their own `doc.assets`, not because the app provides them"; "otherwise stick to system stacks" | `docs/agents.md:454`, `:460-463` | The app provides two faces by key: `'builtin:fraunces-900'` and `'builtin:instrument-sans'` (`slides/src/fonts.ts:25-26`). The starter names them in `doc.fonts` (`slides/src/starterdeck.ts:722-723`). |
| 3 | "Images/fonts must be embedded as data URIs in `doc.assets`" | `SKILL.md:129-130` | Same as 2: a `doc.fonts` entry may name a `builtin:` key instead of an asset. |
| 4 | "`size` and `theme` (including `fontFamily`) are **required** — the app will not boot without them" | `docs/agents.md:285-287`; `SKILL.md:51-52` | Trial observation: a full document with no `theme` booted. Not re-run here. The comment at `slides/src/compact.ts:351-357` says `parseDoc` only checks `format` and a non-empty `slides` array, and that a document without `size` passes it and then throws in the sidebar. The true rule needs a rig (see Tests). |
| 5 | text `html`: "inline `<b> <i> <br>` ok" | `docs/agents.md:312` | `ALLOWED_TAGS` is B, I, U, BR, SPAN, DIV, P, STRONG, EM, S, CODE, UL, OL, LI, H1, H2, A (`slides/src/render.ts:394-397`). |
| 6 | tips `lineStart`/`lineEnd` = `arrow\|dot\|bar` | `docs/agents.md:323-324` | Eleven values: `none`, `arrow`, `dot`, `bar`, `arrow-open`, `triangle`, `triangle-open`, `diamond`, `diamond-open`, `square`, `circle-open` (`slides/src/model.ts:374`). |
| 7 | "current as of bento/slides **v1.0.6**" | `docs/format.md:3-4` | The shell is 1.3.0. |
| 8 | "The element `type` discriminant is one of: text, shape, image, svg, chart, table, media" | `docs/format.md:146-147` | `code` and `embed` element types exist (`CodeElement`, `EmbedElement` in `slides/src/model.ts`). |
| 9 | `present?` is `{ slideNumber?, controls?, progress? }` | `docs/format.md:64` | Also `numberHidden`, `morphSeconds`, `typeWriterSeconds` (`slides/src/model.ts`, the `present?` block). `docs/agents.md` mentions only `present.numberHidden` (line 425). |
| 10 | `enter`: "Only runs on non-morph arrivals" | `docs/format.md:295` | `docs/agents.md:391-395` states the per-element rule: an element with a morph partner morphs, one without runs its entrance. The two files disagree. |
| 11 | The guide includes "the compact input form" | `site-src/llms.txt:7` | `docs/agents.md` has zero occurrences of `"compact": true`. |
| 12 | "Fully specify element fields … text needs `fontFamily`" | `SKILL.md:53-55` | A full document's text box with no `fontFamily` renders in the theme font (`slides/src/compact.ts:17-19`). Writing a literal stack on every element is what stops text following the theme. |

From the trial, not located in code: the show stacks its own "1 / 7" and progress bar over an agent's page-number text.

## How others do it

Anthropic's skill guidance: avoid time-sensitive statements, keep one source for each fact, and prefer defaults over menus (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

## Proposed change

Edit the three files in place; no restructuring (that is AI-01 and AI-02).

1. Menu path: "File menu (the bento/slides wordmark, top left) ▸ Copy document JSON / Copy compact JSON (for agents) / Replace from JSON…", plus "or ⌘K and type the name". All four locations.
2. Fonts: state the two built-in keys with a `doc.fonts` example taken from `starterdeck.ts:722-723`, say which weights each covers, and keep the `font-not-embedded` warning for everything else.
3. Required fields: write what the rig proves, in one sentence, and show the compact form as the way to omit them safely.
4. Text tags: list the allowed set; say that attributes are stripped.
5. Line endings: all eleven.
6. `docs/format.md`: remove the version from the header ("tracks `slides/src/model.ts`"), add `code` and `embed` to the type list with a pointer to their sections or a stub section each, list all six `present` keys, and replace the `enter` sentence with the per-element rule.
7. `docs/agents.md`: add a short "Show chrome" paragraph: `present.slideNumber`, `progress`, `controls`, `numberHidden`, and the advice not to draw a hand-made counter when `slideNumber` is on.
8. `SKILL.md:53-55`: replace "fully specify" with "omit what you are not choosing; a text box without `fontFamily` follows the theme".
9. `site-src/llms.txt:7`: drop the compact-form clause until AI-02 makes it true, or point it at `AGENTS.md`.

## Acceptance criteria

- [ ] No file under `docs/`, `plugins/` or `AGENTS.md` contains "Save ▾" or "Save →" beside "JSON".
- [ ] `docs/agents.md` names `builtin:fraunces-900` and `builtin:instrument-sans` and no longer says the app provides no fonts.
- [ ] The required-fields sentence matches the rig's result for: no `theme`, no `size`, no `theme.fontFamily`.
- [ ] The text-tag list and the line-ending list equal the sets in `render.ts` and `model.ts`.
- [ ] `docs/format.md` lists `code` and `embed`, all six `present` keys, and no stale version.
- [ ] `site-src/llms.txt` claims nothing the guide lacks.

## Tests

Add `scripts/test-agent-docs-facts.ts` (node), registered at the end of the slides slice in `.github/actions/validate-slides/action.yml`. It reads the sets from source (`ALLOWED_TAGS`, the `LineEnding` union, the `builtin:` keys, the `present` keys via `MODEL_KEYS`) and asserts each member appears in `docs/agents.md`; asserts the forbidden phrases are absent; and boots three minimal full documents through `parseDoc` plus the node-side render path to pin the required-fields sentence. It must fail on the parent commit. AI-02's `test-agent-docs.ts` later absorbs it.

## Out of scope

New sections for frames, tokens, components and builds (AI-02); restructuring the skill (AI-01).

## Notes for the implementer

- Docs only; no shell bytes. `site-src/` is the maintainer's ops zone upstream: one-line change, separate commit.
- `docs/agents.md` is stamped and published by `scripts/release.mjs:191-201`; do not add anything version-specific by hand.
- `AGENTS.md`'s layout table is pinned by `scripts/test-slides-compact-layouts.ts:139-147`: keep those lines byte-identical.

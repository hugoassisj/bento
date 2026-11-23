---
id: AI-04
title: "`bento` agent CLI: new, extract, inspect, lint, render, apply"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-01, AI-05, AI-06, AI-07, AI-12, AI-16, AI-17, F-07, F-08, F-09]
upstream: []
---
## Summary

An agent working on a `.bento.html` file has no tool. It splices JSON by hand, cannot see the deck's design system at a glance, cannot check its work without a browser, and cannot render. The repo's `scripts/bento-check.mjs` does the last two but only inside a repo checkout with `slides/node_modules`. Ship one zero-dependency Node script inside the skill, `scripts/bento.mjs`, with six verbs that cover the whole loop on any machine with Node, and Chrome only for `render`.

## What the user experiences

From the audit's trial:

- Editing the starter deck meant reading and rewriting a 183–186 KB document block (about 50k tokens, 34 KB of it `collab`) through a hand-written script; the assets-on-its-own-last-line layout and `<` escaping were re-created by hand.
- Nothing listed the deck's 18 tokens, extra palette slots and 3 components, so the agent wrote literals.
- `bento-check` failed 4 of 4 runs (AI-05); the agent wrote its own 60-line Playwright renderer.
- Every visible defect (clipped chart labels, half-empty cards) was found only by looking at PNGs.

## Reproduce

In a directory holding only a deck and the skill folder (no repo): try to validate or render the deck. There is no command to run.

## Evidence

Confirmed at `29b5c80`:

- `scripts/bento-check.mjs:88-93` requires `slides/node_modules/.bin/esbuild` and bundles a probe from repo sources (`slides/src/editor/exportimages.ts`, `slides/src/exportimages.ts`); for JSON input it requires a built shell (`:79`).
- The skill never mentions it (grep of `SKILL.md`); `AGENTS.md:199` does.
- PNG rasterisation is not on `window.bento` (`slides/src/main.ts:308-496`), so a probe must import `rasterizeSlide` (`slides/src/editor/exportimages.ts:59`) at build time. AI-06 removes that need.
- `window.bento.validate()` findings carry `code`, `severity`, `message`, `slide`, `element`, `path`; `loadDoc` returns a load report (`slides/src/main.ts:382-400`).
- The built shell was 687–690 KB at the time of the audit, small enough to bundle.

## How others do it

- Skill scripts should be non-interactive, have `--help`, print JSON to stdout, bound their output, and name the fix in every error (https://agentskills.io/skill-creation/using-scripts.md).
- Anthropic's presentation skill ships validate, thumbnail and render scripts and makes the QA loop mandatory; "each failure names its fix".
- Figma, Canva and Gamma all expose design-system discovery as a first step: variables and components (https://github.com/figma/mcp-server-guide), `list-brand-kits` (https://www.canva.dev/docs/mcp/tools/), `get_themes` (https://developers.gamma.app/mcp/mcp-tools-reference.md).
- Published results the research pass found: geometric checks cut slide collisions by 43% and image-reading evaluators miss overflow (https://arxiv.org/abs/2604.22840); success fell from 95.0% to 74.6% without a rendered view (https://arxiv.org/html/2501.03936v3). Papers not read during the audit.

## Proposed change

`plugins/bento-slides/skills/bento-slides/scripts/bento.mjs`, Node 20+, no dependencies, one file. Every verb: `--help`, JSON on stdout with `--json`, a short human summary otherwise, non-zero exit on failure, errors that say what to do next.

| Verb | Does | Needs |
|---|---|---|
| `new <out.bento.html>` | Copies the bundled app file (`assets/Bento_Slides.bento.html`); never downloads | Node |
| `extract <deck> [-o doc.json] [--compact]` | Writes the document without `assets` and without `collab`; prints only the NAMES of `collab` keys and asset keys with byte sizes | Node |
| `inspect <deck\|doc.json>` | The design-system report: theme slots, tokens by type with per-mode values, modes, share of style values bound through `themeRefs`, components (mains, copies, overridden keys), `doc.layouts`, fonts (embedded, built-in, missing), a histogram of unbound colours, font sizes and margins, slide list with state slides marked | Node |
| `lint <doc.json> [--base orig.json]` | Static checks with no browser: schema (bundled `assets/slides.json`), unknown element type, invalid colour, dangling `parentId`, element overlap, WCAG contrast of text on its slide background, token literal that differs from its token, component copy without `sig`, duplicate ids. With `--base`: a **design-system diff** (theme, tokens, modes, component mains, layouts, fonts) that must be empty unless the user asked for a change, and a list of unbound literals the edit introduced | Node |
| `render <deck> --png <dir> [--slides 1,3-5]` | Runs the deck's OWN runtime in headless Chrome, returns `validate()` findings and writes one PNG per slide plus a contact sheet. With no Chrome: exits with a message that says so and lists the binaries it tried | Node, Chrome |
| `apply <deck> <doc.json>` | Splices the document back: escapes `<`, restores `collab` and `docId` from the file, keeps assets last on their own line, refuses a change of `docId`, expands a compact document through the bundled shell's `loadDoc` when Chrome exists and refuses it with a clear message when not | Node (Chrome for compact) |

Implementation notes:

- `render` must not need esbuild. Until AI-06 lands, ship a prebuilt `scripts/probe.js` produced in CI from the same sources `bento-check.mjs` bundles; after AI-06 the probe is a ten-line call to `window.bento.render()`. Launch Chrome with remote debugging over a pipe or keep the `--dump-dom` gate; capture Chrome's stderr; make the timeout a flag.
- `lint`'s checks are plain functions over JSON in `scripts/lib/`, with no import from `slides/src`, so the skill folder is self-contained. Contrast: relative-luminance ratio per WCAG 2.x against the slide background, skipping text over images.
- Share the Chrome lookup with `bento-check.mjs` (`BENTO_CHROME`, then the usual paths, then Playwright's `/opt/pw-browsers/**`).
- `scripts/bento-check.mjs` becomes a thin wrapper over `render` so there is one implementation.
- Do not put a `bin/` directory in the plugin: the research pass reports that claude.ai and Cowork refuse plugins that have one (Claude Code plugin docs; re-check before relying on it).

## Acceptance criteria

- [ ] In an empty directory with only the skill folder and Node, `new`, `extract`, `inspect`, `lint` and `apply` (full document) all work with no network and no install.
- [ ] `extract` never prints a `collab` value; a regex over its stdout for the fixture's key strings finds nothing.
- [ ] `apply` after `extract` with no edit reproduces the file byte for byte.
- [ ] `inspect` on the 1.3.0 starter reports 18 tokens, its palette slots and its components.
- [ ] `lint` flags each of: unknown element type, invalid colour, dangling `parentId`, cream text on a cream slide, a token-bound literal that differs from its token, a copy without `sig`.
- [ ] `lint --base` reports an empty design-system diff for a content-only edit and a non-empty one when a token value changes.
- [ ] `render` on a machine with Chrome writes N PNGs and `contact.png`; on a machine without, exits 3 and names what it looked for.
- [ ] Every error message ends with the next action.

## Tests

Add `scripts/test-skill-cli.ts` (node; the `render` section is a browser rig that fails, not skips, under CI), registered at the end of the slides slice in `.github/actions/validate-slides/action.yml` after the single-file build. Fixtures: the built shell with the starter, a tokenised brand deck (shared with AI-17), and one deck per lint check. Assertions are the criteria above. Keep `scripts/test-bento-check.ts` green through the wrapper.

## Out of scope

`outline` and `patch` verbs (AI-07 adds them here once the app has them); the tool server (AI-18); new validator codes inside the app (F-08, F-09, AI-12), which `render` simply relays.

## Notes for the implementer

- Plugin and scripts zone; no shell bytes. The bundled app file adds about 690 KB to the skill zip: state the zip size.
- The bundled app file and schema must be refreshed at release time; add that to `scripts/release.mjs` where the skill is copied (`:459-464`), a maintainer-zone file upstream.
- `lint` duplicates a little of what `validate()` does. That is deliberate (it runs with no browser), but the wording of a shared finding must match the app's; take the messages from AI-02's generated table.
- Large and separable: land `extract`/`apply`/`inspect` first, `lint` second, `render` third.

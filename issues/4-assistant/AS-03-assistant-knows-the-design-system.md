---
id: AS-03
title: "The Assistant knows the design system: tokens, components, frames, layouts"
epic: 4-assistant
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:assistant", needs-upstream-discussion]
depends_on: [AS-01, AI-08, AI-09]
related: [AI-12, AI-16, F-01, SC-04]
upstream: ["nyblnet/bento#532"]
---
## Summary

The Assistant's prompt and patch language were written before 1.3.0 added auto-layout frames, design tokens with modes, palette bindings and components. The model is never told they exist, so anything it adds is written with literal colours, literal fonts and hand-picked coordinates, and a careless `set` can silently detach an element from the deck's tokens. This issue makes the deck's own design system the first thing the model sees and the easiest thing for it to use.

## What the user experiences

After AS-01, on a deck with a brand palette and tokens: "add a slide comparing the two plans" produces a slide in the built-in layout's white and navy, in the editor's default font, not the deck's. "Make this card match the others" writes a hex value copied from a neighbour; the card stops following the palette, and a later accent change skips it. Nothing reports either.

## Reproduce

1. Run the port (AS-01) with a simulated extension and capture the material the page sends for the starter deck.
2. Read `home/webext/src/prompt.js`, `OPS_PROMPT` (line 76).
3. Send an `add` op with `layout: "three-cards"` on the starter deck (dark, tokenised) and look at the new slide.

## Evidence

Seen in this audit:

- The material for the starter deck was 35,957 B: `outline` 10,259, `addressed` 12,820, `focus` 13,405, `theme` 366. The `theme` field is `JSON.stringify(doc.theme)` after elision.
- The AI authoring trial, which wrote decks from the published guide, produced **0 token-bound values and 444 literals** on a new deck; on the starter deck (which binds 470 of 975 style values through `themeRefs`) its two new body elements carried 0 bindings and 10 literals. Layout-by-role output came out white with navy ink on a dark deck. Six bindings were lost on load because the literal differed from the token; nothing reported it.

Confirmed in code:

- `home/webext/src/prompt.js` contains no mention of `themeRefs`, `parentId`, tokens, components or palette slots (grep returns nothing). It was last changed 2026-10-21.
- PR branch `slides/src/editor/assistant/material.ts`: `Material` has `outline`, `addressed`, `open`, `size`, `focus`, `theme`. Nothing names components, layouts or which values on the focus are bound.
- PR branch `ops.ts`: `LAYOUTS` is a fixed list of nine built-ins; `add` places text by role; `set` merges arbitrary fields. No verb binds a value or places a component copy.
- `slides/src/compact.ts` has no handling for `themeRefs`, `parentId` or `component`; they pass through as ordinary keys.
- Traps a model will hit (reproduced in the trial; see AI-12): a token-bound value whose literal differs from the token loses its binding (`slides/src/tokens.ts`); a component copy written without `component.sig` turns every difference into a permanent override (`slides/src/components.ts`); frame children are ordered by coordinate, then array order (`slides/src/layout.ts` header).

Not verified: how a real model behaves once told. That is what the rig fixtures and AI-17's evals are for.

## How others do it

- Figma's agent guidance is inspect first, reuse second: "Your code should match what's already there, not impose new conventions" and "Always search before building" (https://github.com/figma/mcp-server-guide).
- Penpot's MCP server works from real layouts and tokens, creating tokens rather than raw values (https://community.penpot.app/t/penpot-2-15-master-of-puppets/10529).
- Figma Slides generates from the team's components, variables and styles (https://www.figma.com/blog/how-teams-tap-into-the-power-of-design-with-figma-slides/).

## Proposed change

Keep the maintainer's split: the page holds format knowledge, the extension holds model knowledge.

**Page (`material.ts`).** Add a `system` field to `Material`, a compact inventory built from the live document:

- palette slots by name with their values; tokens by name, type and active-mode value; the mode list;
- fonts in use by role (body, display, code);
- components: name, id, and the keys of the main's text children (what a copy may override);
- the deck's own saved layouts (`doc.layouts`) by name with their roles, ahead of the built-ins;
- for the focus JSON, keep `themeRefs` on each element so the model sees what is bound.

Bound it (for example 3 KB) and truncate with a count, as the outline already does. Add an `inventory` case to the agent loop's `slide`/`outline` tools only if the field does not fit a small window.

**Page (`ops.ts`).** Use AI-08's compact input rules, do not duplicate them:

- `set` and `insert` accept a slot or token name as a value (`"fill": "$color.card"`, `"color": "tx1"`); the page writes the literal and the binding together.
- `add` accepts a deck layout by name, and `use: "<component name>"` to place a copy with a correct `sig`.
- `insert` with `parentId` appends to a frame without coordinates.
- A `set` that would change a bound value to a literal is applied only if the op says `"detach": true`; otherwise it is skipped and named. A `set` on theme, tokens, a component main or a layout is skipped unless the user's request targets it; the extension passes that intent as a flag on the turn.

**Extension (`prompt.js`).** Add five lines to `OPS_PROMPT`: the inventory is the deck's design system; use its names instead of literal values; reuse a component or a deck layout before building; inside a frame, order is the array order and coordinates are ignored; never change the system itself unless asked. Add a matching line to the `patch` tool description. Keep it short: the prompt must still fit the on-device window.

**Result card.** Name bindings in plain words: "kept Accent 1", "detached from radius.md".

## Acceptance criteria

- [ ] `material()` returns a bounded `system` inventory; on the starter deck it lists the palette slots, all 18 tokens, the fonts and the three components.
- [ ] An op `{"set":[{"id":"n/x","fill":"$color.card"}]}` leaves the element with the token's literal and a `themeRefs.fill` binding; one undo restores the previous state.
- [ ] `add` with a deck layout name uses that layout; with `use` it places a component copy whose `component.sig` matches its main, so a later edit to the main reaches it.
- [ ] A `set` that would overwrite a bound value with a literal is skipped and appears in `skipped` with a reason, unless `detach` is set.
- [ ] A turn without the "system change" flag cannot change `theme`, `theme.tokens`, a component main or `doc.layouts`; the rig asserts those are byte-identical before and after a hostile patch.
- [ ] `OPS_PROMPT` grows by no more than a fixed budget stated in the change (for example 600 characters), and the extension rig's window calculations still pass.
- [ ] On a fixture reply that uses names, zero bindings are lost on apply.

## Tests

- Extend `scripts/test-slides-assistant.ts`: inventory contents and bound size; each new op form; the detach rule; the protected keys under a hostile patch.
- Extend `scripts/test-webext-assistant.ts`: the prompt mentions the inventory; the material's `system` field is forwarded for hosted windows and dropped, with the outline kept, for the assumed on-device window.
- Fixture: one tokenised brand deck (shared with AI-17 and SC-04).

## Out of scope

Teaching design taste to the model. New token types. Changing what the gate accepts. The no-coordinates layouts themselves (AI-09) and the compact shorthand's parsing (AI-08).

## Notes for the implementer

- This touches `home/webext/src/prompt.js`, which is the maintainer's shipped extension, and files that exist only in their open PR. Needs their agreement before going upstream.
- The design rule in `issues/00-READ-FIRST.md` §6 is the acceptance test in spirit: what the user said, then what the deck defines, then what the deck already does, then defaults.
- "AI is additive, never load-bearing": none of this may change behaviour when no turn runs.
- The page never holds a key; nothing here needs one.
- The inventory is format knowledge and belongs on the page. Wording about how to use it is model knowledge and belongs in the extension, where it can change without a signed release.
- Report the byte cost; `material.ts` and `ops.ts` are in every saved file.

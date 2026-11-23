---
id: AI-09
title: "Layout and role: an unknown role never drops content; add stats, timeline, big-number and chart layouts"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-02, AI-08, AI-10, F-01, DS-02]
upstream: []
---
## Summary

Placement by layout and role is the best thing the compact form offers an agent: a 7-slide deck's weak slides went from 17.4 KB and 228 coordinates to 1.9 KB and zero coordinates. Two problems stop agents from relying on it. First, it can **lose the author's text**: an element with a role the layout does not have, written before the named columns, ends up duplicating one column and deleting the other, and the load report says only "placed as body". Second, there are nine layouts and none fits the slides decks are actually made of: three statistics, a timeline, one big number, a chart with key figures.

(The third problem, layouts ignoring the deck's theme, is F-01.)

## What the user experiences

From the audit's trial, compact input on the `two-col` layout with a `kicker` element as well as `left` and `right`: the left text appeared in both columns and the right column's text was gone. The report's only note was `no \`kicker\` slot in layout \`layout-two-col\`; placed as body`. The same trial found no layout that fits a roadmap, so that slide was a bullet list.

## Reproduce

```js
window.bento.loadDoc(JSON.stringify({ compact: true, slides: [ { layout: 'two-col', elements: [
  { role: 'title',  html: 'TITLE' },
  { role: 'kicker', html: 'KICKER' },
  { role: 'left',   html: 'LEFT' },
  { role: 'right',  html: 'RIGHT' }
] } ] }))
window.bento.doc.slides[0].elements.filter(e => e.type === 'text').map(e => [e.id, e.html])
```

Expected: all four texts present, LEFT in the left column, RIGHT in the right.
Observed in the trial: RIGHT is absent; LEFT appears in both columns.

Predicted from the code, not run: writing `right` before `left` (no unknown role at all) swaps the two columns silently.

## Evidence

Read at `29b5c80`; the mechanism below explains the trial's result exactly, but was not re-run for this issue.

- `layoutRoles` maps `body` to the FIRST body slot, and `left`/`right` to the first and second (`slides/src/compact.ts:235-246`). In `layout-two-col` both columns are `role: 'body'` (`slides/src/model.ts:1378-1387`).
- `layOut` (`compact.ts:271`) resolves each element to a slot by NAME and records it in `bySlot`; an unknown role falls back to `roles.body` with the note quoted above (`compact.ts:280-283`). So `kicker` and `left` both target `l2c-left`, and `right` targets `l2c-right`. Each donor's role is then rewritten to the slot's role, `body`.
- It then hands the donors to `applyLayout` (`compact.ts:299`), which matches by POSITION: for each layout element it takes the first unconsumed donor with the same role (`model.ts:1484-1492`). So `l2c-left` receives KICKER, `l2c-right` receives **LEFT**, and RIGHT is left unconsumed.
- Unconsumed donors are filtered out of the result (`const out = placed.filter((e) => !donorIds.has(e.id))`, `compact.ts:305`) on the assumption that they are "a SECOND body for its slot" to be stacked. Stacking only runs for slots with two or more donors (`compact.ts:306-308`): `l2c-left` is restacked as KICKER then LEFT, while `l2c-right` has one named donor, is skipped, and keeps the LEFT text `applyLayout` gave it. RIGHT is never written anywhere.
- The nine built-ins are `title`, `title-content`, `two-col`, `section`, `three-cards`, `quote`, `image-left`, `image-right`, `blank` (`model.ts:1360-1444`).
- The AGENTS.md layout table is pinned by `scripts/test-slides-compact-layouts.ts:139-147`. The extension's prompt carries its own list of layout names (`home/webext/src/prompt.js:49`).

## How others do it

- PowerPoint's agents and Copilot fill named layout placeholders; a placeholder that does not exist never destroys another's content.
- Gamma and Canva generate from themed, named card and layout types (https://developers.gamma.app/mcp/mcp-tools-reference.md, https://www.canva.dev/docs/mcp/tools/).
- Anthropic's skill guidance: prefer one good default path over many options, and make failures loud (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

## Proposed change

**Part 1: never lose content** (`slides/src/compact.ts`, `layOut`).

1. Make the name-based assignment authoritative. Before calling `applyLayout`, give the first donor of each slot the slot's own `id`, so `applyLayout` matches it by id (`model.ts:1485`) rather than by position; hold the remaining donors of that slot back for stacking.
2. Invariant, enforced in code: every author element that carried text or an image is present in the output exactly once. Anything that could not be placed goes to the default frame with a note; nothing is filtered out silently.
3. An unknown role is reported as a note that lists the roles the layout does have, and it stacks AFTER the named content of the slot it falls back to, never before it.
4. Report these notes with a distinct reason prefix so AI-12 can surface them as findings.

**Part 2: layouts decks need** (`slides/src/model.ts`, `builtinLayouts`).

| Layout id | Roles | For |
|---|---|---|
| `stats` | `title`, `stat1..3`, `label1..3` | three headline numbers |
| `big-number` | `kicker`, `figure`, `caption`, `body` | one hero figure with support |
| `timeline` | `title`, `step1..4`, `stepbody1..4` | a roadmap or process |
| `chart-figures` | `title`, `chart`, `stat1..3`, `label1..3` | a chart beside key figures |

- A `chart` (and `table`) slot needs `applyLayout` to accept a chart or table donor the way it already accepts an image donor for an `image` slot (`model.ts:1483`, `:1498-1501`).
- Build the new layouts as auto-layout frames bound to theme slots from the start (see F-01 and DS-02), so a missing fourth step or third stat reflows instead of leaving a hole.
- Add aliases in `LAYOUT_ALIASES` (`compact.ts:258`), the names to the extension's list (`home/webext/src/prompt.js:49`), and the rows to AGENTS.md and the generated reference (AI-02).
- Follow whatever the existing layouts do for the picker's names and placeholder prompts; a grep finds neither in the language catalogs today, so check how they are localised before adding strings.

## Acceptance criteria

- [ ] The reproduction above loads with all four texts present once each, LEFT in the left column and RIGHT in the right.
- [ ] `right` written before `left` lands RIGHT in the right column.
- [ ] For every built-in layout and every ordering of its roles plus one unknown role, the set of author texts in equals the set of texts out (property test).
- [ ] The note for an unknown role names the layout's valid roles.
- [ ] The four new layouts appear in the layout picker and load by name in compact input.
- [ ] `chart-figures` accepts a chart element with `role: "chart"` and places it in the slot's frame.
- [ ] Omitting `step4` (or `stat3`) leaves no gap.
- [ ] `scripts/test-slides-compact-layouts.ts` passes with the updated table.

## Tests

Extend `scripts/test-slides-compact-layouts.ts` (registered at `.github/actions/validate-slides/action.yml:431`) with the content-preservation property test over all layouts and role orderings; it must fail on the parent commit for the two-column cases. Add `scripts/fixtures/agent-decks/stats-timeline.json` using the new layouts, loaded clean by `scripts/test-slides-agent-decks.ts`.

## Out of scope

Theme-following layouts (F-01); converting the existing Three cards and Two columns layouts to frames (DS-02); text fitting inside frames (AI-10); a "next layout" control that cycles alternates.

## Notes for the implementer

- Part 1 is a bug fix and small; land it on its own branch first. Part 2 is a separate change.
- Slides zone, input-only for Part 1. Part 2 adds built-in layouts, which travel in every shell: report the byte cost.
- `applyLayout` is also what the editor's "Apply layout" uses; any change to it needs the editor path re-tested with real input.
- Layout element ids are kept so slides born from the same layout morph their chrome (`compact.ts`, "Round three" header comment). Choose stable ids for the new layouts and never rename them later.

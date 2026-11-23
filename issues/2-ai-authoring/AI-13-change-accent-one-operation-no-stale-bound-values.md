---
id: AI-13
title: "Change the accent as one operation; no stale bound values on disk"
epic: 2-ai-authoring
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-07, AI-12, AI-16, F-01, AI-04]
upstream: []
---
## Summary

"Change the accent colour" is the most common restyle request, and for an agent editing the file it is a trap. Changing `theme.accent` alone is the right edit, but it leaves the file with dozens of bound properties whose stored value is still the old colour, an explicit chart palette that does not follow, and unbound values of the same colour family. A blind find-and-replace of the hex instead overwrites deliberate uses. Both results validate identically, so the agent cannot tell which it produced.

## What the user experiences

The agent sets `theme.accent` to green in the Showcase deck's file. The user opens it: bound shapes are green, the charts and the small kicker labels are still coral. If another agent reads the file before the app has opened and re-saved it, it sees the old colour on 43 properties and concludes the deck is coral. If the agent instead replaced every `#FF9E8A`, 54 coral-family values (rgba gradient stops, derived shades, `accent3`) remain, and any place the user had used that hex on purpose without binding it has been changed.

## Reproduce

1. Export the starter: in the running app, `copy(JSON.stringify(window.bento.read()))`.
2. Variant A: set `theme.accent` to `#0A7F5A`, change nothing else, save into a deck file, open it. Charts keep the old colours; bound elements are green.
3. Before opening, count stale values: for every element with a `themeRefs` entry naming `accent1`, compare the stored literal with the new accent. They differ.
4. Variant B: also replace the old hex everywhere. Count remaining values within the old colour family. Run `window.bento.validate()` on both variants: the counts are the same.

## Evidence

Observed during the audit (AI trial, task B): variant A left 43 accent-bound properties holding the old literal on disk and charts and kickers coral; variant B left 54 coral-family values; both validated identically.

Confirmed in code now:

- The accent is palette slot `accent1`, read from `theme.accent` (`slides/src/palette.ts:182-187`); `accent2` to `accent6` fall back to it only when `theme.palette` does not set them.
- Bound literals are rewritten from the palette by `resolveThemeRefs` (`slides/src/palette.ts:319`) inside `derive`, and at boot the palette memory starts empty so this always runs once (`slides/src/derive.ts:44-52`). So the app repairs the literals in memory on open; the file stays stale until the next save.
- Chart colours come from `theme.chartPalette` when it is set and are derived from the accent only when it is not (`slides/src/model.ts:1089-1091`). The starter sets an explicit `chartPalette` (`slides/src/starterdeck.ts:695`), which is why its charts did not follow.
- `validate()` reports `theme-ref-stale` for palette refs at severity info (`slides/src/validate.ts:256-259`), so variant A does produce info findings; the trial compared warning and error counts.

Still unverified: the exact counts (43, 54) outside the trial's script.

## How others do it

PowerPoint: Design, Variants, Colors changes the theme's accent and everything bound to it, charts included, in one step. Figma: editing a variable's value updates every bound layer; nothing else changes. Canva's agent tools expose brand kits by name so an agent picks a kit instead of editing colours one by one (https://www.canva.dev/docs/mcp/tools/).

## Proposed change

1. A single operation, exposed where agents and people can reach it:
   - in the patch language (AI-07) as a theme op, for example `theme: { accent: "#0A7F5A" }`, applied by one function `setAccent(doc, colour)`;
   - in the agent CLI (AI-04) as part of `apply`, so a file edited on disk is written back already derived.
   `setAccent` sets `theme.accent`, runs the derive pass so every bound literal in the document is rewritten, and re-derives `theme.chartPalette` only if the existing one equals what the old accent would have derived. An explicit, hand-chosen chart palette is the user's and stays; the result reports "chart palette left as set".
2. The operation returns a short report: how many bound values followed, and a list of unbound values within a small colour distance of the old accent, as information. It never rewrites them.
3. The agent CLI's `apply` always runs the derive pass before writing, so no file leaves it with stale bound literals.
4. State in the agent reference (AI-02): change a colour at its slot or token, never by replacing literals.

No format change.

## Acceptance criteria

- [ ] `setAccent` on the starter leaves zero elements whose palette-bound literal differs from the new palette (assert with `validate()`: no `theme-ref-stale`).
- [ ] A chart palette that was derived from the old accent is re-derived; an explicit one is unchanged and the report says so.
- [ ] Unbound values near the old accent are listed in the report and are byte-identical in the document.
- [ ] The operation is one undo step in the editor.
- [ ] A deck written through the CLI's `apply` after a theme change has no stale bound literal on disk.
- [ ] Tokens, component mains and layouts are untouched (the design-system diff from AI-04 `lint --base` shows only `theme.accent` and derived values).

## Tests

Add `scripts/test-slides-set-accent.ts` (node): runs the operation on `starterDoc()`, asserts the criteria above, and asserts that a find-and-replace variant would have changed an unbound literal the operation leaves alone. Register it at the end of the slides slice in `.github/actions/validate-slides/action.yml`.

## Out of scope

- A general "restyle the deck" feature or theme presets (F-02).
- Binding the unbound look-alikes (AI-16 reports them as `unbound-literal`).

## Notes for the implementer

Slides zone. The palette derivation must stay idempotent (see the comment above `resolveThemeRefs`). Colour distance for the look-alike list should be a simple, documented rule; it is advisory. Depends in practice on AI-07 for the patch form, but `setAccent` and its rig can land first.

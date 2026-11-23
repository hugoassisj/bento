---
id: DS-13
title: "Proposal: component variants, properties and swap"
epic: 5-design-system
type: proposal
priority: P3
size: L
evidence: code
labels: [proposal, "priority:P3", "size:L", "evidence:code", "area:design-system", "format-change"]
depends_on: [DS-04]
related: [DS-12, AI-08, AS-03]
upstream: []
---
## Summary

Bento components are a main and its copies with detected overrides. Figma and Penpot go three steps further: **variants** (one component, several states such as Default / Highlighted), **properties** (a short list of what a copy is meant to change: the label, an icon's visibility), and **swap** (turn this copy into a copy of a different component, keeping its text). This is a format proposal to agree before any code.

## What the user experiences

- They build a "Feature card" and want a highlighted version that stays linked. Today that is a second, unrelated component.
- A copy can override anything, so nothing tells the next person (or an agent) what a copy is meant to change. Editing a copy's label takes three clicks into the group.
- To change which component a copy follows they delete it and insert another, losing its text and position.

## Reproduce

Not a defect. Create a component (⌥⌘K), insert a copy, and look for a way to make a second state, a property list, or "Swap": none exists (`slides/src/editor/inspector/component.ts`, 95 lines, offers Go to main, Reset overrides, Detach).

## Evidence

- **Confirmed in code now:**
  - Model: `slides/src/model.ts:168-178`. `component?: { id, key, main?, over?, off?, sig? }`. Every element of a component shares `id`; `key` pairs a copy element with its counterpart in the main; `over` lists the keys this element overrides.
  - `slides/src/components.ts:1-24` (header): copies re-derive from the main on every doc event; overrides are detected, not declared; `:37` (`OWN`) lists keys a copy never takes from its main; `:65` (`mainSig`), `:77` (`syncComponents`), `:162` (`instanceOf`), `:253` (`resetOverrides`).
  - Gate: `slides/src/untrusted.ts:498`. `component: shape(['id', 'key', 'main', 'over', 'off', 'sig'], …)`: on every intake path that goes through the element gate (paste, Replace from JSON, snapshot restore), a 1.3.0 shell keeps only those six sub-keys. **Any new sub-key of `component` is dropped there.**
  - Recorded ceiling: `docs/DECISIONS.md:12163-12171`. A main and its copy both edited before the next derive pass read as "the main moved", and the copy's edit is overwritten.
- **Seen in the running app (design-features journey):** main vs copy is shown only as ◆ / ◇; editing a copy's text takes three clicks; overrides survive main edits.

## How others do it

- **Figma:** component sets with variant properties; component properties (text, boolean, instance swap); Swap instance from the Assets panel or the instance menu, preserving overrides where layer names match.
- **Penpot:** components with variants; swap a copy from the design panel; overrides preserved by matching layers.
- **PowerPoint:** Slide Master layouts are the nearest idea; "Change Shape" swaps geometry and keeps text.

## Proposed format

The constraint that shapes everything: **new sub-keys inside `component` are stripped by 1.3.0's gate on paste and restore.** So new facts live where they survive, or are encoded in keys that already exist.

### A. Variants: a set is components that share a name prefix, declared at deck level

- Keep each variant a normal component (its own `component.id`, main and copies). No change to `component`.
- **New optional key:** `theme.componentSets?: Record<string, string>`, flat: `"<componentId>"` → `"<setId>/<prop>=<value>,<prop>=<value>"` (for example `"comp-a1" → "card/state=default"`, `"comp-b2" → "card/state=highlight"`). Flat strings one level under `theme` survive the theme gates (`slides/src/restoregate.ts:57`, `plainObject`). **Open question 1:** is `theme` the right home, or a new top-level optional doc key (then it must be added to `MODEL_KEYS.doc` and checked against `DOC_KEYS` at `restoregate.ts:32`)? A top-level key that 1.3.0 does not know: does it keep it on open and on restore?
- A copy's variant is simply which `component.id` it carries. **Changing variant = swap (C) to a sibling in the same set.**
- Old shell: sees unrelated components. Nothing breaks.

### B. Properties: declared on the main as names, stored as ordinary overrides

- A property is a label for one thing a copy may change: `{ name: 'Title', key: '<component.key of the element>', path: 'html' }`. Values are **not** stored anywhere new: setting a property on a copy writes the element's own key and adds it to `over`, which is today's override mechanism.
- **New optional key:** `theme.componentProps?: Record<string, string>`, flat: `"<componentId>"` → a compact list `"Title=<key>.html;Icon=<key>.hidden"`. Same open question 1.
- UI: selecting a copy shows its properties as fields at the top of the inspector (one click to edit the label), and "Reset overrides" keeps working.
- Agents: compact input (AI-08) can say `use: "Feature card", props: { Title: "…" }`.
- Old shell: properties are invisible; overrides already work there.

### C. Swap: re-point a copy at another component, one commit

- For each element of the copy: find the counterpart in the target main by `key` (variants of one set share keys by construction: making a variant duplicates the main and keeps `key`s). Set `component.id` to the target, keep `key`, keep `over` entries whose path still exists on the counterpart, drop the rest, clear `sig` so the next derive pass follows the new main.
- Elements with no counterpart are removed; counterparts with no element are instantiated (`instanceOf` logic, `components.ts:162`).
- Position: keep the copy's offset (`component.off`).
- No new format.

## Interaction with other machinery

- **Derive:** `syncComponents` is unchanged for A and B. C is an edit followed by a normal pass. The pass must stay a fixed point (`scripts/test-slides-derive.ts`).
- **The sig ceiling:** swap rewrites `component.id` on N elements in one commit; a concurrent edit to the old main during the same window is the recorded ceiling. State it; do not try to solve it here.
- **Morph:** element ids are the copy's own and do not change on swap, so a morph between slides keeps pairing. A swapped copy on the next slide morphs property by property.
- **Collaboration:** swap is a multi-element commit; check it merges as one step in `scripts/test-sync.ts` terms (it touches only `slides/`, not the CRDT, but run the rig).
- **Frames:** `parentId` and `sizing` are a copy's own (`OWN`, `components.ts:37`); swap must keep them.
- **Library (DS-04):** a set shows as one tile with a variant picker.

## Open questions

1. Where the two maps live, and what a released shell does with them on open, paste, Replace from JSON and restore.
2. Are flat encoded strings acceptable to the maintainer, or is a nested object preferred with a gate change (and the cost that 1.3.0 drops it on restore)?
3. Should properties restrict what a copy can override (Figma does not; it only surfaces), or only surface? Proposal: only surface.
4. Variant creation UX: "Add variant" duplicates the main beside it and registers both in a set.
5. Nested components (a copy inside another main): today a main's members cannot be another component's copy? Verify in `makeComponent` (`components.ts:154`) and `createComponent` (`slides/src/editor/editor.ts:2960`, which returns early if any selected element already has `component`).

## Acceptance criteria (proposal, then build)

- [ ] Open questions answered with evidence from a released shell and recorded here; maintainer agreed the keys.
- [ ] A deck using sets and properties opens in 1.3.0 as ordinary components with every element intact.
- [ ] Swap keeps text and other overrides whose keys exist on the target, in one undo step.
- [ ] Changing a variant from the inspector is a swap within the set.
- [ ] A property field on a copy edits the right element and records the override; Reset overrides clears it.
- [ ] One derive pass is a fixed point after each operation.
- [ ] The generated model keys and schema are regenerated and the frozen-schema rig passes.

## Tests

- `scripts/test-slides-components-browser.mjs`: add variant, swap, property edit, reset.
- A node rig for the swap mapping (keys kept, overrides filtered) and for parsing the two maps under hostile input.
- An old-shell rig modelled on `scripts/test-slides-alpha-refs.ts`.

## Out of scope

- Shared libraries across decks.
- Slots (free-form child areas inside a component).
- Solving the sig ceiling.

## Notes for the implementer

- Do not build before the format is agreed; append a DECISIONS entry when it is.
- Zone: slides app (`components.ts`, `model.ts`, `untrusted.ts`, `restoregate.ts`, `editor/inspector/component.ts`, `editor/tokenspane.ts` or the Library view from DS-04).
- Names are typed where they appear, never in `prompt()` (`docs/DECISIONS.md:12121`).

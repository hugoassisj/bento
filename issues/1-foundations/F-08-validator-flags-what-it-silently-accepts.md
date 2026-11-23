---
id: F-08
title: "Validator flags what it silently accepts: unknown element type, invalid colour, dangling parent, string-typed numbers"
epic: 1-foundations
type: enhancement
priority: P1
size: S
evidence: seen
labels: [enhancement, "priority:P1", "size:S", "evidence:seen", "area:validator"]
depends_on: []
related: [F-09, F-10, AI-11, AI-12, AI-02]
upstream: []
---
## Summary

`validate.ts` opens with "almost everything that goes wrong in a generated deck fails SILENTLY" and exists to report those failures. Four common ones still pass without a word: an element with an unknown `type`, a colour that is not a colour, a `parentId` that names nothing, and geometry written as strings. Add a finding for each.

## What the user experiences

An agent writes `"type": "shap"`, `"fill": "not-a-color"`, `"parentId": "nope"` or `"x": "10"`, runs `validate()`, and is told the deck is fine. The element then does not draw, draws with a fallback colour, silently leaves its frame, or reports nonsense geometry. The agent has no signal to fix it.

## Reproduce

In the console of a fresh load (`npm run dev`), with `const base = window.bento.read(); const run = (els) => window.bento.validate({ ...base, slides: [{ id: 's1', elements: els }] }).findings.filter(f => f.code !== 'collab-secrets-present').map(f => f.severity + ':' + f.code)`:

1. `run([{ id: 'a', type: 'shap', x: 10, y: 10, w: 100, h: 100 }])` → `[]`
2. `run([{ id: 'a', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: 'not-a-color' }])` → `[]`
3. `run([{ id: 'a', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: '#f00', parentId: 'nope' }])` → `[]`
4. `run([{ id: 'a', type: 'shape', shape: 'rect', x: '10', y: 10, w: 100, h: 100 }])` → `['info:out-of-canvas']` (string concatenation makes "10" + 100 = "10100")

For contrast, an unknown key and a missing asset are reported today (`warning:unknown-key`, `error:missing-asset`).

## Evidence

- Observed in the running app during the audit: all four probes above were run and returned exactly these results.
- Confirmed in code now:
  - `slides/src/validate.ts:305`–`306`: `const known = MODEL_KEYS.element[el.type]; if (known) { … }`. An unknown type has no key list, so the whole block is skipped and nothing is reported.
  - `validate.ts:330`–`331`: geometry is computed as `el.x + el.w` and `el.y + el.h` with no type check, hence the string-concatenation result.
  - There is no `parentId` check anywhere in `validate.ts`. The layout pass removes a dangling parent silently: `slides/src/layout.ts:177` deletes `parentId` and `sizing` when the parent is not a frame.
  - There is no colour-syntax check in `validate.ts`. Colours are gated at draw time by `cssColor` (`slides/src/render.ts:521`), which substitutes a fallback.
  - The gate already knows every property's shape: `slides/src/untrusted.ts:637` `checkElementProp`, `:674` `SLIDE_CHECKS`, with a drop report (`withDropReport`, `:88`).
- Not verified: what the boot path does with an unknown element type in a file opened from disk (dropped, kept, or drawn as nothing). Establish it and say so in the finding's message.

## How others do it

A JSON-schema validator or a compiler reports a wrong enum value, a wrong type and a dangling reference as errors with a path. Figma's plugin API throws on an unknown node type; it never ignores one.

## Proposed change

In `slides/src/validate.ts`, inside the per-element loop:

1. **`unknown-type`** (error, `path: 'type'`): the type is not a key of `MODEL_KEYS.element`. Message lists the valid types and, when one is within edit distance 2, says "did you mean `shape`?".
2. **`invalid-value`** (error for geometry and `type`-defining fields, warning otherwise, with `path`): reuse the gate's per-property checks (`checkElementProp`) in a read-only pass, so the validator and the gate cannot disagree about what a valid value is. The message states the expected shape ("`x` must be a finite number, got the string \"10\""). This covers string-typed numbers and non-colour colours in one mechanism. Do not hand-write a second colour parser.
3. **`dangling-parent`** (warning, `path: 'parentId'`): `parentId` names no element on the slide, or names an element that is not a frame (no `layout`), or names the element itself. Message: "it will be treated as a free element; the layout pass removes the link".
4. Skip the geometry and measurement checks for an element that failed (1) or a geometry `invalid-value`, instead of reporting derived nonsense such as the out-of-canvas above.
5. Add "did you mean" to the existing `unknown-key` message using the same nearest-key helper (small, high value for agents: `fil` → `fill`).

Update the finding-code list wherever it is documented (`docs/agents.md`, the header comment of `validate.ts`).

## Acceptance criteria

- [ ] Probe 1 returns `error:unknown-type` with a message naming the valid types and suggesting `shape`.
- [ ] Probe 2 returns an `invalid-value` finding at path `fill`.
- [ ] Probe 3 returns `warning:dangling-parent` at path `parentId`; a child whose parent is a real frame returns nothing.
- [ ] Probe 4 returns `error:invalid-value` at path `x` and no `out-of-canvas` finding for that element.
- [ ] `{ fil: '#f00' }` returns `unknown-key` whose message includes "did you mean \"fill\"".
- [ ] Every value the gate accepts produces no `invalid-value` (run the four fixtures in `scripts/fixtures/agent-decks/` and the starter: zero new findings).
- [ ] `validate()` still never mutates the document (assert deep equality before and after).
- [ ] Findings keep the existing shape `{ code, severity, message, slide, element, path }`.

## Tests

Extend `scripts/test-validate.ts` (node, DOM-free): one case per new code, the negative cases (valid frame child, valid colours in every accepted syntax including palette and token references, gradients), the "did you mean" text, and the no-mutation assertion. Already registered in `validate-slides/action.yml`; if a new rig file is added instead, register it at the end of the slides slice.

## Out of scope

- Visual checks: contrast, overlap, clipped text (F-09).
- Reporting bindings dropped at load, component copies without `sig`, stale tokens (AI-12).
- Surfacing findings in the editor (F-10).

## Notes for the implementer

- Zone: slides app. No format change. Messages are developer-facing English like the existing ones; if F-10 later shows them to people they will need `t()`: mention that dependency in the PR so F-10 can plan for it.
- `docs/DECISIONS.md` (the entry behind upstream #194) made `measure()` and `validate()` the tools for agents instead of a layout engine. Strengthening them is squarely within what upstream has asked for.
- Keep severities conservative: an error here will make `scripts/bento-check.mjs --fail-on error` fail, which is the point for `unknown-type`, but would be wrong for a merely unusual colour.

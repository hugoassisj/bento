---
id: F-07
title: "Validator measures field tokens as literal text (false overflow on the shipped starter)"
epic: 1-foundations
type: bug
priority: P1
size: S
evidence: seen
labels: [bug, "priority:P1", "size:S", "evidence:seen", "area:validator"]
depends_on: []
related: [SC-01, F-10, AI-02, DT-12]
upstream: []
---
## Summary

`window.bento.validate()` and `window.bento.measure()` lay out a text element containing a field such as `{{page:2}}` as the ten literal characters, not as the rendered value (`02`). On the shipped starter deck that produces three false `text-overflow` warnings. The reference deck every agent is told to check its work against therefore never checks clean.

## What the user experiences

An agent (or a person using Check deck once F-10 exists) validates the untouched starter and is told "Text needs 1500px but the box is 340px tall — it overflows by 1160px (4 lines)" on three slides. On screen those slides show a large, correctly fitting "02" ghost numeral. In the AI authoring trial, 6 of the agent's 13 first-pass warnings were this false positive on its own page-number fields.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 (starter deck).
2. In the console: `const v = window.bento.validate(); v.findings.filter(f => f.code === 'text-overflow')`.
3. Result: three findings, on slides 2, 13 and 18 of the document order, each for the element named "Ghost numeral" whose `html` is `{{page:2}}`, `fontSize: 300`, `w: 420`, `h: 340`.
4. Minimal case: `window.bento.validate({ ...window.bento.read(), slides: [{ id: 's1', elements: [{ id: 'a', type: 'text', x: 10, y: 10, w: 420, h: 340, html: '{{page:2}}', fontSize: 300, lineHeight: 1.25 }] }] })` reports `text-overflow`. Replace `html` with `02` and it does not.

## Evidence

- Observed in the running app during the audit: the starter's `validate()` returns `{ error: 0, warning: 6, info: 20 }`; three of the six warnings are these overflows (the other three are `out-of-canvas` on the same decorative element, see SC-01). The minimal case above was run and reproduced.
- Confirmed in code now:
  - `slides/src/validate.ts:483` `measureOverflow()` collects every text element and calls `measureElements(...)`.
  - `slides/src/measure.ts:86` `measureInto()` builds a throwaway element and calls `renderElement(el, doc)` at `:95` with **no options**.
  - The renderer resolves fields with `resolveFields(el.html, opts.fields)`; `slides/src/render.ts:77`–`78`: `if (!ctx || html.indexOf('{{') < 0) return html`. With no context the token text is returned unchanged and laid out as words.
  - The normal render path supplies the context per slide: `render.ts:1054` `const fields = opts.fields ?? fieldContext(doc, slide)`; `fieldContext` is at `render.ts:49`.
- Not verified: whether `measureTables` (`measure.ts:139`) has the same gap for fields in cells. Fields do not currently render in table cells at all (DT-12), so leave tables alone here.

## How others do it

PowerPoint and Keynote lay out a slide-number field at its rendered value everywhere, including overflow and autofit calculations; a field never counts as its placeholder text.

## Proposed change

1. `slides/src/measure.ts`: let the measuring functions take a field context. `measureInto(host, spec, doc, fields?)` passes `{ fields }` to `renderElement`. `measureElements` accepts, per element, the slide it lives on (or a prebuilt context) so the caller can supply the right page number.
2. `slides/src/validate.ts` `measureOverflow`: it already iterates slides; build `fieldContext(doc, slide)` once per slide and pass it with that slide's elements.
3. `window.bento.measure()` (`slides/src/main.ts:431`): when given the id of an existing element, find its slide and use that slide's context. When given a bare spec with no slide, measure against the current slide's context and document that a field measures as its value on the current slide.
4. Date and time fields depend on the viewer and the moment. Measure them with the same context the renderer would use now; do not invent a "worst case". Note this in the measure docs comment.
5. Keep one measuring path: do not resolve fields in `validate.ts` itself.

## Acceptance criteria

- [ ] On the shipped starter deck `window.bento.validate().findings.filter(f => f.code === 'text-overflow')` is empty.
- [ ] The minimal case above (`{{page:2}}` at 300px in a 420×340 box) reports no `text-overflow`; the same box with a genuinely overflowing string still does.
- [ ] `window.bento.measure('<id of a field element>')` returns the height of the rendered value, equal within 1px to the height of the same element with the value typed literally.
- [ ] A `{{pages}}`, `{{title}}`, `{{date}}` and `{{author}}` field are each measured at their rendered value.
- [ ] `validate()` and `measure()` still agree for every text element in the starter (the property the header of `validate.ts` promises).
- [ ] No change to findings for decks without fields (compare the full finding list on the four fixtures in `scripts/fixtures/agent-decks/`).

## Tests

- Extend `scripts/test-slides-measure-browser.mjs` (it already drives the real renderer in headless Chromium): add the field cases above and the "equal to the literal value" assertion.
- Add an assertion to `scripts/test-slides-starterdeck.ts` or the measure rig that the starter has zero `text-overflow` findings. SC-01 turns this into "zero warnings".
- The new assertions must fail on the parent commit (three findings) and pass with the fix. The rig is already registered; keep it so.

## Out of scope

- The three `out-of-canvas` warnings on the same element and a way to mark a deliberate bleed (SC-01).
- Fields and maths inside table cells (DT-12).
- New validator findings (F-08, F-09).

## Notes for the implementer

- Zone: slides app (`measure.ts`, `validate.ts`, `main.ts`). No format change, no strings.
- `validate.ts` is deliberately DOM-optional: without a DOM the measured checks are skipped and `measured` is false. Keep that.
- The agent docs describe `measure()`; if its behaviour for fields changes, update `docs/agents.md` in the same PR (AI-02 regenerates it later).
- Small and self-contained: a good first issue in this epic, and it unblocks SC-01 and F-10.

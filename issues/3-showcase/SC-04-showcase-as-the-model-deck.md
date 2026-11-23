---
id: SC-04
title: "Showcase as the model deck: every value bound, saved layouts, alt text on all visuals"
epic: 3-showcase
type: enhancement
priority: P2
size: M
evidence: seen
labels: [enhancement, "priority:P2", "size:M", "evidence:seen", "area:showcase"]
depends_on: [SC-01]
related: [SC-02, SC-05, AI-01, AI-16, AI-17, F-01, F-02]
upstream: []
---
## Summary

Agents and people copy what the Showcase does. It is a good model in two ways (most colours and fonts are bound to its tokens and palette, and almost every element is named) and an incomplete one in three: about half of its style values are still literals, it carries no layouts of its own for anyone to reuse, and none of its 61 visuals has alt text. Finish the job so the deck demonstrates the rule the tooling asks agents to follow, and ship the same deck as the skill's reference example.

## What the user experiences

A person likes the Showcase's title slide and wants another like it. Insert, Apply layout offers only the built-in layouts, which are white with navy text and look nothing like the deck. An agent reading the deck to learn the house style finds font sizes written as numbers in one place and bound to a token in another, and concludes literals are fine. A screen-reader user hears nothing for any chart or illustration.

## Reproduce

In the running app on a fresh profile:

```js
const d = window.bento.doc, all = d.slides.flatMap(s => s.elements)
;({ layouts: (d.layouts || []).length,
    named: all.filter(e => e.name).length + '/' + all.length,
    alt: all.filter(e => e.alt).length,
    visualsWithoutAlt: all.filter(e => ['image','svg','chart'].includes(e.type) && !e.alt).length,
    boundElements: all.filter(e => e.themeRefs).length })
```

Result: `layouts: 0`, `named: "321/336"`, `alt: 0`, `visualsWithoutAlt: 61`, `boundElements: 261`.

## Evidence

Observed during the audit: the numbers above; a counting script in the AI trial found 470 of 975 style values bound (48%), with nearly every colour and font family bound and the remainder mostly line height, weight and font size; 18 tokens; 3 components.

Confirmed in code now:

- `slides/src/starterdeck.ts` contains no `alt:` and assigns no `doc.layouts`.
- Token types are `color`, `number`, `fontFamily`, `fontSize`, `shadow` and `opacity` (`slides/src/model.ts:268`). Line height and weight have no token type, so "every value bound" can only mean every value a token or slot can drive.
- The layout picker lists built-in layouts first and then the deck's own (`slides/src/editor/editor.ts:2234`); `layoutAll` and `syncTokenRefs` already walk `doc.layouts` (`slides/src/layout.ts:165-169`, `slides/src/tokens.ts:141`).
- `alt` renders as `role="img"` with an `aria-label` and is documented on `ElementBase` (`slides/src/model.ts`, the `alt` field).
- The starter rig already asserts named layers and that every bound token exists and agrees (`scripts/test-slides-starterdeck.ts`).

Still unverified: how many of the 15 unnamed elements are intentional (generated parts), and the byte cost of five saved layouts.

## How others do it

Figma's and Penpot's sample files bind every colour and text style to the library, because the file is how the system is taught. PowerPoint templates ship their layouts in the Slide Master so "New Slide" always matches the deck. Anthropic's skill guidance bundles worked examples the agent can copy instead of describing them.

## Proposed change

All in `slides/src/starterdeck.ts`, plus fixtures.

1. **Bind what can be bound.** Every colour to a palette slot or colour token; every font family to a font token; every font size that repeats (kicker, body, title, display) to a `fontSize` token, adding tokens where a size is used three or more times. Leave one-off sizes and all line heights and weights as literals. Record the before and after coverage in the PR.
2. **Save the deck's own layouts** into `doc.layouts`: Title, Section, Content (title and body), Stats (three figures), Chart with caption, Table with caption. Build them from the existing slides so they carry the deck's bindings, placeholders with `placeholder` prompts and roles, and no demo content. They then appear in the layout picker under the deck's name and are what the compact loader and agents place slides with.
3. **Alt text** on every chart and every illustration that carries meaning; none on pure decoration (auroras, tiles, dots). Write real descriptions ("Bar chart: weekly visits and sales, Monday to Friday").
4. **Name the remaining unnamed elements** or document why a generated part is unnamed.
5. **One source for the skill.** Export this deck (content only, no session keys) as the skill's bundled reference example (AI-01, AI-04) from the same `starterDoc()` in a generated step, so the example cannot drift from the app.

No format change: `layouts`, `alt`, `themeRefs` and token types all exist.

## Acceptance criteria

- [ ] No colour or font family literal in the starter is unbound, except values the PR lists as deliberate.
- [ ] `doc.layouts.length >= 5`, each with at least one placeholder and no leftover demo text.
- [ ] Applying each saved layout to a new slide produces a slide that validates clean and follows a palette change.
- [ ] Every `chart` has `alt`; every `svg` and `image` either has `alt` or appears in an explicit decorative allowlist in the rig.
- [ ] `scripts/test-slides-starterdeck.ts` passes with new assertions for the four points above; the deck is still a derive fixed point.
- [ ] `window.bento.validate()` reports zero errors and warnings (SC-01), and no `unbound-literal` once AI-16 exists.
- [ ] The skill's reference example is generated from `starterDoc()` and a `--check` step fails when it is stale.
- [ ] Shell size before and after is stated in the PR.

## Tests

- Extend `scripts/test-slides-starterdeck.ts`: binding coverage for colours and font families is 100% minus the allowlist; layouts exist and are placeholder-only; alt coverage; names.
- Add each saved layout to `scripts/test-slides-compact-layouts.ts` if compact input can place slides by a deck layout's name; if it cannot, note that in AI-09.
- A generated-file check for the skill example, in the style of `node scripts/build-schema.mjs --check`.

## Out of scope

- New feature slides (SC-02) and the editor tour (SC-03).
- Built-in layouts following the theme (F-01) and theme presets (F-02).
- Token types for line height and weight (DS-12).

## Notes for the implementer

Slides zone, one file. Bindings must agree with their tokens at rest or the starter stops being a derive fixed point and the rig fails: write the literal the token resolves to. Saved layouts and alt text add bytes to every shell; measure and report. Do SC-01 first so the gate is in place while this deck changes.

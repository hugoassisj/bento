---
id: AI-16
title: "Design-system-wins guard: protected-by-default patch; `unbound-literal` and `off-system` findings"
epic: 2-ai-authoring
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:ai"]
depends_on: [AI-07, AI-12]
related: [AI-01, AI-04, AI-08, AI-13, AI-15, AS-03]
upstream: []
---
## Summary

The rule for anything AI touches in this project is that the deck's own design system wins: its tokens, palette slots, fonts, components and layouts belong to the user. Today nothing enforces or even observes that rule. In the audit an agent following the published guidance wrote 444 literal style values and 0 bound ones into a deck that binds 48% of its own. This issue makes the rule mechanical: edits that would change the design system are skipped unless they name it, and the validator can say, as information, where a value sits outside the system.

## What the user experiences

A user asks an agent to add a slide. The new slide's text uses a copied hex and a copied font stack instead of the deck's text slot and body-font token, so it looks right today and stops matching the first time the brand colour changes. Or the agent, tidying up, edits a token value or detaches a component copy nobody asked it to touch. Neither is reported anywhere.

## Reproduce

1. In the running app, `const d = window.bento.read()`.
2. Count how the deck styles itself: for the starter, 470 of 975 style values carry a `themeRefs` binding, with 18 tokens and 3 components (numbers from the audit's counting script).
3. Add two text elements whose `color` and `fontFamily` are literal copies of `d.theme.color` and `d.theme.fontFamily`, with no `themeRefs`. `window.bento.loadDoc(JSON.stringify(d))`, then `await window.bento.validate()`.
4. Result: no finding mentions that these values equal a slot the deck defines but are not bound to it.

## Evidence

Observed during the audit (AI trial, addendum): task A produced 0 bound and 444 literal style values plus 408 coordinates; the two new body elements in task B had 0 bound and 10 literal values; in the frames-and-tokens rebuild 120 bindings were written and 114 survived.

Confirmed in code now:

- `slides/src/validate.ts` has no code for an unbound value that matches a slot or token, nor for a value outside the deck's palette. Its reference checks are `token-unknown`, `theme-ref-malformed`, `theme-ref-unknown-slot`, `theme-ref-dangling` and `theme-ref-stale` (`validate.ts:232-259`).
- There is no patch entry point on `main` (AI-07), so there is nothing that could refuse a design-system change today; `window.bento.loadDoc` replaces the whole document (`slides/src/main.ts:382-400`).

Still unverified: the false-positive rate of an `off-system` check on real decks. Measure it on the gallery decks before choosing the default severity.

## How others do it

- Figma's agent skills: "Your code should match what's already there, not impose new conventions" and "Always search before building" (https://github.com/figma/mcp-server-guide).
- shadcn's skill reads the project's `components.json` before generating (https://ui.shadcn.com/docs/skills).
- Anthropic's frontend-design skill: the user's words, then the project's existing system, then the skill's defaults.
- Canva and Gamma expose brand kits and themes by name for the agent to pick from (https://www.canva.dev/docs/mcp/tools/, https://developers.gamma.app/mcp/mcp-tools-reference.md).

## Proposed change

1. **Protected by default** in `patch()` (AI-07) and in the agent CLI's `apply` (AI-04). An operation is refused, with the reason "would change the deck's design system", when it would:
   - change `theme` values, `theme.tokens` (values, modes, active mode) or palette slots;
   - change a component main, or clear or extend a copy's `over` beyond the fields the operation edits;
   - change `doc.layouts` or `doc.fonts`.
   A caller opts in per operation with an explicit theme, token, component or layout op. Adding a new token is allowed and reported; editing an existing one needs the opt-in. `loadDoc` (whole-document replace) stays unrestricted but its report gains a `designSystem` section listing what differs from the open deck.
2. **Two advisory findings** in `slides/src/validate.ts`, severity info, never auto-fixed:
   - `unbound-literal`: a colour, font family or font size that equals a palette slot's or token's value in a deck that defines them, with no binding at that path. Message names the slot or token to bind.
   - `off-system`: a colour outside the deck's palette and colour tokens, or a font family outside the deck's fonts, when the deck defines a system (at least one token or a non-default palette). One finding per distinct value per slide, with a count, so a deliberate multi-colour slide produces a line, not a wall.
3. A helper `designSystemOf(doc)` (new, pure) returning slots, tokens, fonts, component and layout names, and binding coverage. `inspect` in the CLI, the chatbot prompt (AI-15) and the Assistant's material (AS-03) all call it.

No format change. Validator messages are English like the existing ones.

Alternative rejected: auto-binding look-alike literals on load. That is the tool overriding the user's choice in the other direction; report it and let the user decide.

## Acceptance criteria

- [ ] A patch that sets a token's value without the explicit op is refused and reported; the document is unchanged.
- [ ] The same change through the explicit op applies.
- [ ] A patch that adds a new token applies and is listed as an addition.
- [ ] `validate()` reports `unbound-literal` for the reproduction's two elements, naming `tx1` and the body-font token.
- [ ] The shipped starter deck produces no `off-system` finding, and `unbound-literal` only where SC-04 has not yet bound a value (record the count in the PR).
- [ ] A deck with no tokens and the default palette produces neither finding.
- [ ] `designSystemOf(starterDoc())` returns 18 tokens and 3 components.

## Tests

- Extend `scripts/test-validate.ts`: one deck per new code, a system-less deck that must stay silent, and the starter.
- `scripts/test-slides-patch-protected.ts` (node, after AI-07): the refused and allowed cases above. Register at the end of the slides slice in `.github/actions/validate-slides/action.yml`.

## Out of scope

- Writing the skill's wording of the rule (AI-01).
- Reporting bindings dropped at load (AI-12).

## Notes for the implementer

Slides zone. `validate.ts` findings are advice by design; do not raise these above info without data. The protection list must match what the skill tells agents (AI-01) and what the eval suite asserts (AI-17): keep the list in one exported constant.

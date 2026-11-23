---
id: AI-08
title: "Compact input speaks the design system: token and slot names as values, `use`, `like`, theme defaults"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-01, AI-09, AI-12, AI-16, F-01]
upstream: []
---
## Summary

The compact form is the shape agents are told to write. It makes coordinates and boilerplate optional, but it has no way to say "use the deck's accent" or "another copy of that card". Binding a value to the deck's own token or palette slot takes two fields that must agree (a literal plus a `themeRefs` entry), a mistake silently drops the binding, and every omitted field is filled from the editor's defaults rather than the deck's theme. So the shortest thing an agent can write is also the thing that ignores the user's design system. Make reuse the shortest path.

## What the user experiences

From the audit's trial:

- Editing the Showcase deck (48% of its style values bound): the two new text elements carried 0 bindings and 10 literal style values. The agent copied `theme.color` and `theme.fontFamily` in as strings.
- A new deck built with tokens: 120 bindings written, 114 survived the load; the 6 lost were token-bound values whose literal differed from the token. Nothing reported the loss.
- Of 155 literals in that deck, 35 were `fontFamily`: expansion wrote the editor's font stack onto every text element.
- A shape with no `fill` came out `#F7A600`, the editor's default orange, on a dark green deck.
- A component copy written without its signature turned every difference from the main into a permanent override.

## Reproduce

Load through `window.bento.loadDoc()`:

```json
{ "compact": true,
  "theme": { "background": "#0B3D2E", "color": "#F4F1E8", "accent": "#E8B923",
             "tokens": { "set": { "color.card": { "type": "color", "values": { "default": "#16273E" } } } } },
  "slides": [ { "elements": [
    { "type": "shape", "shape": "rect", "x": 100, "y": 100, "w": 300, "h": 200 },
    { "type": "shape", "shape": "rect", "x": 500, "y": 100, "w": 300, "h": 200,
      "fill": "#123456", "themeRefs": { "fill": "$color.card" } },
    { "type": "text", "x": 100, "y": 400, "w": 600, "html": "Hello" }
  ] } ] }
```

Then read `window.bento.doc.slides[0].elements`:

1. First rect: `fill` is `#F7A600`.
2. Second rect: `themeRefs` is gone and `fill` stays `#123456`; `dropped` in the load report is empty.
3. Text: `fontFamily` is the editor's stack, not absent.

Results 1 and 3 follow directly from the code below. Result 2 was observed in the trial.

## Evidence

Confirmed at `29b5c80`:

- Defaults come from the editor's own factories: `elementDefaults` calls `defaultText({ … color: ink })` and `defaultShape(…)` (`slides/src/compact.ts:107-113`). `defaultShape` sets `fill: '#F7A600'` (`slides/src/model.ts:1176`); `defaultText` sets `fontFamily: FONT_STACK` (`model.ts:983`).
- The file's own header says a full document's text box with no `fontFamily` renders in the theme font, and that the expanded default is the editor's stack, "and those are not the same thing" (`compact.ts:17-19`). Compact input therefore turns "follow the theme" into a literal.
- The only deck-aware defaults are text colour from the slide background (`readableInk`, `compact.ts:110`) and a table's style (`compact.ts:117-127`).
- A token reference whose literal differs is dropped at boot: `syncTokenRefs(doc, tokensMoved)` with `tokensMoved === false` calls `dropRef` (`slides/src/tokens.ts:128-139`); `deriveMemory` treats tokens as unmoved on open (`slides/src/derive.ts:43-45`).
- Palette references take the form `accent1`, `accent1 -20%`; slots are `bg1 tx1 bg2 tx2 accent1…accent6 hlink folHlink` (`slides/src/palette.ts:41-45`, `:52`); token references start with `$` (`tokenName`, `tokens.ts:31`).
- Components: a copy with no `sig` is read as "edited by hand against an unmoved main" (`slides/src/components.ts:73` onward); a `sig` of `'reset'` makes every key follow the main again (`components.ts:258`).

## How others do it

- Figma's skills: "Always search before building"; values come from existing variables and components, never hard-coded (https://github.com/figma/mcp-server-guide, `figma-generate-design`).
- shadcn's skill reads the project's own configuration so generated code uses its tokens (https://ui.shadcn.com/docs/skills).
- A published benchmark found that giving the model a high-level helper library lifted results substantially (https://arxiv.org/abs/2501.00912; figure from a search summary, not read during the audit).

## Proposed change

All in compact input only (`slides/src/compact.ts`, `compactload.ts`); the saved file stays full and unchanged, so there is no format change.

1. **Names as values.** Where a style property takes a colour, number, font family, font size, shadow or opacity, accept:
   - a palette reference: `"fill": "accent1"`, `"color": "tx1"`, `"fill": "accent1 -20%"`;
   - a token reference: `"fill": "$color.card"`, `"radius": "$radius.md"`, `"fontFamily": "$font.body"`.
   Expansion writes the resolved literal AND the `themeRefs` entry, so the two can never disagree. An unknown name is reported in `dropped` with the list of names that exist, and the property falls back to the default.
2. **`use` for component copies.** `{ "use": "<component id or name>", "x": …, "y": …, "over": { "<key>": { "html": "…" } } }` expands to a full copy of the main's elements with `component.key`, `off`, the current `sig`, and only the listed overrides.
3. **`like` for slides.** `{ "like": "<slideId>", "elements": [ … ] }` starts the new slide with the named slide's background, slide-level `themeRefs`, transition and its recurring furniture (elements whose ids recur on other slides), then adds the given elements.
4. **Theme-first defaults.** When the author omits a field:
   - text `fontFamily`: leave it absent so it follows the theme (as a full document does), instead of writing `FONT_STACK`;
   - shape `fill`: bound to `accent1` (literal plus ref) instead of `#F7A600`;
   - slide `background`: already the theme's; also write the `bg1` binding.
   `compactDoc` (the reverse direction) must still round-trip: `expandDoc(compactDoc(d))` deep-equals `d` (`scripts/test-slides-compact.ts`).
5. Report every binding that expansion could not keep (hands off to AI-12 for the load-time cases).
6. Document all four in `AGENTS.md`, the published guide and the skill.

Alternative rejected: making the saved format accept names in place of literals. Old shells would draw nothing; the literal-plus-reference design in `palette.ts` exists precisely to avoid that.

## Acceptance criteria

- [ ] `"fill": "accent1"` loads as the accent literal with `themeRefs.fill === "accent1"`; changing the accent then re-tints it.
- [ ] `"fill": "$color.card"` loads bound to the token; switching the token's value changes the element.
- [ ] An unknown slot or token name appears in `dropped` with a reason that lists valid names; nothing throws.
- [ ] `{ "use": … }` yields a copy that follows a later edit to its main, with only the listed keys overridden.
- [ ] `{ "like": … }` yields a slide whose background binding and furniture match the source slide.
- [ ] A compact text element with no `fontFamily` has no `fontFamily` literal after load and renders in the theme font.
- [ ] A compact shape with no `fill` in a deck whose accent is not `#F7A600` is drawn in the deck's accent.
- [ ] The existing round-trip rig and the agent-deck corpus still pass.

## Tests

Extend `scripts/test-slides-compact.ts` (round-trip and defaults) and add fixtures under `scripts/fixtures/agent-decks/` (`token-values.json`, `component-use.json`, `slide-like.json`), which `scripts/test-slides-agent-decks.ts` already loads in CI (`.github/actions/validate-slides/action.yml:415-422`). Add assertions on `themeRefs`, `component.sig` and absence of `fontFamily`.

## Out of scope

Reporting binding losses for full documents at load (AI-12); protecting the design system from patches (AI-16); new layouts (AI-09); making built-in layouts follow the theme (F-01).

## Notes for the implementer

- Slides zone; input-only; no model key, so no schema regeneration. But the published JSON schema rejects compact input today (it requires `id`, numeric `h`, no `layout`); note it, do not fix it here.
- Changing the default for an omitted `fontFamily` changes what existing compact fixtures expand to: update the fixtures' expectations deliberately and say so.
- Report the shell's byte cost.
- `docs/DECISIONS.md` line 2842 ("Agents get tools to measure and check, not a layout engine") required geometry to stay pure; nothing here measures text.

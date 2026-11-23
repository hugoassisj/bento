---
id: DS-12
title: "Proposal: token aliases and text styles"
epic: 5-design-system
type: proposal
priority: P3
size: L
evidence: code
labels: [proposal, "priority:P3", "size:L", "evidence:code", "area:design-system", "format-change"]
depends_on: []
related: [DS-06, DS-11, AI-08, FH-04]
upstream: []
---
## Summary

Two things every design-token system has and Bento's does not: a token that points at another token (`color.button` = `color.brand`), and a named text style that sets family, size, weight and line height together. This is a format proposal to agree before any code. It must survive what a 1.3.0 shell does to `theme.tokens` when it opens a file.

## What the user experiences

- They define `color.brand` and want `color.link` and `color.button` to follow it. Today each is an independent value; changing the brand colour means editing three tokens.
- They want "Heading L" once, applied to forty titles. Today a title binds its font family and its font size to two separate tokens, and weight and line height cannot be bound at all, so they stay literals on every element.
- A token file imported from Figma or Penpot has aliases and typography tokens; DS-11 has to flatten the first and skip the second.

## Reproduce

Not a defect. To see the gap: Tokens tab ▸ try to set a token's value to another token (no control exists); select a text box ▸ Format ▸ Text: family and size can be bound, weight and line height cannot.

## Evidence

- **Confirmed in code now:**
  - `slides/src/model.ts:268-269`: `TokenType = 'color' | 'number' | 'fontFamily' | 'fontSize' | 'shadow' | 'opacity'`; `TokenValue = string | number | ShadowSpec`. No reference form, no composite text type.
  - `slides/src/tokens.ts:48-55` (`tokenValue`): returns the value for the active mode, with no indirection.
  - `slides/src/untrusted.ts:456` (`TOKEN_KEYS`): the set of properties a `$token` ref may sit on; line height and weight are not token-driven today.
  - **What a 1.3.0 shell does on open** (`slides/src/restoregate.ts:247-252` → `tokens()` `:75-103`): a token whose `type` is not one of the six is **dropped**; a per-mode value that fails its type's rule is **dropped**; every key on a token other than `type` and `values` is **dropped**; every key under `theme.tokens` other than `set`, `modes`, `mode` is **dropped**. On the next save the loss is permanent.
  - Bound literals: `slides/src/tokens.ts:128-146` (`syncTokenRefs`): when tokens move, literals follow; when a literal disagrees with an unmoved token, the binding is dropped.
- **From the AI trial (not re-verified here):** in a frames-and-tokens deck, 70 of 155 unbound style values were line height and weight "which have no token type".

## How others do it

- **Figma:** a variable can alias another variable; text styles are separate named styles (family, size, weight, line height, letter spacing).
- **Penpot:** tokens reference each other with `{name}`; typography is a composite token type.
- **Design Tokens format:** aliases are `{group.name}`; `typography` is a composite of `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`.
- **PowerPoint / Keynote:** theme fonts (heading, body) and paragraph styles; Keynote's text styles update every use.

## Proposed format

### A. Aliases: the resolved value stays in place, the alias is remembered beside it

Mirror the rule the format already uses for bindings ("the literal always stays in place", `docs/DECISIONS.md:12062`).

- A token keeps a concrete value in `values[mode]`, always.
- **New optional key, outside `theme.tokens`:** `theme.tokenAliases?: Record<string, string>`, a flat map from `"<token>"` or `"<token>@<mode>"` to the name of the token it follows. Flat strings one level under `theme` survive both 1.3.0 gates (it is not under `theme.tokens`, and it is no deeper than `theme.codePalette`).
- **Derive:** a new first step in `derive.ts`, before `syncTokenRefs`: for each alias, copy the target's value (same mode) into the alias token's `values`. Then the existing pass propagates to bound literals. Cycles and chains: resolve depth-first with a visited set, cap at 8; a cycle resolves nothing and the validator reports `token-alias-cycle`.
- **Hand edit rule:** editing an aliased token's value directly breaks the alias (same philosophy as a bound literal that disagrees).
- **Old shell:** ignores the map; shows and edits concrete values. An edit there makes the value disagree with its alias target; on reopening in a new shell the alias is dropped for that token (the old shell's edit wins), exactly as for bound literals.

Rejected: writing `"$other"` as the value. A 1.3.0 shell drops any value that fails its type rule, so a number token aliased that way would lose its value on open.

### B. Text styles: a named bundle of existing properties, not a new token type

A new `TokenType` would be dropped wholesale by 1.3.0. So:

- **New optional key:** `theme.textStyles?: Record<string, string>`, flat, name → a compact string such as `"family=$font.display;size=$size.h1;weight=800;line=1.05;track=0"`, or, if a nested object proves safe on every path, `{ family, size, weight, lineHeight, letterSpacing }`. **Open question 1:** verify which shape survives open, paste, Replace from JSON and snapshot restore in a 1.3.0 shell; `plainObject` (`restoregate.ts:57`) allows one nested level.
- Each part is a literal or a `$token` name, so a style composes existing tokens.
- **Binding:** `themeRefs.text = '%Heading L'` on a text element (a new prefix, so `tokenName()` at `tokens.ts:31` and palette refs are untouched). The five literals stay on the element.
- **Derive:** after tokens resolve, write the style's five values into each bound element. A literal that disagrees with an unmoved style is an override of that one property: keep it, and record it so the style's other properties still follow. **Open question 2:** per-property overrides need somewhere to live (`themeRefs['text!']` listing overridden keys, like `component.over`).
- **Old shell:** ignores `theme.textStyles` and the `%` ref. **Open question 3:** does a 1.3.0 shell keep or drop a `themeRefs` entry it cannot parse (see `theme-ref-malformed` in `slides/src/validate.ts` and the gate rule for `themeRefs`)? If it drops it, the binding is lost on the first old-shell save; state that as the cost or pick another carrier.

### C. Line height and weight as bindable numbers

Independent of B and smaller: add `lineHeight` and `fontWeight` to `TOKEN_KEYS` so a `number` token can drive them. **Open question 4:** a 1.3.0 shell's gate refuses a `$token` ref on a key outside its `TOKEN_KEYS`; confirm what it does with the ref on open (dropped ref, literal kept, is the expected outcome and is acceptable).

## Interaction with other machinery

- **Morph:** unaffected; morph reads the literals.
- **Collaboration:** aliases and styles are derived, not committed, like tokens today. Every replica must compute the same result from the same document: keep the new steps pure and ordered in `derive.ts`, and extend `scripts/test-slides-derive.ts`' fixed-point assertion.
- **Components:** a copy takes its main's bindings; styles ride along as `themeRefs`.
- **Agents:** compact input (AI-08) should accept a style name as a value.
- **Import/export:** DS-11 keeps aliases and maps `typography` to text styles once this lands.

## Acceptance criteria (for the proposal, then for the build)

- [ ] The four open questions above are answered with evidence from a released 1.3.0 shell, recorded in this issue.
- [ ] The maintainer has agreed the key names and shapes (this changes the document format).
- [ ] A deck using aliases and text styles opens in 1.3.0 with every concrete value intact and nothing dropped except the links themselves, which the PR lists.
- [ ] Changing an alias target updates every follower and every bound element in one derive pass; a second pass writes nothing.
- [ ] A cycle is reported, never loops, never crashes.
- [ ] Editing a follower by hand breaks only that alias.
- [ ] Applying a text style to a text box sets all five properties; overriding one keeps the other four following.
- [ ] `node scripts/build-modelkeys.mjs --check`, `node scripts/build-schema.mjs --check` and `scripts/test-schema-frozen.mjs` pass.

## Tests

- `scripts/test-slides-tokens.ts`: alias resolution, chains, cycles, mode-specific aliases, the hand-edit rule.
- `scripts/test-slides-derive.ts`: fixed point with aliases and styles; 2,000 random token graphs.
- An old-shell rig modelled on `scripts/test-slides-alpha-refs.ts`: what a released shell keeps and drops.
- Gate rigs (`scripts/test-fileopen-gate.ts`, `scripts/test-replace-json-gate.ts`, `scripts/test-slides-gate-keys.ts`): hostile alias and style maps.

## Out of scope

- Per-run text styling inside a text box (FH-04).
- Per-mode theme colours (DS-06).
- Sharing styles between decks.

## Notes for the implementer

- Do not start building until the format is agreed. Write the DECISIONS entry with the answers to the open questions.
- Zone: slides app (`model.ts`, `tokens.ts`, `derive.ts`, `untrusted.ts`, `restoregate.ts`, `validate.ts`, `tokenspane.ts`, `inspector/text.ts`). `kernel/src/docfields.ts` holds shared field lists: if a new theme key must be listed there, that is a kernel-zone change and goes in its own small PR.
- Limits to carry over from the token rule: names by the token-name pattern, at most 500 tokens, 16 modes; add a cap for styles and aliases.

---
id: AI-12
title: "Report silent binding losses; add a stale-token finding"
epic: 2-ai-authoring
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:validator"]
depends_on: [AI-11]
related: [AI-08, AI-13, AI-16, F-08, AI-01]
upstream: []
---
## Summary

Four things an agent writes are silently changed or discarded on load, and neither the load report nor `validate()` says so: a token-bound value that differs from its token loses the binding; a component copy written without its signature turns every difference into a permanent override; frame children are reordered by coordinate; and a `parentId` that names no frame is removed. The validator also checks palette bindings for staleness but returns early for token bindings. The trial wrote 120 bindings and 114 survived; nothing reported the six that did not.

## What the user experiences

An agent binds a card's fill to `$color.card`, writes the literal it believes the token holds, and loads the deck. The card looks right. Later the user changes the token and that card does not follow. Nobody was told the binding was dropped at load. The same agent writes a component copy as a minimal object expecting it to fill from the main; every field that differs becomes an override and the copy never follows the main again.

## Reproduce

In the console of the running app (`cd slides && npm run dev`):

1. Token mismatch. Take `window.bento.read()`, pick an element bound to a token, change its literal (for example `fill: "#123456"` while `themeRefs.fill` stays `"$color.card"`), `loadDoc` it, read the element back: `themeRefs.fill` is gone, `report.dropped` is empty.
2. Copy without signature. Duplicate a component copy's elements in the JSON, delete `component.sig`, change `fill`, load: `component.over` now lists `fill`; change the main and the copy does not follow.
3. Frame order. Write three frame children with `x` of 900, 500, 0 in array order A, B, C: they lay out C, B, A. Write all three at `x:0`: A, B, C.
4. Dangling parent. Give an element `parentId: "nope"`, load, read it back: `parentId` and `sizing` are gone; no entry in `report.dropped`, no finding.

## Evidence

Observed during the audit: all four reproduced in the AI trial; my own validator probe showed no finding for a dangling `parentId`.

Confirmed in code now:

- Token mismatch: `syncTokenRefs` in `slides/src/tokens.ts:128-146`. When tokens have not moved, a literal that differs from the token's value calls `dropRef` (`tokens.ts:139`). At load, `deriveMemory` (`slides/src/derive.ts:43-45`) records tokens as unmoved, so this branch always runs.
- Unknown token: the same function leaves a ref to a missing token alone (`tokens.ts:137`); `validate()` does report it as `token-unknown` (`slides/src/validate.ts:232-236`). So this one is reported by `validate()`, though not in the load report's `dropped` list.
- Stale tokens unchecked: `validate.ts:232-237` returns as soon as the reference is a token; the `theme-ref-stale` comparison at `validate.ts:256-259` is reached only for palette references.
- Copy without signature: `syncComponents` in `slides/src/components.ts:73-76` (doc comment) and `components.ts:93-94`: `mainMoved` is false when no `sig` is present, and every differing key is added to `over` (`components.ts:113-122`). `resetOverrides` writes `sig = 'reset'` (`components.ts:258`).
- Frame order: header of `slides/src/layout.ts:14-16`.
- Dangling parent: `layoutSlide` deletes `parentId` and `sizing` when the parent is not a frame (`slides/src/layout.ts:177`).

Still unverified: the trial's claim that omitting the literal entirely yields the editor default `#F7A600` and then drops the binding. The mechanism is plausible (compact expansion fills the default, then `syncTokenRefs` sees a mismatch) but I did not trace it.

## How others do it

Figma's agent guidance: "Always search before building" and never hard-code a value where a variable exists; its tooling reports variables by name so a mismatch is visible. Anthropic's skill guidance wants errors that name the fix. The Bento validator already writes messages that way; these cases just never reach it.

## Proposed change

1. Load report (`slides/src/compactload.ts`, after AI-11 moves derive before the report): snapshot `themeRefs`, `component.over` and `parentId` per element before the derive pass, diff after, and add entries to `report.dropped` with reasons:
   - `binding dropped: value "#123456" differs from token "color.card" ("#F2F0EA"). Write the token's value, or omit the literal`
   - `override added: "fill" differs from the main and this copy has no sig. Copy the main's sig, or use sig "reset" to follow the main`
   - `parent removed: "nope" is not a frame on this slide`
2. Make omission safe: when an element carries a token ref and no literal at that path, write the token's value instead of the editor default, so the binding holds. Do this in the expansion step, not in `syncTokenRefs`.
3. `validate.ts`: add `token-stale` (info) beside `theme-ref-stale`, comparing the literal with the token's value in the active mode through the same `keepAlpha` rule colours use. Add `component-copy-unsynced` (warning) for a copy with no `sig`, and `parent-not-frame` (warning) for a `parentId` that names nothing or a non-frame. These fire on files written straight to disk, where no load report exists.
4. Document the frame-order rule in the agent reference (AI-02): "children at the same coordinate keep array order".

New strings are validator messages (English only, like the existing ones; confirm they are not routed through `t()`).

## Acceptance criteria

- [ ] Each of the four reproductions adds a `dropped` entry with a path and a reason that names the fix.
- [ ] A token ref with no literal keeps its binding after load and takes the token's value.
- [ ] `validate()` reports `token-stale` for a bound literal that differs from its token, and nothing for one that agrees.
- [ ] `validate()` reports `component-copy-unsynced` and `parent-not-frame` on a document that was never passed through `loadDoc`.
- [ ] The shipped starter deck produces none of the three new findings.
- [ ] `node scripts/build-schema.mjs --check` and `node scripts/build-modelkeys.mjs --check` pass (no model change).

## Tests

- Extend `scripts/test-validate.ts` with one broken deck per new code, and assert the starter stays silent for them.
- Extend the load-report rig from AI-11 with the four reproductions.
- Extend `scripts/test-slides-starterdeck.ts` only if the starter needs a correction to stay clean.

## Out of scope

- Changing what happens (bindings are still dropped, overrides still added). This issue makes it visible and makes omission safe.
- Protecting the design system from unrequested edits (AI-16).

## Notes for the implementer

Slides zone. The derive pass runs on every replica; do not add reporting side effects inside `syncTokenRefs`, `syncComponents` or `layoutSlide`. Diff around them. `validate.ts` is advisory by design ("a finding is advice, not a refusal"); keep the new codes at info or warning.

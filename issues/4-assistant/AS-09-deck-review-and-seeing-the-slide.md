---
id: AS-09
title: "Deck review: findings explained with offered fixes; the model sees the rendered slide"
epic: 4-assistant
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:assistant"]
depends_on: [AS-01, F-09, F-10, AI-06, AI-07]
related: [AS-07, F-07, F-08, AI-12, AI-16]
upstream: ["nyblnet/bento#532"]
---
## Summary

Two additions that turn the Assistant from a rewriter into a reviewer. First, a deck review: the checker's findings (F-09, F-10) listed in words, each with a fix the user can apply, some deterministic and some proposed by the model. Second, an opt-in for the model to look at a rendered picture of the slide, because the defects that matter most (clipped labels, overlap, a half-empty card) are invisible in the JSON it is given today.

The checker must work with no model. The model only explains and proposes.

## What the user experiences

Today there is no review anywhere in the editor. `window.bento.validate()` exists for scripts, but a table running off the slide or cream text on a cream background produces no warning on screen. With the Assistant ported (AS-01), a model edits text it cannot see laid out: it is sent an outline and the focus as JSON, never pixels.

## Reproduce

1. On 1.3.0, make a table with twelve rows so it runs off the slide: no warning in the editor.
2. In the console: `await window.bento.validate()` returns findings, including three false text overflows on the shipped starter deck (F-07).
3. On the PR branch, capture the material for a turn: `outline`, `addressed`, `open`, `size`, `focus`, `theme`. No image.

## Evidence

Seen in this audit:

- The starter deck validates with 6 warnings and 20 info findings out of the box; three warnings are false (a `{{page:2}}` field measured as literal text).
- The checker said nothing about an unknown element type, an invalid colour, a `parentId` that names no frame, cream text on a cream slide, or overlapping text boxes (F-08, F-09).
- In the AI authoring trial every visible defect in the agent's deck (chart axis labels clipped to ") MWh", cards half empty) went unflagged and was found only by looking at rendered PNGs.
- The material captured from the PR branch carries no rendering.

Confirmed in code:

- PR branch `panel.ts`: the dry-run `check()` already returns "what the change would BREAK — the validator's fresh findings on the patched deck" to the extension's agent loop, and `home/webext/src/prompt.js` (`AGENT_TOOLS`, line 144) tells the model to fix warnings a `patch` dry run reports. The loop exists; it is fed only what the validator can see.
- PR branch `material.ts` (header comment): inline assets are elided to tokens because "a model cannot edit pixels anyway". That is a deliberate privacy position: pictures in the deck do not leave the machine.
- Main: `validateDoc()` at `slides/src/validate.ts:135`; `measureContrast()` at `slides/src/editor/inspector/contrast.ts:106` (pure model maths); `rasterizeSlide()` at `slides/src/editor/exportimages.ts:59` returns a `Blob` for one slide.
- `home/webext/src/providers.js` shapes text-only requests; it has no image part for any provider.

Not verified: whether a model, shown a slide image, finds layout defects reliably. A published study reports image-reading evaluators miss overflow while geometric checks cut collisions by 43% (https://arxiv.org/abs/2604.22840, from the research pass; not read first-hand). That is why the checker comes first and the picture second.

## How others do it

- PowerPoint: Review Presentation on the Review tab, and the Accessibility Checker with one-click fixes per finding (https://techcommunity.microsoft.com/t5/microsoft-365-blog/what-s-new-in-powerpoint-smarter-faster-ways-to-build-and-edit/ba-p/4469061).
- Figma's agent guidance: take one screenshot after composing and one after a visual fix, then stop (https://github.com/figma/mcp-server-guide).
- Anthropic's presentation skill makes render-and-look a required step before a deck is handed over.

## Proposed change

**Part A: review, model optional.**

1. F-10 provides the Check deck panel: findings grouped by slide, in the validator's own sentences. This issue adds a fix column.
2. **Deterministic fixes first**, no model involved, each one an ordinary undoable edit:
   - text overflows its box: "Grow the box" or "Shrink text to fit" (`slides/src/editor/shrink.ts` and the existing fit path);
   - element off the slide by accident: "Move inside the slide";
   - low contrast: "Use the theme's text colour" when the deck has one;
   - missing alt text: focus the Accessibility field.
3. **"Ask the assistant"** on any finding, when a host is ready: sends a turn whose request is the finding's sentence and whose focus is the finding's element or slide. The reply goes through AS-07's review like any other.
4. **"Review this deck"** in the drawer and `⌘K`: runs the checker, then one question turn that receives the findings list and the outline and answers in prose with the three things most worth fixing. It proposes nothing by itself; each item links to its finding.
5. With no host, items 1 and 2 are the whole feature and nothing mentions a model.

**Part B: let the model look, opt-in.**

1. A new optional field on the material, `image`: one slide rendered with `rasterizeSlide` (through AI-06's public call) as a JPEG data URL at a bounded size (for example 1024 px wide, quality chosen to stay under 150 KB).
2. Sent only when all of these hold: the host says the active model accepts images (a new optional boolean `vision` on `assistant.describe`); the user ticked "Let it see this slide" for this turn, or chose an action that says so ("Check how this slide looks"); the deck is not in offline mode.
3. The consent line under the composer changes while the box is ticked: "Sends a picture of slide 3, including any photos on it, to <host>." Pictures in the deck leave the machine only through this picture; the asset elision in `material.ts` is unchanged.
4. Extension side (`home/webext/src/providers.js`, `assistant.js`): shape an image part per provider and forward it only on turns that carry one. The on-device model gets none.
5. One look per turn, and one more after a fix, as the reference practice says. The agent loop must not request pictures in a loop.

## Acceptance criteria

- [ ] With no host, Check deck offers at least the four deterministic fixes above, each applying as one undo step, and no control mentions a model.
- [ ] "Ask the assistant" on a finding sends a turn whose focus is that finding's element, and the result arrives as an AS-07 proposal, not a direct commit.
- [ ] "Review this deck" returns prose that references findings by slide number and changes nothing.
- [ ] The material contains `image` only when the user opted in for that turn and `describe.vision` is true; a rig asserts its absence in every other case.
- [ ] The image is bounded in pixels and bytes, and the bound is asserted.
- [ ] The consent line names the slide and the host whenever a picture will be sent.
- [ ] Asset elision is unchanged: no `data:` URI from `doc.assets` appears in any frame; only the rendered picture does.
- [ ] `scripts/test-export-secrets.ts` passes unmodified.
- [ ] Offline mode: no picture is rendered for sending and no turn starts.

## Tests

- Extend `scripts/test-slides-assistant.ts`: finding-to-turn focus; `image` gating (four combinations of opt-in and `vision`); size bound; no asset data in frames.
- Extend `scripts/test-webext-assistant.ts`: an image part is shaped for each hosted provider and never for `builtin`.
- Add `scripts/test-slides-check-fixes-browser.mjs`: each deterministic fix on a fixture deck, measured by geometry after the fix (not by reading back a style).

## Out of scope

New checker rules (F-08, F-09). Automatic fixing without the user's click. Sending the whole deck as pictures. Critique of content or argument.

## Notes for the implementer

- Part A's deterministic half needs no one's permission and should land first; it is useful on its own. Part B adds a field to the maintainer's bridge contract and a request shape to their shipped extension: ask before proposing it upstream.
- "AI is additive, never load-bearing" is the design here: the checker and its fixes are the load-bearing part.
- The page never holds a key. The picture travels the same road as the outline, through the host.
- The design-system rule (`issues/00-READ-FIRST.md` §6) says a contrast or density issue inside the user's own system is reported, not fixed. Deterministic fixes are offered, never applied unasked, and "Use the theme's text colour" must bind to the slot, not write a literal.
- Sending a picture is a privacy step-up from the PR's position that pictures stay on the machine. Keep it per turn, visible, and off by default.
- Byte cost against the 15 KB target (currently +24.5 KB): the fix column belongs to F-10's panel, not the Assistant; count it there.

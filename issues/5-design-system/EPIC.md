---
id: EPIC-5
title: "Epic 5: the design system, for people who never used Figma"
labels: [epic, "area:design-system"]
---
## Goal

1.3.0 gave bento/slides auto-layout frames, components and design tokens. They work, but they are reachable only if you already speak Figma: the words are Hug, Fill, Frame and Token, the controls are unlabelled icons, and the things a non-designer wants ("make these three boxes equal", "reuse this card", "dark version of my colours") take many steps or cannot be done. This epic makes the same machinery usable by someone coming from PowerPoint or Google Slides, and then deepens it where Figma and Penpot are still ahead.

## Why it matters (from the hands-on audit of 1.3.0)

- **Three equal cards takes about nine steps.** ⇧A keeps unequal widths; the control that would equalise them is an unlabelled icon pair, disabled while the frame hugs, and absent on a multi-selection.
- **Components are buried.** They sit under roughly 25 token rows in the icon-only Tokens tab, with no thumbnail and an Insert button only.
- **A dark mode cannot change the theme colours.** The seven theme colours hold one value for every mode, and editing one while Dark is showing changes Default too, silently.
- Chips that say a property is bound hide what it is bound to; the built-in "Three cards" layout is plain groups; a frame adopts a drawn shape only when the frame itself is selected.

## Children, in recommended order

Bugs and one-step wins first, then the features, then the format proposals.

- [ ] **DS-05** Editing a theme colour in a non-default mode silently overwrites every mode (bug, P1, S)
- [ ] **DS-08** Add mode scrolls the left panel sideways and clips headings (bug, P2, S)
- [ ] **DS-09** Top toolbar jumps sideways when the selection changes (bug, P2, S)
- [ ] **DS-03** Frames adopt what is drawn or dropped onto them (P1, S)
- [ ] **DS-01** Auto layout presets; Fill on a multi-selection; worded sizing labels (P1, M)
- [ ] **DS-07** Token chips show value and name; usage counts are labelled (P2, S)
- [ ] **DS-04** Library tab: components with thumbnails, search, drag to place (P1, M)
- [ ] **DS-10** Worded Arrange menu and Tidy up (P2, M)
- [ ] **DS-02** Built-in Three cards and Two columns layouts become auto-layout frames (P2, M)
- [ ] **DS-11** Design-token import and export (P2, M)
- [ ] **DS-06** Per-mode theme palette (P2, M, format change)
- [ ] **DS-12** Proposal: token aliases and text styles (P3, L, format change)
- [ ] **DS-13** Proposal: component variants, properties and swap (P3, L, format change)
- [ ] **DS-14** Proposal: frame children placed absolutely, per-child alignment, grid spans, max size (P3, L, format change)

## Dependencies

- **F-01** (built-in layouts and new elements follow the theme) edits the same `builtinLayouts` code as DS-02; land F-01 first or do both in one sitting.
- **F-05 / F-06** (commands registry, palette synonyms) are where DS-01's and DS-10's new commands become findable by "equal", "tidy", "distribute".
- **AI-10** (frames for agents: equal-height rows, stretch with hug) shares the solver with DS-01 and DS-14.
- **DS-06** needs DS-05's wording removed once it lands; **DS-11** should export whatever DS-06 and DS-12 add.
- DS-12, DS-13 and DS-14 are proposals: agree the format in the issue before any code.

## Constraints that apply to every child

- No new element type or shape kind, no format version bump (`docs/DECISIONS.md` line 12040 onward, "everything new is additive").
- Frames, tokens and components are **derived, not committed** (`slides/src/derive.ts`): one derive pass must stay a fixed point, and every replica must compute the same result. `scripts/test-slides-derive.ts` and `scripts/test-slides-layout.ts` guard this.
- **A 1.3.0 shell normalises `theme.tokens` when it opens a file** (`slides/src/restoregate.ts:247-252` calling `tokens()` at `:75-103`): any key under `theme.tokens` other than `set`, `modes`, `mode` is dropped, any key on a token other than `type` and `values` is dropped, and a token whose `type` is not one of the six known types is dropped entirely. Any format addition near tokens must survive that, or say plainly what is lost.
- The gate keeps only known sub-keys of `component`, `sizing` and `layout` on intake (`slides/src/untrusted.ts:498`, `:546-553`).

## Definition of done

- A first-time user can make three equal cards from three loose rectangles in at most two actions, with no Figma vocabulary required.
- Components can be found, recognised by picture, and placed by dragging.
- A deck can carry a light and a dark set of theme colours, or the UI says clearly that it cannot.
- Every child issue's acceptance criteria are met, each with its rig registered in CI, strings in all eight catalogs, and the shell's byte cost recorded.

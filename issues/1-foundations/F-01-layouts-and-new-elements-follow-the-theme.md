---
id: F-01
title: "Built-in layouts and new elements follow the deck theme"
epic: 1-foundations
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:design-system"]
depends_on: []
related: [F-02, AI-09, SC-05, DS-02]
upstream: []
---
## Summary

Built-in layouts, new text boxes and new shapes are written with hard-coded colours and a hard-coded font stack. Nothing binds them to the deck's theme, so changing the theme changes none of them. Bind them to the palette slots and the theme font, using the reference mechanism the format already has.

## What the user experiences

A newcomer starts a blank deck, applies the Title layout, then opens Tokens ▸ Theme and changes Background, Text and Accent 1. The slide stays white with a navy title and an orange bar. The token rows say "Nothing follows Background yet". Getting a coherent different look means re-colouring every slide and element by hand. An agent using layout-by-role gets the same white-and-navy slides whatever the deck's theme is, and a dark slide background makes the navy text unreadable.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. File menu (the bento/slides wordmark) ▸ Start from scratch…, confirm.
3. Right panel ▸ Layout ▸ pick **Title**. Type a title.
4. Left panel ▸ Tokens tab ▸ Theme: change **Background**, **Text** and **Accent 1** to clearly different colours.
5. Result: the slide does not change. Expected: background, title colour and accent bar follow.
6. Press T, click the slide: the new text box is navy or near-white chosen by lightness, not bound to Text. Press R, click: the rectangle is `#F7A600`, not bound to Accent 1.

## Evidence

- Observed in the running app during the audit (first-deck journey; screenshot showed every theme colour changed and the Title-layout slide untouched).
- Confirmed in code now:
  - `slides/src/model.ts:1283` `ph()` writes `color: '#1E2A3A'` and `fontFamily: FONT_STACK` on every placeholder.
  - `slides/src/model.ts:1305` `bar()` writes `fill: '#F7A600'`; the `card()` helper below it writes `fill: '#F3F0EA'`.
  - `slides/src/model.ts:1357` `builtinLayouts()`: every layout has `background: '#FFFFFF'`, except Section divider (`'#1E2A3A'`, kicker `'#F7A600'`).
  - `slides/src/model.ts:975` `defaultText()` writes `color: '#1E2A3A'`, `fontFamily: FONT_STACK`; `:1169` `defaultShape()` writes `fill: '#F7A600'`.
  - `slides/src/editor/editor.ts:3787` the Text tool passes `color: readableInk(slide.background)`: a literal picked by lightness, with no reference.
  - The binding mechanism exists: `themeRefs` on elements (`model.ts:150`) and slides (`model.ts:653`), slots in `slides/src/palette.ts:41` (`bg1`, `tx1`, `bg2`, `tx2`, `accent1`…), re-derived by `resolveThemeRefs` (`palette.ts:319`, called from `derive.ts:51`). The text inspector's "Theme font" option is the empty-string font family (`editor/inspector/text.ts:240`).
- Not verified: how each released 1.2.x shell renders an element whose `fontFamily` is `''`.

## How others do it

- PowerPoint: layouts live on the Slide Master and use theme colours and theme fonts; Design ▸ Variants recolours every slide in one click.
- Keynote: Change Theme restyles every slide built from the theme's layouts.

## Proposed change

1. In `slides/src/model.ts`, give the layout helpers references alongside their literals: `ph` → `themeRefs: { color: 'tx1' }` and the theme font; `bar` → `themeRefs: { fill: 'accent1' }`; `card` → a `bg2` reference; each built-in layout slide → `themeRefs: { background: 'bg1' }`. Section divider inverts (background `tx1`, text `bg1`, kicker `accent1`); check contrast in both a light and a dark theme.
2. Keep writing a literal next to every reference, and make that literal the **resolved** value for the deck at the moment of insertion. A shell that predates palette references shows the literal, so it must be right. Either resolve inside `instantiateLayout` / `applyLayout` (pass the document or its palette) or run `resolveThemeRefs` in the same commit as the insertion.
3. `defaultText` / `defaultShape` callers in the editor (`editor.ts` tool commands, paste paths at `editor.ts:2899` and `:2907`) add the same references: text → `tx1` on a light-background slide; keep `readableInk` as the literal fallback only where the slide background is itself an unbound literal that the theme text colour would be unreadable on.
4. Do not change what an existing deck looks like: only newly instantiated layouts and newly created elements gain references.

Rejected: changing `resolveThemeRefs` to guess bindings for existing unbound literals (it would silently restyle users' decks).

## Acceptance criteria

- [ ] After Start from scratch + Title layout, changing theme Background, Text and Accent 1 changes the slide background, title colour and accent bar without touching the slide.
- [ ] Every built-in layout renders legibly (contrast ≥ 4.5:1 for placeholder text) under the default theme and under a dark theme (background `#101418`, text `#F5F7FA`).
- [ ] A text box from the Text tool and a rectangle from the Rectangle tool follow Text and Accent 1.
- [ ] The Tokens ▸ Theme usage counter for Background, Text and Accent 1 is non-zero after applying a built-in layout.
- [ ] Each written element still carries a literal equal to the resolved slot value (assert on the stored JSON).
- [ ] An existing deck opened before and after this change serialises byte-identically.
- [ ] `node scripts/test-slides-compact-layouts.ts` and `node scripts/test-layouts.ts` still pass.

## Tests

Add `scripts/test-slides-layout-theme.ts` (node, no DOM): for every `builtinLayouts()` entry, instantiate it into a document with a non-default palette, run `resolveThemeRefs`, and assert background, placeholder colour and bar fill equal the palette's `bg1`, `tx1`, `accent1`; assert literals equal resolved values; assert a pre-existing unbound slide is unchanged. Register it at the end of the slides slice in `.github/actions/validate-slides/action.yml`.

## Out of scope

- Theme presets and "apply to all slides" (F-02).
- Rebuilding layouts as auto-layout frames (DS-02).
- New layouts for agents (AI-09).
- Per-mode palettes (DS-06).

## Notes for the implementer

- Zone: slides app only. No format change: `themeRefs` already exists.
- Read `docs/DECISIONS.md` on palette references and the ` /a` opacity suffix (the fix in upstream #971 and `scripts/test-slides-alpha-refs.ts`): released shells re-derive a linked literal at boot, so test what a 1.2.x shell does with your output.
- Hot files: `slides/src/model.ts`, `slides/src/editor/editor.ts`. Coordinate with F-02, F-05 and SC-05.
- The compact loader fills defaults too (`slides/src/compactload.ts`); AI-08 covers making those come from the deck theme. Do not duplicate it here.

---
id: FH-04
title: "Style part of a line: colour, size and font on a text run"
epic: 8-first-hour
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:text", "format-change"]
depends_on: []
related: [FH-03, F-01, AI-02]
upstream: ["nyblnet/bento#725"]
---
## Summary

A selection inside a text box can be made bold, italic, underlined, struck, code or a heading. It cannot be given a colour, a size or a font: those exist only for the whole box. Users expect "make this one word red" from every presentation tool. Upstream discussion #725 asks for exactly this and has no maintainer reply yet.

## What the user experiences

Select a word, open the inspector, change Fill or the point size. The inspector field takes focus, the text edit ends, and the whole box changes. There is no control in the floating format bar for colour or size.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Double-click the title on slide 1 and select one word.
3. The floating bar offers bold, italic, underline, strike, code, H1, H2, lists, indent, outdent, clear. No colour, size or font.
4. With the word still selected, click the Fill swatch in the Text section of the inspector and pick red.
5. The edit has ended and the entire title is red. `window.bento.doc` shows `color` changed on the element; `html` is unchanged.

## Evidence

- **Seen (journey 1):** steps 2–5; the whole box turned red at 30pt.
- **Confirmed in code now:**
  - `slides/src/render.ts:394-397` — `ALLOWED_TAGS` is `B I U BR SPAN DIV P STRONG EM S CODE UL OL LI H1 H2 A`.
  - `slides/src/render.ts:416-424` — "No attribute survives" except a web `href` on an anchor: every attribute, including `style`, is removed on every pass. A `<span style="color:…">` therefore cannot be stored.
  - `slides/src/editor/richtext.ts:43-47, 126-127, 136` — the format bar's command kinds are `exec`, `block`, `indent`, `code`, `clear`; none carries a value. The bar keeps the selection alive on its own mousedown (`:90`).
  - `slides/src/model.ts:278-282` — `TextElement.html` is documented as sanitized inline HTML; colour, size, family and weight are element-level keys.
- **Unverified:** how the inspector ends the edit (focus moving to a panel field triggers the editable's `blur` → `commitTextEdit`, `canvas.ts:2313`; not traced control by control).

## How others do it

- **PowerPoint:** the mini-toolbar on a selection has font, size, colour; the ribbon acts on the selection. Format Painter copies run formatting.
- **Keynote:** the Format ▸ Text sidebar applies to the selected range.
- **Figma, Penpot:** mixed styles inside one text layer; the panel shows "Mixed" and edits apply to the selection.

## Proposed change

This is a format addition. Propose it before building for upstream.

**Format.** Allow a `style` attribute on `SPAN` only, reduced to a fixed allowlist of declarations:

- `color`: must pass the same colour gate every other colour passes (`cssColor`); nothing with `url(`, `var(`, `expression`.
- `font-size`: a number with `em` or `%` (relative to the box, so the element's `fontSize` still scales the whole box and `shrink`/fit keep working). Reject `px`.
- `font-family`: one of the deck's font stacks or an embedded face name, through the font gate.
- Optionally `background-color` (highlight), same colour gate.

Everything else in `style` is dropped. Old shells strip the attribute and show the run in the box's own style: nothing breaks, the styling is simply absent. Say that in the PR.

**Where.**

1. `render.ts` `sanitizeHtml`: parse and re-serialise the allowlisted declarations for `SPAN`; keep "no attribute survives" for every other tag. `untrusted.ts` (the gate for pasted and loaded documents) calls the same sanitizer; add cases there.
2. `scripts/test-sanitize.ts`: hostile `style` payloads (`url()`, `position:fixed`, `expression`, `;` smuggling, nested quotes, `</style>`). The egress rigs (`test-slides-css-egress*`, swatch egress) must stay green: no document string may cause a fetch.
3. `richtext.ts`: add a colour swatch and a size stepper to the format bar (new command kind carrying a value). Apply by wrapping the selection in a span; merge adjacent identical spans; "clear formatting" removes them.
4. Inspector (`slides/src/editor/inspector/text.ts`): while a range is selected inside an open edit, Fill and size act on the range. That requires the panel not to end the edit: keep the selection on panel `mousedown` the way the format bar does, and restore it after the control commits. When the selection is collapsed or the box is not being edited, behaviour is unchanged.
5. Theme bindings: a run colour should be bindable to a palette slot or token the way element colours are (`themeRefs`). That needs a design: `themeRefs` is keyed by property path, not by text run. Minimum for a first PR: literal run colours only, and say so. Do not invent a binding syntax without agreeing it.
6. Morph and the PowerPoint converter (`convert/`) read text html: check both degrade to the box style.
7. `docs/format.md` and `docs/agents.md`: document the allowlist. Regenerate nothing: `html` is not a new key.

New strings (format bar tooltips) go in every catalog.

## Acceptance criteria

- [ ] Selecting a word and choosing a colour stores `<span style="color:…">` around that word only; the element's `color` is unchanged.
- [ ] The same for size (stored relative) and font family.
- [ ] The styling survives save, reload, copy and paste between slides, undo and redo, and live-collaboration merge of an unrelated edit.
- [ ] `sanitizeHtml` drops every declaration outside the allowlist and every `style` on non-`SPAN` tags; the hostile corpus produces no surviving payload and no network request.
- [ ] Clear formatting removes run styles.
- [ ] `validate()` and `measure()` account for run sizes (a bigger run changes the measured height).
- [ ] A 1.3.0 shell opens the file and shows plain text in the box's style.
- [ ] The inspector shows a mixed state when the selection spans different run styles.

## Tests

- Extend `scripts/test-sanitize.ts` (node) with the allowlist and hostile cases.
- Add `scripts/test-slides-run-style-browser.mjs`: real selection, format bar and inspector paths, round trip through `window.bento.read()` and `loadDoc`.
- Extend the CSS egress browser rig with a styled-run document.
- Old-shell check in the manner of `scripts/test-slides-alpha-refs.ts`: pin the released sanitizer's behaviour (attributes stripped) so the degradation claim is tested, not asserted.

## Out of scope

- Binding run colours to tokens (needs its own design).
- Paragraph-level styles (alignment per paragraph, spacing).
- Format Painter.

## Notes for the implementer

- Zone: slides app (`render.ts` is shared by all surfaces). No kernel change expected.
- This is the widest security surface in the epic: text html is the main channel for hostile documents. Read `docs/security.md`, the sanitize entries in `docs/DECISIONS.md`, and upstream fixes #969 and #970 first.
- Upstream: reply in discussion #725 with the format proposal before opening a PR there.

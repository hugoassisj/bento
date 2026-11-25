---
name: bento-slides
description: >-
  Creates and edits bento/slides presentations: single-file .bento.html decks
  whose document is JSON in a "#bento-doc" script block. Use when the user asks
  for a slide deck, slides or a presentation, or wants a .bento.html deck
  changed, extended, restyled, checked or fixed. Reads the deck's own design
  system first (theme, palette slots, design tokens, components, layouts,
  fonts) and reuses it instead of replacing it; maps source material to charts,
  tables, morph transitions and click builds rather than bullet text; lays
  slides out with layouts, roles and auto-layout frames instead of hand-picked
  coordinates; and checks the result with the app's own validator and by
  looking at every slide.
---

# bento/slides decks

A deck is one self-contained `.bento.html` file: the app plus the document,
plain JSON in one block. You change the JSON; the app renders it.

## 1. The file contract

These rules protect the user's file. They are absolute.

- **The document lives in one block**:
  `<script type="application/bento+json" id="bento-doc"> … </script>`.
  Change the JSON inside it and nothing else in the file. Never regenerate the
  HTML around it (it is the compressed app, and it updates itself).
- **Escape every `<` in the JSON as `\u003c`** when you write the block, so it
  can never contain `</script>`. `JSON.parse` reads the escape back.
- **Check `format` first.** `"bento/slides"` is this skill. `"bento/enc"` is a
  password-protected deck: it cannot be read or edited as JSON; tell the user.
  Any other format is another bento app: do not guess at its shape.
- **The file always holds the full form.** The compact form (`"compact": true`,
  layouts and roles, omitted defaults) goes in only through the app:
  `window.bento.loadDoc(json)` or *Replace from JSON…*. Written straight into
  the block, a compact document is read as a full one: without `format` it is
  refused and the app opens its own starter deck instead; with `format`, an
  element missing a key its type needs is dropped, and one with `type` and
  `html` is kept but nothing places it (its `role` is ignored).
- **Only `"format": "bento/slides"` and a non-empty `slides` array are
  required.** Everything else above the element level is filled from the
  editor's defaults (a 1280×720 canvas, a white slide, the system font stack),
  so write `size` and `theme` because you are choosing them.
- **Handle `collab` by name only.** It holds the deck's live-session
  credentials (minted when a deck is created, so present before any sharing),
  and any key in it is access to the live room. List its field names without
  their values, read the document without it, and write it back exactly as it
  was; a file without it drops out of its room. Tell the user the deck carries
  live-session keys; if they leaked, *Share → Reset access…* revokes them.
- **Pictures are the last line.** A deck saved by a current shell writes its
  `assets` map (embedded pictures, fonts, files as data URIs) last, starting on
  its own line. Stop reading at the line that starts `"assets":`, or drop the
  key when you parse; put it back unchanged when you write.
- **Never regenerate `docId`**: it is the document's identity for recovery and
  sync. A new deck omits both `docId` and `collab`; the app mints them on first
  open.
- `template: true` makes every open mint a fresh deck; `readonly: true` opens
  straight into the show with no editor. Leave both as you found them.
- **Keep what you do not recognise.** A deck written by a newer shell may carry
  keys this skill does not describe; they are the user's data.

**Getting a file to write into.** Work in the user's `.bento.html`. With none,
ask for one, or, with network access and the user's agreement, download the
empty app (`references/editing.md`). That is the only step that touches
the network.

**In a chat, with no file access**, the user moves the JSON by hand: the File
menu (the bento/slides wordmark, top left) has *Copy document JSON*, *Copy
compact JSON (for agents)* and *Replace from JSON…* under "Advanced", and ⌘K
(Ctrl+K) finds them by name. Copies made this way leave `collab` out, and
*Replace from JSON…* keeps the open deck's identity and session. It takes the
compact form too, the shortest whole deck you can return.

## 2. Precedence: the deck's design system wins

Whose choice counts, in this order:

1. what the user said in this conversation;
2. what the deck defines (its theme, palette, tokens, components, layouts,
   fonts);
3. what the deck already does (its margins, sizes, colours and spacing as used
   on its slides);
4. this skill's defaults (`references/design-defaults.md`).

Look for the deck's system in this order before you write anything:

1. `theme`: `background`, `color`, `accent`, `fontFamily`, and the optional
   `palette` (`bg2`, `tx2`, `accent2` to `accent6`, `hlink`, `folHlink`),
   `chartPalette`, `table` and `codePalette`;
2. `theme.tokens`: its `set` of named values and its `modes`;
3. how much of the deck is bound: `themeRefs` on elements and slides;
4. components: elements carrying `component` (a `main` and its copies);
5. `layouts`: the deck's own slide templates;
6. `fonts`: the faces the deck carries.

**A system exists if `theme.palette`, `theme.tokens`, any `themeRefs`, any
`component`, `layouts` or `fonts` is non-empty.** Even without one, the
theme's colours and fonts are the deck's choices, not a blank to fill.

When a system exists:

- Bind what you add. Write the literal **and** a `themeRefs` entry together,
  with the literal equal to the token's (or slot's) current value:
  `"color": "#1E2A3A", "themeRefs": { "color": "$ink" }` for a token,
  `"fill": "#F7A600", "themeRefs": { "fill": "accent1" }` for a palette slot.
- A colour or size you will reuse that the system lacks becomes a new token,
  named in the hand-off; a one-off can stay a literal. Do not edit an existing
  token's value to get it.
- Leave the theme, tokens, modes, palette slots, fonts, component mains and
  layouts as they are unless the user asks you to change them.
- Reuse before you build: a copy of an existing component instead of a
  look-alike, one of the deck's own layouts instead of a built-in.
- Do not "fix" contrast, density or type sizes inside the user's system.
  Report what you noticed and let the user decide.

`references/design-system.md` has the mechanics: token types and modes,
palette refs and shifts, components, frames and fonts.

## 3. Workflow

**Inspect → plan → author → check → look → apply.** Tools: when this skill's
folder has `scripts/bento.mjs`, it is the default (`node scripts/bento.mjs
--help` lists its verbs). Otherwise the fallbacks are `editing.md`'s
`inspect.mjs` and `splice.mjs` and, with a headless browser, `app.md`'s
`drive.cjs`, which loads, checks, photographs and saves in one call.

1. **Inspect.** Find the block, check `format`, list `collab` field names, set
   `assets` aside, and record `size`, the system (section 2), the slide ids and
   what each slide holds, without printing a key or a picture.
2. **Plan** every slide before writing any: the material, the feature that
   carries it (section 4), its layout (the deck's own first), and the tokens,
   slots and components it reuses. Then write the whole document in one go.
3. **Author.** Prefer what places things for you over coordinates:
   - with a browser, write the **compact form** and load it with
     `window.bento.loadDoc(json)`. It replaces the whole document, so start an
     edit from `window.bento.read({ compact: true })`. A slide's `layout` and
     its elements' `role` place their content (section 5); a text box without
     `h` is sized to its text; `md` replaces `html`;
   - for rows, columns, grids and cards, use an **auto-layout frame**: the
     app computes the children's boxes, in the file as well as in a browser;
   - write `x y w h` yourself only where no layout or frame fits.
   Without a browser, write the full form, copying geometry from the deck's
   own layouts and slides.
4. **Check.** `loadDoc` returns a report: `dropped` lists every key, element
   or role the loader discarded or re-placed, and `findings` is
   `window.bento.validate()` (overflow, off-canvas, broken links and refs,
   unknown keys). Fix and load again until nothing you caused remains.
   `past-margin`'s `margin` is in 1280-wide units, scaled to the deck (the
   default 96 is 120 px on a 1600-wide deck): for 80 px sides there pass
   `window.bento.validate(undefined, { margin: 64 })`, or `0` to turn it off. Before a browser you drive opens a deck that
   carries `collab` keys, set `localStorage['bento-offline'] = 'on'` (before
   the page loads), or it can join the deck's live room and your edits reach
   everyone in it.
5. **Look** at every slide: overflow, crowding, a heading wrapped to three
   lines and a chart that ignored a key are invisible in the JSON. `drive.cjs`
   writes one picture per slide; by hand, the arrow keys walk the slides in the
   editor (nothing selected), and the File menu's *Export slides as images…*
   writes one picture per slide in the show, leaving out hidden and state
   slides.
6. **Apply.** From the browser, `window.bento.serialize()` returns the whole
   file; write it to the deck's path. Without one, splice the full JSON into
   the block. Hand off what changed, the tokens
   you added, and the findings you left and why.

**With no browser at all** you cannot check or look. Say so plainly in the
hand-off, check your JSON against section 5, and ask the user to open the deck
and page through it.

## 4. Material to feature

The format's value is motion, charts and structure. Before writing a slide,
classify the material and pick the feature built for it.

| Material | Feature | Reference |
|---|---|---|
| numbers to compare (trend, magnitude, share) | a `chart` element | `data.md` |
| a comparison, spec, pricing or feature grid | a `table` element | `data.md` |
| the same thing changing across slides | morph: shared ids and `"transition": "morph"` on the later slide | `motion.md` |
| points revealed one at a time | a click build: `fx.step` on the elements | `motion.md` |
| a detail to drill into | a state slide (`stateOf`) reached by an element `link` | `motion.md` |
| a full-slide photograph | full-bleed image, scrim, text, a ken-burns drift | `motion.md` |
| a sequence, flow or timeline | a line or path with a `dash-march` loop, or a highlight morphed through the steps | `motion.md` |
| a headline number | large text with `fx.countUp` | `motion.md` |
| repeated chrome or a logo | the same element `id` on every slide, so it stays put across morphs | `motion.md` |
| code that changes between slides | a `code` element, morphed token by token | `data.md` |
| a formula | `$…$` (inline) or `$$…$$` (display) in text | `data.md` |
| a clip, recording or soundbite | a `media` element | `data.md` |
| cards, rows of stats, a grid of logos | an auto-layout frame, or a component the deck already has | `design-system.md` |

Motion is restrained by default: a build or a morph that explains a step,
rarely an ambient loop. A viewer who asks for reduced motion (their system
setting, or M in the show) gets no motion at all, so every slide has to read
in its final state. Speaker notes (`notes`) travel in the file: the talk track.

## 5. Gotchas

Each of these fails silently: nothing errors, the deck just comes out wrong.

1. **A token-bound literal that differs from its token loses the binding.**
   When the file opens (and after `loadDoc`), an element whose literal does not
   equal its `$token` value keeps the literal and drops the `themeRefs` entry.
   So does every use of a token whose value, or the active `mode`, you change
   in the JSON alone: the uses keep their old literals and stop following.
   Change tokens in the app's Tokens tab, or rewrite every bound literal in the
   same edit. A palette slot works the other way round: a literal bound to a
   slot is rewritten to the slot's colour on open (keeping its own opacity),
   so editing a slot in the JSON recolours every use, and a literal you
   hand-wrote under a slot ref is replaced.
2. **A component copy without `sig` turns every difference into an override.**
   A copy with no `sig` reads its main as unmoved, so each key where it differs
   from the main is recorded in `component.over` and stops following the main.
   Write a copy as an exact duplicate of the main's elements and change only
   the keys you mean to override.
3. **Frame children order by coordinate, then by array order.** Inside an
   auto-layout frame the children are laid out by their current `x` (a row) or
   `y` (a column), ties kept in array order. To set the order, give the
   children the same `x` and `y` and list them in the order you want; list the
   frame before its children, since later elements paint on top.
4. **A dangling `parentId` is removed silently.** A child whose `parentId`
   names no frame on its slide becomes an ordinary element at its own `x y`,
   with no finding.
5. **Chart series data must be plain numbers.** Bar and line `data` arrays take
   JSON numbers; an object (`{ "value": 4 }`) or a numeric string renders as 0.
   Only a pie series takes `{ "name", "value" }` items.

And a few more that cost a guess each time:

- **A role-placed element keeps only its content.** Placing by `role` copies
  the layout's element and takes only `html` (an image's `src`, `fit`, `crop`)
  and `link` from yours; your colour, font and `themeRefs` are dropped, and a
  built-in layout brings a white slide, dark text and the system stack. On a
  themed deck, place by role only into the deck's own `layouts` (full slides,
  `transition` included) whose elements carry the bound styles, or give the
  element `x y w h`, no `role`, and its bound `color` and `fontFamily`.
- **An omitted field means different things in the two forms.** In the full
  form a text box without `fontFamily` renders in `theme.fontFamily`. In the
  compact form an omitted field is the editor's default: the system font
  stack, and a text `color` that is a plain readable ink for the slide
  background, not `theme.color`. Write both on compact text, bound.
- **Unknown keys are ignored.** A typo (`fontSze`) simply does not apply; the
  load report's `dropped` and validate's `unknown-key` name it.
- **The show draws its own page counter and progress bar.** If the slides
  number themselves (a `{{page}}` footer), set
  `"present": { "slideNumber": false }`, and `"progress": false` if the design
  has its own progress mark.
- **Faces the app carries.** A `doc.fonts` entry may name
  `builtin:fraunces-900` (Fraunces at 900) or `builtin:instrument-sans`
  (Instrument Sans, 400 to 700) as its `asset`, with `weight` a string
  (`"900"`; a number is dropped). Any other face must be embedded, or viewers
  without it get the fallback (`font-not-embedded`).

## 6. Element essentials

Every element has `id`, `type`, `x`, `y`, `w`, `h`, `rotation` and `opacity`
(px on the deck's `size`; the canvas is usually 1280×720). The full form needs
each type's own content and styling keys:

| `type` | Keys you write |
|---|---|
| `text` | `html`, `fontSize`, `fontWeight`, `color`, `align`, `valign`, `lineHeight`; optional `fontFamily`, `letterSpacing`, `role` |
| `shape` | `shape` (`rect`, `ellipse`, `triangle`, `arrow`, `line`, `path`), `fill`, `stroke`, `strokeWidth`, `radius`; `d` and `pathBox` for a path; `layout` with `dir`, `gap` and `pad` makes a rect a frame |
| `image` | `src` (`asset:<key>` or a data URI), `fit`, `radius` |
| `chart` | `preset`, `option` |
| `table` | `columns`, `rows`, `header`, `style` |
| `code` | `content`, `grammarName`, `fontSize`, `color`, `align`, `valign`, `lineHeight`; no `fontFamily`, so `theme.codeFontFamily` applies |
| `media` | `kind`, `src`, `poster`, `controls`, `autoplay`, `loop`, `muted` |
| `svg` | `markup` or `asset` |

Text `html` keeps `b strong i em u s code br span a p div h1 h2 ul ol li` and
strips every attribute except an `http(s)` `href` on `a`. A slide is `id`,
`background`, `transition` (`none`, `fade`, `slide`, `zoom`, `morph`),
`notes` and `elements`; elements paint in array order, last on top. In the
app, `window.bento.schema()` returns the whole format as JSON Schema.

## 7. References

Read a reference when its trigger applies; each stands alone. They sit in the
`references/` folder beside this file; a copy of `SKILL.md` installed on its
own lacks them, and sections 1 to 6 still hold without them.

- `references/design-system.md`: read when the deck has tokens, palette slots,
  `themeRefs`, components, its own layouts or fonts, or when you build a row,
  grid or card with a frame.
- `references/design-defaults.md`: read when you are creating a deck from
  nothing, or the deck leaves a choice (margins, type scale, colour, motion)
  undecided.
- `references/motion.md`: read when the material changes across slides, is
  revealed step by step, drills into detail, or needs an entrance, a loop or
  hover behaviour.
- `references/data.md`: read when the material has numbers, a grid of values,
  code, a formula or a clip.
- `references/editing.md`: read when you read or write the file on disk
  (`inspect.mjs`, `splice.mjs`, ids) or need the empty app.
- `references/app.md`: read when you can run a headless browser
  (`drive.cjs`: load, check, photograph and save in one call).

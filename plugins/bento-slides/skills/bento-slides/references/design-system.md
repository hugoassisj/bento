# The deck's design system: how it works

Read this when the deck has palette slots, tokens, `themeRefs`, components,
its own layouts or fonts, or when you build a row, grid or card with a frame.
The rule from `SKILL.md` holds throughout: what the deck defines is the
user's, so reuse it and report what you would change.

## Bindings: the literal stays, `themeRefs` records its source

An element (or a slide's `background`) keeps its literal value in the file. A
`themeRefs` map beside it records where the value came from, keyed by property
path:

```json
{ "id": "badge", "type": "shape", "shape": "rect", "x": 96, "y": 96, "w": 240, "h": 64,
  "fill": "#F7A600", "stroke": "#1E2A3A", "strokeWidth": 2,
  "themeRefs": { "fill": "accent1", "stroke": "$ink" } }
```

- A path is a property name, or a dotted path into one:
  `fillGradient.stops.0.color`, `shadow.color`.
- An element property can be bound when its name is one of `fill`,
  `fillGradient`, `fills`, `stroke`, `strokeWidth`, `strokeGradient`,
  `strokes`, `strokeDashes`, `radius`, `radii`, `opacity`, `color`,
  `colorGradient`, `textStroke`, `fontSize`, `fontFamily`, `fontWeight`,
  `letterSpacing`, `lineHeight`, `shadow`, `blur`, `backdropFilter`,
  `layout`, `w`, `h`, `style`. On a slide, only `background`.
- A shell that knows nothing of bindings reads ordinary literals, which is why
  the literal has to be right: write it equal to what the ref resolves to.
- What the app does on open, and what silently undoes a binding, is gotcha 1
  in `SKILL.md`.

## Palette slots

The theme's colours are named slots, mirroring a PowerPoint colour scheme:

| Slot | Where its colour lives | When the deck does not set it |
|---|---|---|
| `bg1` | `theme.background` | a required theme field |
| `tx1` | `theme.color` | a required theme field |
| `accent1` | `theme.accent` | a required theme field |
| `bg2` | `theme.palette.bg2` | `theme.color` |
| `tx2` | `theme.palette.tx2` | `theme.background` |
| `accent2`, `accent3`, `accent4`, `accent5`, `accent6` | `theme.palette.accent2` to `.accent6` | `theme.accent` |
| `hlink`, `folHlink` | `theme.palette.hlink`, `.folHlink` | empty: a ref to it does nothing |

A palette ref is the slot name, optionally shifted in lightness by up to 100
percent: `"accent1"`, `"accent2 -19%"` (darker), `"bg2 +40%"` (lighter). The
bound literal keeps its own opacity: a translucent fill linked to `accent1`
stays translucent. The app may append ` /a` to a ref whose field keeps its own
opacity; leave it there.

A deck that sets `theme.palette` slots, or binds to them, has chosen its
colours by slot. Bind new colours to those slots (with a shift for a tint)
rather than writing new hex values.

## Design tokens

`theme.tokens` holds named values of six types and, optionally, modes:

```json
"tokens": {
  "modes": ["light", "dark"], "mode": "light",
  "set": {
    "ink":        { "type": "color",      "values": { "light": "#1E2A3A", "dark": "#F2F0EA" } },
    "space.gap":  { "type": "number",     "values": { "light": 16, "dark": 16 } },
    "size.body":  { "type": "fontSize",   "values": { "light": 24, "dark": 24 } },
    "font.body":  { "type": "fontFamily", "values": { "light": "'Instrument Sans', system-ui, sans-serif", "dark": "'Instrument Sans', system-ui, sans-serif" } },
    "dim":        { "type": "opacity",    "values": { "light": 0.6, "dark": 0.6 } },
    "shadow.card":{ "type": "shadow",     "values": { "light": { "y": 14, "blur": 34, "color": "rgba(30,42,58,0.10)" }, "dark": { "y": 14, "blur": 34, "color": "rgba(0,0,0,0.4)" } } }
  } }
```

- The types are `color`, `number` (any dimension: gap, radius, stroke),
  `fontSize`, `opacity` (0 to 1), `fontFamily` and `shadow`.
- A token name starts with a letter, then letters, digits, `.`, `-` or `_`,
  64 characters at most. A ref to it is `$` plus the name: `"$space.gap"`.
- Without `modes` the deck has one mode, `default`, and every value is keyed
  `"default"`. Without `mode` the first mode is active. A token with no value
  for the active mode uses the first mode that has one.
- A new token goes in `set` with a value for every mode; name it in the
  hand-off. Its uses are bound like any other.
- Changing a token's value or the active `mode` belongs in the app (the Tokens
  tab), where every bound literal follows. In the JSON alone it unbinds them
  (gotcha 1 in `SKILL.md`).

What `window.bento.validate()` says about bindings: `token-unknown` (a `$ref`
to a token the set lacks), `theme-ref-malformed`, `theme-ref-unknown-slot`
(an empty slot), `theme-ref-dangling` (a ref on a path that holds no value)
and `theme-ref-stale` (a slot-bound literal that the next palette edit will
replace).

## Components

A component is a set of ordinary elements sharing `component.id`. The set
marked `"main": true` is the main; every other set with that id is a copy, one
copy per `groupId`. `component.key` pairs each copy element with its
counterpart in the main.

```json
{ "id": "btn-bg",    "type": "shape", "groupId": "g-btn",  "component": { "id": "button", "key": "k0", "main": true }, … },
{ "id": "btn-label", "type": "text",  "groupId": "g-btn",  "component": { "id": "button", "key": "k1", "main": true }, "html": "Start", … },
{ "id": "cta-bg",    "type": "shape", "groupId": "g-cta",  "component": { "id": "button", "key": "k0" }, … },
{ "id": "cta-label", "type": "text",  "groupId": "g-cta",  "component": { "id": "button", "key": "k1", "over": ["html"] }, "html": "Buy now", … }
```

- A copy takes every property from its main except its own `id`, `groupId`,
  `groupName`, `name`, `component`, `x`/`y` (it keeps an offset from the
  main), `morphId`, `parentId`, `sizing`, `locked` and `hidden`, and the keys
  listed in its `component.over`.
- `component.sig` is the copy's record of the main it last followed, and
  `component.off` its offset; the app writes both. A copy without `sig` keeps
  every difference from its main as an override (gotcha 2 in `SKILL.md`).
- To add a copy: duplicate every element of the main, give each a new `id`,
  give them one new shared `groupId`, keep `component.id` and each `key`,
  drop `main`, and move all of them by the same amount. Then change only the
  keys you mean to override (a label is `html`); the app records them in
  `over` when the file opens.
- A main sitting inside a frame of its own carries that frame into the copy:
  point the copy's `parentId` at the copy's own frame id.
- Editing a main changes every copy in the deck. Change a main only when the
  user asks for that; otherwise override on the copy.
- Removing `component` from a copy's elements detaches it: they keep their
  values and stop following.

## Auto-layout frames

A frame is a `rect` shape with a `layout`; the elements whose `parentId` names
it are laid out inside it. The app writes the children's boxes (and the
frame's own size when it hugs) every time the file opens and after every edit,
so the file stays ordinary positioned elements for any reader.

| `layout` key | Values |
|---|---|
| `dir` | `row`, `col` or `grid` |
| `gap` | px between children |
| `pad` | `[top, right, bottom, left]` in px |
| `justify` | main axis: `start`, `center`, `end`, `space-between` |
| `align` | cross axis: `start`, `center`, `end`, `stretch` (fills it) |
| `cols` | grid only: columns (2 when absent) |
| `hug` | the frame sizes itself to its children |
| `wrap` | row or column only: children that would pass the edge start a new line |
| `clip` | children are clipped to the frame |

A child's `sizing` is `{ "w": "fill" }` (or `"h"`) to take the frame's free
space on that axis, shared between the fill children; `minW` / `minH` give a
filling child a least size in a wrapping frame. Without `sizing` a child keeps
its own size.

```json
{ "id": "stats", "type": "shape", "shape": "rect", "x": 96, "y": 220, "w": 1088, "h": 240,
  "fill": "#F3F0EA", "layout": { "dir": "row", "gap": 32, "pad": [24, 24, 24, 24], "align": "stretch" } },
{ "id": "stat-1", "type": "shape", "shape": "rect", "x": 96, "y": 220, "w": 200, "h": 100, "fill": "#FFFFFF", "parentId": "stats", "sizing": { "w": "fill" } },
{ "id": "stat-2", "type": "shape", "shape": "rect", "x": 96, "y": 220, "w": 200, "h": 100, "fill": "#FFFFFF", "parentId": "stats", "sizing": { "w": "fill" } },
{ "id": "stat-3", "type": "shape", "shape": "rect", "x": 96, "y": 220, "w": 200, "h": 100, "fill": "#FFFFFF", "parentId": "stats", "sizing": { "w": "fill" } }
```

Here the three children share the row equally and stretch to its height.
Order and paint order are gotcha 3 in `SKILL.md`; a `parentId` that names no
frame is gotcha 4. In the compact form a frame's children may leave out `x`
and `y` entirely. Frames nest: a column of rows is a `col` frame whose
children are `row` frames.

## Layouts and roles

`doc.layouts` is the deck's own slide templates: full slides, the shape the
editor's *Save slide as layout* writes. Their text elements carry a
`placeholder` prompt and usually a `role`.

- In the compact form, a slide's `"layout"` names a built-in or one of the
  deck's layouts (by `id`, or by `name`), and each element's `role` picks the
  slot it fills. Slides made from one layout share its element ids, so their
  furniture holds still across a morph.
- Built-in layouts: `layout-title` (roles title, subtitle),
  `layout-title-content` (title, body; also `title-body`), `layout-two-col`
  (title, body, with `left` and `right` naming the two body slots; also
  `two-column`), `layout-section` (title, kicker), `layout-three-cards`
  (title, card1, card2, card3; also `cards`), `layout-quote` (quote,
  attribution), `layout-image-left` and `layout-image-right` (image, title,
  body), and `layout-blank`. The `layout-` prefix may be left out. They carry
  the editor's own look, not the deck's (see the gotchas in `SKILL.md`).
- A role the layout lacks falls back to the layout's body slot when it has
  one (with none, the element lands at the editor's default frame), and the
  load report's `dropped` says so either way. More body elements than body
  slots stack in the slot.
- Writing the file directly, reproduce a layout by copying its elements onto
  the new slide with their ids (ids need only be unique within a slide), and
  put your text in `html` in place of the `placeholder`.

## Fonts

- `theme.fontFamily` is the body face; a text box without `fontFamily` in the
  full form uses it. `theme.codeFontFamily` is the face for code elements.
- `doc.fonts` lists the faces the deck carries: `{ "family", "asset",
  "weight", "style" }`. `asset` is a key into `doc.assets` holding a woff2 data
  URI, or one of the two faces the app ships: `builtin:fraunces-900`
  (Fraunces, weight 900) and `builtin:instrument-sans` (Instrument Sans, 400
  to 700).
- A `fontFamily` naming a face the deck does not carry falls back silently to
  the next family in the stack for every viewer who lacks it, and it looks
  right to whoever has it installed. `validate()` reports it as
  `font-not-embedded`. Write a full stack, `"'Fraunces', Georgia, serif"`, so
  the fallback is one you chose.

# bento/slides — for AI agents

**Guide version `__APP_VERSION__`** · document format `bento/slides` (v1). This
guide matches the bento/slides shell of the same version. A deck's `#bento-doc`
JSON is always the source of truth — if it was written by a newer shell it may
carry features beyond this guide; unknown keys are ignored, never fatal.

> **Bento is a suite.** Slides is the first app; **Spaces**
> (`bento/spaces`, notes and wiki) ships alongside it. **Dash** (`bento/dash`,
> data and sheets) is in development, and a word processor is planned. Each ships
> as its own self-contained distributable — `Bento_Slides.bento.html`,
> `Bento_Spaces.bento.html`, and so on — with its own agent guide at
> `bento.page/<app>/agents.md`. **This guide covers Slides only.** Before you
> edit a file, check its `"format"` field and use the matching guide; if the
> format is one you have no guide for, don't guess at its shape.

**Contents.** [Make a great deck](#make-a-great-deck-not-just-a-correct-one) ·
[Minimal valid document](#minimal-valid-document) ·
[The compact form](#the-compact-form-write-only-what-you-choose) ·
[Load, read the report, fix](#load-read-the-report-fix) ·
[Check your deck](#check-your-deck-bento-check) ·
[The document schema](#the-document-schema) ·
[Element types](#element-types-all-share-idxywhrotationopacity) ·
[The rules that make decks feel designed](#the-rules-that-make-decks-feel-designed) ·
[Layout guardrails](#layout-guardrails) · [Layouts and `role`](#layouts-and-role) ·
[Dynamic fields](#dynamic-fields-tokens-in-text-html) ·
[Features, with an example each](#features-with-an-example-each) (click builds,
code and code morph, maths, frames, tokens and modes, components, paint
stacks) · [Gotchas](#gotchas) · [Field reference](#field-reference): every key
of the format, generated from the code.

*Drop this file into your context (or point your harness at it) and you can
author and edit Bento presentations directly. Also published at
[bento.page/agents.md](https://bento.page/agents.md). For **Claude Code**,
install the packaged **bento-slides** skill once and it triggers automatically
(or via `/bento-slides`) — it can even download the latest Bento app itself,
so a deck can be authored from an empty folder:*

```
/plugin marketplace add nyblnet/bento
/plugin install bento-slides@bento
```

*…or as a plain personal skill:*

```bash
mkdir -p ~/.claude/skills/bento-slides && curl -fsSL https://bento.page/skills/bento-slides/SKILL.md -o ~/.claude/skills/bento-slides/SKILL.md
```

*(claude.ai / Claude Desktop: upload
[bento.page/skills/bento-slides.zip](https://bento.page/skills/bento-slides.zip)
under Settings → Skills.)*

**Working without the skill, from an empty folder?** Download the app itself —
this is the file you write your document into:

```bash
curl -fsSL https://bento.page/releases/slides/Bento_Slides.bento.html -o "<Topic>.bento.html"
```

The downloaded file's `#bento-doc` block is **empty**. That is expected: opened
in a browser it mints a fresh showcase deck to get a new user started, but on
disk there is nothing to discard and nothing to copy from. Write your document
into the empty block.

A Bento deck (`*.bento.html`) is a self-contained HTML file. The document
lives in ONE plaintext block near the top:

```html
<script type="application/bento+json" id="bento-doc">
{ "format": "bento/slides", ... }
</script>
```

> ### Before you read a deck: it may carry its own keys
>
> If a deck has live collaboration switched on, its `#bento-doc` block contains
> a `collab` object with the credentials to that session. That is deliberate and
> it is what makes sharing work without accounts: **the file is the
> invitation**, so opening a copy joins the room.
>
> The consequence is easy to miss, because nothing about a document looks like a
> credential. Anything that receives the file receives the room: a chat, a
> ticket, a harness, a model provider's logs. Nothing about the authoring work
> needs the keys, so copies for agents leave them out:
>
> - **Any key in `collab` is access.** The room key alone reads the room live,
>   including everything the relay has stored, and on older (unsigned) rooms it
>   writes too. Private keys (`ownerPriv`, `writerPriv`, `invite`, `audience`)
>   add writing, inviting and removing members on top.
> - **A read-only copy is not key-free.** *Save read-only copy…* keeps the room
>   key, so it still opens the live room for whoever holds it.
> - **In the browser, read with `window.bento.read()`** (or
>   `window.bento.compact()`): the document with the sharing keys left out. In
>   the app, *Copy document JSON* in the File menu (the bento/slides wordmark,
>   top left) gives the same copy.
>   `window.bento.doc` and `serialize()` are the raw file and carry the keys.
>   `window.bento.validate()` reports any key as `collab-secrets-present`.
> - **Editing a file on disk:** check which `collab` fields exist by NAME without
>   printing their values (for example, a script that prints
>   `Object.keys(doc.collab ?? {})` only), read the document with `collab`
>   removed, and when you write back, restore the original `collab` object
>   exactly as it was. A file written back without it drops out of its room.
>
> If a deck with keys has already gone somewhere, the remedy is
> *Share → Reset access…*, which revokes the old room. Removing the keys after
> the fact does not retract them.

Two ways to work with it:

1. **File harness** (Claude Code, agent sandboxes): edit the JSON inside the
   `#bento-doc` block in place. Escape every `<` in the JSON as `\u003c`
   so the block can never contain a literal `</script>`. Leave everything else in the
   file untouched, and handle `collab` as the box above says: read without it,
   write it back exactly as it was.
2. **Chat round-trip** (any chatbot): the user copies the JSON out with
   *Copy document JSON* (or *Copy compact JSON (for agents)*), you return a
   full replacement document, and they paste it back with *Replace from
   JSON…* (undoable). All three are in the File menu, opened from the
   bento/slides wordmark at the top left, under the "Advanced" caption; or
   press ⌘K (Ctrl+K) and type the name.
   In the browser console: `window.bento.read()` (read, sharing keys left
   out) / `window.bento.loadDoc(json)` (write, undoable; the open deck keeps
   its own session).

**Reading a deck without its pictures.** A deck saved by a current version
of Slides keeps its picture data in the top-level `assets` map (elements say
`"src": "asset:<key>"`) and writes that map LAST, on its OWN line. Inside the
`#bento-doc` block:

```
{"$schema":…,"format":"bento/slides",…,"slides":[…],
"assets":{"a-3f2a":"data:image/jpeg;base64,/9j/4AAQ…"}}
```

One photo makes that second line megabytes long — far more than you can read
— so never read it: stop at the line that starts `"assets":`, or load the JSON
with a tool and drop the key (`jq 'del(.assets)'`; in Python
`doc.pop('assets', None)`), then put it back unchanged when you write. The
first line still holds `collab` if the deck has one, so handle it as the box
above says. To add a picture, add one entry to `assets` and reference it as
`asset:<key>`.

Don't count on that layout in every file, though. It is how a deck is written
from this version on; a deck last saved by an older version, produced by the
PowerPoint converter, or edited by hand may be a single line with `assets`
wherever the key fell, and older decks can carry a picture inline as a `data:`
`src`. Other Bento apps differ too: Type keeps a picture inline in its
document. If the block is not laid out as above, load the JSON with a tool and
set the picture data aside (`assets`, and any long `data:` string) rather than
reading the block as text.

---

## Make a GREAT deck, not just a correct one

**Read this section first — it is the difference between a wall of text and a
Bento deck.** The format's whole value is motion, morph, charts and
interactivity. A correct-but-static result (bullets on slides) wastes it and
is the #1 failure mode. The move is to look at the *source material* and map
each kind of content to the feature built for it:

| When the material is… | Reach for | Why |
|---|---|---|
| numbers to **compare visually** (trend, magnitude, share) | a **chart** element | bars/lines read instantly |
| a **comparison / spec / pricing / feature grid** (rows × columns of labels + values) | a **table** element | structured cells beat 20 hand-placed text boxes; it styles cohesively |
| consecutive slides about the **same thing changing** (before/after, process steps, a metric across stages) | **morph**: same element `id` on both slides + `transition:"morph"` on the later one | the shared elements glide; this is Bento's signature and is *almost always missed* |
| a point to **drill into** (a definition, "click to see how", a sub-topic) | a **state slide** (`stateOf` + element `link`) | keeps the linear story clean; the detail is one click away |
| a **hero / full-slide image** | full-bleed image + scrim rect + text, with **ken-burns** | static photos feel dead; a slow drift feels intentional |
| a **sequence / flow / timeline / connection** | a line or `path` with a **`dash-march` loop**, or morph a highlight through the steps | motion carries the eye along the sequence |
| a **headline number** | big text + `fx:{countUp:true}` | the count-up earns attention |
| **every cover / section divider** | at least **one ambient motion** (ken-burns, an orbiting accent) | a still cover is a missed first impression |
| **repeated chrome / a logo** | keep its `id` stable across slides | it morphs in place instead of popping on every slide |
| a **demo clip / recording / soundbite** | a **media** element (embed short, link long) | a live video/audio beats a screenshot of one |

### Copy-paste recipes

**Morph a title + accent bar between two slides** — identical ids, `transition:"morph"`:
```json
// slide 1
{ "id":"s1","transition":"none","elements":[
  { "id":"headline","type":"text","x":96,"y":140,"w":900,"h":200,"html":"Big claim.","fontSize":120,"fontWeight":900,"color":"#111","align":"left","valign":"top","lineHeight":1,"rotation":0,"opacity":1 },
  { "id":"bar","type":"shape","shape":"rect","x":96,"y":380,"w":320,"h":16,"fill":"#E8442E","stroke":"none","strokeWidth":0,"radius":0,"rotation":0,"opacity":1 } ] }
// slide 2 — same ids, new frames → they animate
{ "id":"s2","transition":"morph","elements":[
  { "id":"headline","type":"text","x":96,"y":84,"w":500,"h":80,"html":"Big claim.","fontSize":40,"fontWeight":900,"color":"#888","align":"left","valign":"top","lineHeight":1,"rotation":0,"opacity":1 },
  { "id":"bar","type":"shape","shape":"rect","x":96,"y":170,"w":16,"h":450,"fill":"#E8442E","stroke":"none","strokeWidth":0,"radius":0,"rotation":0,"opacity":1 } ] }
```

**A bar chart from a table** — bar/line data is PLAIN NUMBERS (see chart rules below):
```json
{ "id":"c1","type":"chart","x":96,"y":260,"w":1088,"h":380,"rotation":0,"opacity":1,"preset":"bar","option":{
  "xAxis":{"type":"category","data":["2022","2023","2024","2025"]},
  "yAxis":{"type":"value"},
  "series":[{"type":"bar","data":[420,780,1300,2450],"itemStyle":{"color":"#141310"},"barWidth":90}],
  "tooltip":{"trigger":"item","formatter":"{b}: {c}"} },
  "fx":{"enter":"fade-up"} }
```

**A comparison table** — a real HTML table; cells are the same inline-html subset as text:
```json
{ "id":"tbl1","type":"table","x":240,"y":220,"w":800,"h":260,"rotation":0,"opacity":1,
  "header":true,
  "columns":[{"w":1.4},{"w":1},{"w":1}],
  "rows":[
    { "cells":[{"html":"Plan"},{"html":"Price","align":"right"},{"html":"Seats","align":"right"}] },
    { "cells":[{"html":"Team"},{"html":"$29"},{"html":"5"}] },
    { "cells":[{"html":"Business"},{"html":"$79"},{"html":"25"}] } ],
  "style":{"headerBg":"#1E2A3A","headerColor":"#fff","zebra":"rgba(30,42,58,0.05)",
    "borderColor":"rgba(30,42,58,0.14)","borderWidth":1,"cellPadX":16,"cellPadY":11,
    "fontSize":18,"color":"#1E2A3A","radius":10} }
```

**A state slide reached by clicking a node** — parent slide has the clickable element, the state lives adjacent:
```json
// on the parent slide, an element the viewer clicks:
{ "id":"node-ingest","type":"shape","shape":"ellipse","x":330,"y":180,"w":74,"h":74,"fill":"#0B0E1E","stroke":"#7A5CFF","strokeWidth":2,"radius":0,"rotation":0,"opacity":1,"link":"state-ingest" }
// a hidden state slide (arrow keys skip it; ← returns to parent):
{ "id":"state-ingest","stateOf":"parent-slide-id","transition":"morph","name":"INGEST","elements":[ /* … */
  { "id":"dismiss","type":"shape","shape":"rect","x":0,"y":0,"w":1280,"h":720,"fill":"rgba(0,0,0,0)","stroke":"none","strokeWidth":0,"radius":0,"rotation":0,"opacity":1,"link":"parent-slide-id" } ] }
```

**Full-bleed hero image with ken-burns + scrim + text:**
```json
{ "id":"photo","type":"image","x":0,"y":0,"w":1280,"h":720,"src":"asset:hero","fit":"cover","radius":0,"rotation":0,"opacity":1,"fx":{"ambient":"kenburns","ken":{"dir":"drift","scale":1.09,"duration":22}} },
{ "id":"scrim","type":"shape","shape":"rect","x":0,"y":0,"w":1280,"h":720,"fill":"rgba(10,14,26,0.55)","stroke":"none","strokeWidth":0,"radius":0,"rotation":0,"opacity":1 },
{ "id":"htitle","type":"text","x":96,"y":460,"w":1000,"h":180,"html":"On top of the photo.","fontSize":76,"fontWeight":800,"color":"#fff","align":"left","valign":"top","lineHeight":1.05,"rotation":0,"opacity":1,"fx":{"enter":"fade-up"} }
```
(Embed the image as a data URI in `doc.assets` under key `hero`, then reference `"asset:hero"` — the file must stay self-contained.)

**Video — embed a short clip, or link a big one** (autoplay is present-only; `muted` required to autoplay):
```json
// embedded — self-contained, keep it small (a few MB at most):
{ "id":"clip","type":"media","kind":"video","src":"data:video/mp4;base64,AAAA…","x":220,"y":120,"w":840,"h":472,"rotation":0,"opacity":1,"controls":true,"muted":true,"autoplay":true,"loop":true,"fit":"cover","radius":8 }
// linked — deck stays tiny; needs the URL at play time (give it a poster):
{ "id":"clip","type":"media","kind":"video","src":"https://cdn.example.com/demo.mp4","poster":"asset:demo-poster","x":220,"y":120,"w":840,"h":472,"rotation":0,"opacity":1,"controls":true }
```

### Before you finish — self-audit

- [ ] Any numbers rendered as text that should be a **chart**?
- [ ] Do consecutive slides on one subject share element **ids + `transition:"morph"`**?
- [ ] At least one **motion moment** (ken-burns / loop / count-up), especially the cover?
- [ ] A drill-down that would work better as a **state slide**?
- [ ] One accent colour, at most two typefaces, **96px** side margins (right-most x ≤ 1184)?
- [ ] **Speaker notes** written on each slide (they travel in the file and double as the talk track)?
- [ ] **Have you actually looked at it?** Open the deck and page through every
      slide. Text overflowing its box, two elements crowding each other, a
      heading that wrapped to three lines, a chart key that was silently
      dropped — none of these are visible in the JSON, and all of them are
      obvious on screen. This is the only check that catches what the others
      cannot; a deck nobody rendered is not finished.

### `window.bento.measure()` — size text before you place it

The format is absolute pixels, which is what lets morph, the drag handles and
the renderer work from one representation. The cost falls on you: the height of
a string at a given width and font is not knowable from the JSON. Stop guessing
and ask:

```js
window.bento.measure({ html: 'Long paragraph…', w: 600, fontSize: 28, lineHeight: 1.4 })
// → { height: 236, width: 600, lines: 6 }
```

Pass a spec to size text **before** the element exists — which is the point, as
it lets you lay a slide out correctly the first time. Pass an element id to
measure one already in the deck, and include `h` in a spec to get `fits` and
`overflow` back too. It renders through the real renderer, so the answer is
what the slide will actually do, not an estimate.

Use it for the arithmetic that used to be guesswork: stacking cards in a
column, deciding whether a heading needs two lines or three, sizing a caption
under a photo. In the editor, the same thing is a **Fit height to text** button
in the Typography panel.

### `window.bento.validate()`

Open the deck and run it in the browser console. It reports, in one pass, the
things the runtime otherwise swallows in silence:

```js
const { ok, counts, findings } = window.bento.validate()
findings.filter(f => f.severity !== 'info')
```

Each finding is `{code, severity, message, slide?, element?, path?}`. It checks
unknown property names (a typo is ignored, so the styling just never applies),
text that overflows its box (measured against the real renderer), elements off
the canvas, entrances that can never run, `dash-march` without a dashed stroke,
broken `link` and `asset:` references, duplicate ids and morph-key collisions,
and chart options charts-lite does not implement.

It only reads — it never changes the document, and a finding is advice, not a
refusal. `severity: "info"` is deliberately quiet (a photo bleeding off the
canvas is a design move, not a defect); `error` means something is broken, like
a link to a slide that does not exist.

Every code it can report (generated from the code's own table):

<!-- generated:verify -->
| Code | Severity | Meaning |
|---|---|---|
| `unknown-key` | warning | A key the format does not define (often a typo). It is ignored, so what it was meant to do does not happen. |
| `missing-asset` | error | An asset: reference, or a doc.fonts entry, names an asset that is not in doc.assets (or a builtin: face the app does not carry). Nothing renders. |
| `collab-secrets-present` | info | The deck carries live-session keys; anything that receives the file holds the same access. Read it with window.bento.read() before handing it on. |
| `font-not-embedded` | info | A font stack starts with a face the document does not carry, so viewers without it installed get the next family. Use a builtin: face or embed the woff2. |
| `token-unknown` | warning | A themeRefs entry names a $token that theme.tokens does not define, so the value never follows it. |
| `theme-ref-malformed` | warning | A themeRefs entry is neither a palette slot (optionally with a shift like "accent1 -20%") nor a $token. |
| `theme-ref-unknown-slot` | warning | A themeRefs entry names a palette slot the theme leaves empty, so the colour never follows the palette. |
| `theme-ref-dangling` | warning | A themeRefs entry points at a property the element or slide does not have; it controls nothing. |
| `theme-ref-stale` | info | A palette-bound colour differs from what its slot resolves to, so the next palette edit will replace it. |
| `unreachable-hidden-slide` | info | A hidden slide that no element links to: it cannot be reached while presenting. |
| `broken-state-parent` | error | stateOf names a slide that does not exist, so the state is unreachable. |
| `duplicate-id` | error | Two elements on one slide share an id; selection, morph and comment anchors all key off it. |
| `morph-key-collision` | error | Two elements on one slide share a morph key (morphId, else id), so one of them will not tween. |
| `out-of-canvas` | warning or info | The element extends past the canvas. A warning for text and tables (words are cropped), info for anything else (a bleed may be deliberate). |
| `past-margin` | info | Text or a table reaches past the 96 px side margin (scaled to the deck width) where the rest of the content stops short. |
| `overridden-enter-fx` | warning | The element morphs in from the previous slide, so its fx.enter is skipped. Give it a morph key new to the slide to make it enter. |
| `entrance-on-motion-path` | warning | fx.enter and a motion-path loop fight over the same transform; use one or the other. |
| `inert-countup` | info | The element morphs in already showing its number, so fx.countUp is skipped by design. |
| `dash-march-no-dash` | warning | A dash-march loop needs a visible stroke and strokeStyle "dashed" or "dotted"; as set, nothing moves. |
| `broken-link` | error | link names a slide that does not exist and is not an http(s) URL; clicking it does nothing. |
| `dangling-connector` | warning | A connector end (from/to) names an element that is not on the slide; that end stops following. |
| `embed-missing-view` | error | An embed has no view, so it is an empty box offline, in thumbnails and in print. |
| `embed-remote-view` | warning | An embed view is a URL: it needs the network and paints nothing offline. Capture it into doc.assets. |
| `embed-live-no-url` | warning | An embed has live on but no http(s) url, so no frame is created and only the view shows. |
| `chart-key-ignored` | warning | A chart option key charts-lite does not implement (label on a bar or line series is the common one); it is ignored silently. |
| `text-overflow` | warning | Measured with the real renderer, the text needs more height than its box; the finding says by how many px. Needs a browser. |
| `table-overflow` | warning | Measured with the real renderer, the rows need more height than the table box; the finding says by how many px. Needs a browser. |
<!-- /generated -->

This does not replace looking at the deck. It catches what is checkable; the
rest — whether a slide is any good — still needs eyes.

## Minimal valid document

Start from this skeleton when creating a deck from scratch.

```json
{
  "format": "bento/slides", "version": 1, "title": "My deck",
  "size": { "width": 1280, "height": 720 },
  "theme": { "background": "#101418", "color": "#F2F0EA",
             "accent": "#FF9E8A", "fontFamily": "system-ui, sans-serif" },
  "slides": [
    { "id": "s1", "background": "#101418", "transition": "none",
      "notes": "speaker notes here",
      "elements": [
        { "id": "t1", "type": "text", "x": 96, "y": 260, "w": 1088, "h": 160,
          "rotation": 0, "opacity": 1,
          "html": "Hello from an agent.",
          "fontSize": 88, "fontWeight": 800, "color": "#F2F0EA",
          "align": "left", "valign": "top", "lineHeight": 1.1 }
      ] }
  ]
}
```

**What is required.** Only `"format": "bento/slides"` and a non-empty `slides`
array are required; without them the document is refused. Everything else
above the element level is filled from the editor's defaults when it is
missing or of the wrong type, and the deck opens: `size` becomes 1280×720; a
missing `theme`, or any of its `background`, `color`, `accent` and
`fontFamily`, takes the editor's (a white slide, dark ink, an amber accent,
the system font stack); a slide without `id`, `transition` (`fade`), `notes`
or `background` gets one, and that background is white, not
`theme.background`. So write `size` and `theme` because you are choosing them,
not because the app needs them. Elements are stricter: one missing a key its
type cannot render without (text `html`, shape `shape` and `fill`, image
`src`, chart `option`, table `columns` and `rows`, media `kind` and `src`) is
dropped, and other missing fields render wrong (a text box without `fontSize`
comes out at 16 px). Write the field set shown above, with one exception:
leave `fontFamily` off a text box and it renders in `theme.fontFamily`, which
is what lets the deck's font be changed in one place. Writing the same stack
on every element is what stops text following the theme.

To leave the defaults out safely, write the **compact form** instead (the
next section has the whole of it):
`"compact": true` at the top level, and every field you omit is filled on load
with what the editor would insert (`format` and the rest of the document
level too; ids are minted from the slide id). In this form an omitted
`fontFamily` becomes the editor's system stack, not the theme's, so write the
deck's stack on text that should carry it. The saved file is always the full
document.

```json
{ "compact": true, "title": "My deck",
  "theme": { "background": "#101418", "color": "#F2F0EA",
             "accent": "#FF9E8A", "fontFamily": "system-ui, sans-serif" },
  "slides": [
    { "id": "s1", "notes": "speaker notes here", "elements": [
      { "type": "text", "x": 96, "y": 260, "w": 1088, "h": 160,
        "html": "Hello from an agent.", "fontSize": 88, "fontWeight": 800,
        "align": "left", "valign": "top" } ] } ] }
```

## The compact form: write only what you choose

The JSON in `#bento-doc` is the full document: every element carries every
field, including a dozen defaults no author chose. Write the **compact** form
instead: `"compact": true` at the top level, and leave out every field that
equals what the editor would insert (rotation 0, opacity 1, the font stack,
weight 400, centre/middle, line height 1.25, a shape's transparent stroke, a
slide's theme background, `transition: "fade"` …; the full list is below).
`x y w h` and the type's content (`html`, `shape`, `src`, `option`, `content`,
`columns`/`rows`) are always written. Two conveniences: `elements` may nest
arrays (a helper that returns a card as `[bg, title, body]` needs no spread),
and `id` may be omitted: it is minted deterministically as
`<slideId>-<type>-<index>`, so a re-run yields the same ids.

```json
{ "compact": true, "title": "Q3 review",
  "slides": [ { "id": "s1", "elements": [
    { "type": "text", "x": 96, "y": 80, "w": 1088, "h": 100, "html": "Q3 review", "fontSize": 48 },
    [ { "type": "shape", "shape": "rect", "x": 96, "y": 220, "w": 500, "h": 300, "fill": "#F3F0EA" },
      { "type": "text", "x": 120, "y": 240, "w": 452, "h": 60, "html": "Revenue" } ] ] } ] }
```

A compact document is expanded when it is loaded (`window.bento.loadDoc(json)`
or *Replace from JSON…*); the FILE is always saved full, so the on-disk format
is unchanged and every shipped shell reads it as before. Do not write
`"compact": true` into a file's `#bento-doc` block: a file is opened as a full
document and is not expanded. To turn compact JSON into a file, load it into
the app and save.

### Text that sizes itself, and markdown

Two more things a compact text element may do. Leave `h` out (or write
`"h": "auto"`) and the box is sized to its text on load, measured on the
deck's real fonts: the same number *Fit height to text* would set. You cannot
know how tall three lines of 24 px are; the runtime can. Write `md` instead of
`html` and it converts exactly as pasted markdown does: `**bold**`,
`*italic*`, `` `code` ``, `~~strike~~`, `- bullets` (indent two spaces for a
sub-bullet), `[caption](https://…)`; when both are present `html` wins.

```json
{ "compact": true, "slides": [ { "id": "s1", "elements": [
  { "type": "text", "x": 96, "y": 96, "w": 1088, "fontSize": 28, "align": "left", "valign": "top",
    "md": "**Revenue** grew 40%, led by *enterprise*.\n- New logos: 38\n  - 12 in EMEA\n- Net retention: 118%" } ] } ] }
```

### Placing by layout and role

You need not place anything. Give a slide a `layout` and its elements a
`role`, leave out geometry and typography, and the layout's frames and type
are used: the same matching the editor's *Apply layout* does, and slides born
from the same layout share element ids, so their titles morph. An element that
DOES carry `x y w h` is placed as given, on top. More `body` elements than the
layout has body slots stack into the slot top-to-bottom, each sized to its
text. A role the layout lacks falls back to the body slot and the load report
says so (`dropped` carries a note with the path). An `image` role takes an
image element and puts the picture in the slot. A deck's own `layouts` (full
Slide objects, the shape *Save slide as layout* writes) may be named the same
way.

```json
{ "compact": true,
  "assets": { "photo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" },
  "slides": [
  { "layout": "title-body", "elements": [
    { "role": "title", "md": "Three things went right" },
    { "role": "body", "md": "**Latency** fell 40%." },
    { "role": "body", "md": "**Uptime** held at 99.97%." } ] },
  { "layout": "image-right", "elements": [
    { "role": "title", "md": "The tile" },
    { "role": "body", "md": "It stays put." },
    { "type": "image", "role": "image", "src": "asset:photo", "fit": "cover" } ] } ] }
```

The layouts, their roles and every default below are generated from the code
by `scripts/build-agent-docs.mjs`, so they cannot drift.

<!-- generated:compact -->
### Built-in layouts and their roles

Name one in a slide's `layout` (by id, with or without the `layout-` prefix, or by an alias) and give its elements a `role`:

- `title` — title, subtitle
- `title-content` — title, body (also `title-body`)
- `two-col` — title, body, left, right (also `two-column`)
- `section` — title, kicker
- `three-cards` — title, card1, card2, card3 (also `cards`)
- `quote` — quote, attribution
- `image-left` — image, title, body
- `image-right` — title, body, image
- `blank` — no roles (an empty slide; every element carries its own frame)

Where each role's content lands on a 1280×720 deck (a deck of another size gets the layout scaled to it). An element with its own `x y w h` is placed as given instead.

| Layout | Role | Slot (x, y, w, h) | Font size |
|---|---|---|---|
| `title` | `title` | 128, 323, 1024, 112 | 61 |
| `title` | `subtitle` | 128, 445, 880, 48 | 22 |
| `title-content` | `title` | 96, 58, 1088, 67 | 35 |
| `title-content` | `body` | 96, 166, 1088, 480 | 21 |
| `two-col` | `title` | 96, 58, 1088, 67 | 35 |
| `two-col` | `body` | 96, 166, 528, 480 | 19 |
| `two-col` | `left` | 96, 166, 528, 480 | 19 |
| `two-col` | `right` | 656, 166, 528, 480 | 19 |
| `section` | `title` | 128, 336, 1024, 96 | 51 |
| `section` | `kicker` | 128, 280, 640, 32 | 14 |
| `three-cards` | `title` | 96, 58, 1088, 67 | 35 |
| `three-cards` | `card1` | 122, 202, 290, 397 | 19 |
| `three-cards` | `card2` | 495, 202, 290, 397 | 19 |
| `three-cards` | `card3` | 869, 202, 290, 397 | 19 |
| `quote` | `quote` | 166, 240, 986, 240 | 38 |
| `quote` | `attribution` | 166, 496, 986, 35 | 19 |
| `image-left` | `image` | 96, 96, 512, 528 | 19 |
| `image-left` | `title` | 656, 96, 528, 96 | 35 |
| `image-left` | `body` | 656, 211, 528, 413 | 19 |
| `image-right` | `title` | 96, 96, 528, 96 | 35 |
| `image-right` | `body` | 96, 211, 528, 413 | 19 |
| `image-right` | `image` | 672, 96, 512, 528 | 19 |

### Defaults you can leave out

In a compact document every field below is filled on load with the value shown, which is what the editor itself inserts. Write a field only when you mean a different value. The saved file is always the full document.

**Document**

| Key | Filled with |
|---|---|
| `format` | `"bento/slides"` |
| `version` | `1` |
| `title` | `"Untitled"` |
| `size` | `{"width":1280,"height":720}` |
| `theme.background` | `"#FFFFFF"` |
| `theme.color` | `"#1E2A3A"` |
| `theme.accent` | `"#F7A600"` |
| `theme.fontFamily` | `"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"` |
| `theme.codeFontFamily` | `"ui-monospace, 'SFMono-Regular', 'Berkeley Mono', 'Menlo', 'Consolas', monospace"` |

**Slide**

| Key | Filled with |
|---|---|
| `background` | `theme.background` (a compact slide only; a full document's slide without one is white) |
| `transition` | `"fade"` |
| `notes` | `""` |
| `id` | `s<n>` (1-based position, e.g. `"s2"`) |

**Elements.** An omitted `id` is minted as `<slideId>-<type>-<index>` (index = position on the slide, e.g. `s1-text-0`), so a re-run yields the same ids. Per type, the fields filled when left out:

| Type | Filled when omitted | Always written |
|---|---|---|
| `text` | `rotation` `0`, `opacity` `1`, `fontSize` `32`, `fontFamily` `"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"`, `fontWeight` `400`, `color` `"#1E2A3A"` on a light slide, `"#F5F7FA"` on a dark one, `align` `"center"`, `valign` `"middle"`, `lineHeight` `1.25` | `x` `y` `w` `h` `html` |
| `shape` | `rotation` `0`, `opacity` `1`, `fill` `"#F7A600"`, `stroke` `"transparent"`, `strokeWidth` `0`, `radius` `12` | `x` `y` `w` `h` `shape` |
| `image` | `rotation` `0`, `opacity` `1`, `fit` `"contain"`, `radius` `0` | `x` `y` `w` `h` `src` |
| `svg` | nothing: write every field | `x` `y` `w` `h` |
| `chart` | `rotation` `0`, `opacity` `1`, `preset` `"bar"` | `x` `y` `w` `h` `option` |
| `table` | `rotation` `0`, `opacity` `1`, `header` `true`, `style` (themed; lighter lines on a dark slide) | `x` `y` `w` `h` `columns` `rows` |
| `media` | `rotation` `0`, `opacity` `1`, `fit` `"contain"`, `radius` `8`, `controls` `true`, `muted` `true`, `loop` `false`, `autoplay` `false` | `x` `y` `w` `h` `kind` `src` |
| `embed` | nothing: write every field | `x` `y` `w` `h` |
| `code` | `rotation` `0`, `opacity` `1`, `fontSize` `32`, `fontFamily` `"ui-monospace, 'SFMono-Regular', 'Berkeley Mono', 'Menlo', 'Consolas', monospace"`, `color` `"#1E2A3A"` on a light slide, `"#F5F7FA"` on a dark one, `align` `"left"`, `valign` `"middle"`, `lineHeight` `1.25` | `x` `y` `w` `h` `content` |

A text element may also leave out `h` (or write `"h": "auto"`): it is sized to its text on load. A slide with a `layout` fills its role'd elements' frame and typography from the slot instead; bodies beyond the layout's body slots stack in the slot 16 px apart.
<!-- /generated -->

## Load, read the report, fix

A document you hand the running app (compact or full) passes the untrusted
shape gate on the way in, and `loadDoc` RETURNS what happened:

```js
const r = window.bento.loadDoc(json)
// r === false      → not a document at all (nothing changed)
// r.dropped        → [{ path: '/slides/0/elements/2/fontSze', reason: 'unknown key for a text element' }, …]
// r.expanded       → fields filled from the editor's defaults
// r.fitted         → text boxes sized to their text
// r.laidOut        → slides placed by layout + role
// r.findings       → window.bento.validate() on the loaded deck (overflow, off-canvas, dead links …)
```

The loop is: load → read `dropped` and `findings` → fix the JSON → load
again. A dropped key is one the format does not have (a typo, or a field that
does not exist for that element type); an invalid value is the right key with
the wrong type or range, and is dropped the same way. `window.bento.compact()`
(or *Copy compact JSON (for agents)* in the File menu) gives an open deck back
in the compact shape, the easiest starting point for an edit.

## Check your deck: `bento check`

From a checkout of the repository, `bento check` loads a deck in headless
Chrome (the real shell, the real fonts), tells you what the runtime would
otherwise swallow, then hands you pictures:

```sh
node scripts/bento-check.mjs deck.bento.html                # findings, by slide, with element ids
node scripts/bento-check.mjs doc.json --png out/            # a document JSON in the built shell, + one PNG per slide
node scripts/bento-check.mjs doc.json --json --fail-on warning   # machine-readable, strict exit code
```

The loop: write the document JSON (compact where the shell accepts it) →
`bento check --png` → read `findings` (`text-overflow` and `table-overflow`
say how many px the box is short and on which element; the list of every code
is under [`validate()`](#windowbentovalidate)) → look at `contact.png`, one
image of every slide, or a single `page-NN.png` when a finding points at it →
fix → run again. Exit 0 means no finding at or above `--fail-on` (default
`error`). Needs Chrome (`BENTO_CHROME` to point at a binary) and the built
shell (`cd slides && npm run build:single`, or `--shell path`).

## The document schema

The format has a machine-readable JSON Schema, generated from the runtime's
own validation tables, so it describes exactly what the load gate accepts:

- **URL**: `https://bento.page/schema/slides.json`, with a version-pinned
  twin at `schema/slides-<version>.json`. Put
  `"$schema": "https://bento.page/schema/slides.json"` at the top of a deck
  you write and any JSON-Schema-aware editor validates it; the runtime strips
  the key on load and writes it back on save, so every saved deck carries it.
- **In the file**: the Tooling comment at the top of every `.bento.html`
  names the URL, and the saved JSON's first key is `$schema`.
- **`window.bento.schema()`**: the same JSON, built at runtime, for an agent
  driving the browser.
- **The [field reference](#field-reference)** at the end of this guide: the
  same tables as prose, one line per key.

Which door for which reader: a model that READS the file gets the Tooling
comment, `$schema` and the URL; a model that DRIVES the app gets `schema()`,
`validate()`, `measure()` and `loadDoc()`.

## Element types (all share `id,x,y,w,h,rotation,opacity`)

- **text**: `html`, `fontSize`, `fontFamily` (omit it to follow
  `theme.fontFamily`), `fontWeight`, `color`, `align` (`left|center|right`),
  `valign`, `lineHeight`, optional `letterSpacing`. The `html` keeps these tags
  and unwraps any other (its words stay): inline `<b> <strong> <i> <em> <u>
  <s> <code> <br> <span> <a>` and blocks `<p> <div> <h1> <h2> <ul> <ol> <li>`.
  Every attribute is stripped, except an `<a>`'s `href` when it is an `http(s)`
  URL, so a `style` or `class` in the markup does nothing.
- **shape**: `shape` = `rect|ellipse|triangle|arrow|line|path`, `fill`, `stroke`,
  `strokeWidth`, `radius` (rect corner). Optional `fillGradient`
  `{angle, stops:[{at:0..1, color}]}` (CSS-convention angle).
  Optional, newer: `fillGradient.kind:"radial"` (+`cx`,`cy`,`r`),
  `strokeAlign` (`inside|center|outside`), `strokeDashes:[dash,gap]`, rect
  `radii:[tl,tr,br,bl]`, `flipX`/`flipY`, `hidden`, `alt`. A frame is a `rect`
  with `layout`, and its children carry `parentId` (see *Frames* below). Lines take
  their color from `fill` and draw horizontally across the box (rotate for
  vertical); `strokeStyle: solid|dashed|dotted`; tips `lineStart`/`lineEnd`
  = `none|arrow|arrow-open|triangle|triangle-open|diamond|diamond-open|square|circle-open|dot|bar`.
  A `path` is a free vector: `d` (SVG path data) +
  `pathBox` `[x,y,w,h]` authoring viewBox, stretched into the element box;
  for a **curved line** set `fill:"transparent"` + a `stroke` + `strokeWidth`.
  A **connector** is a `line` (or `path`) with `from`/`to: {el, side}` — its ends
  follow those elements and re-route when they move (side `"auto"` picks the
  nearest border). Make sure a shape's colour contrasts with its slide background.
- **image**: `src` = data URI or `"asset:<key>"` into `doc.assets`,
  `fit: cover|contain|fill`, `radius`. Embed images as data URIs in
  `doc.assets` and reference them — the file must stay self-contained.
- **chart**: `preset: bar|line|pie|scatter`, `option` = ECharts-SHAPED pure
  JSON. **Bar/line series data must be plain numbers** (`{value,itemStyle}`
  objects coerce to 0 — only pie takes `{name,value}`); per-item bar colors
  are unsupported, color by series; template formatters only (`{b}`, `{c}`,
  `{d}`), never functions. **Dual axis**: for two series on very different
  scales (e.g. volume + a %), make `yAxis` an ARRAY of two `{type:"value"}`
  axes (give the 2nd `axisLabel:{formatter:"{value}%"}`) and point the odd
  series at it with `"yAxisIndex":1` — render it as a `line` over the bars.
  **The engine is charts-lite, not ECharts** — it reads the option SHAPE and
  ignores every key it does not implement, silently. What it honours:
  - top level — `color`, `series`, `xAxis`, `yAxis`, `legend`, `grid`,
    `tooltip`, `textStyle`, `dataZoom`
  - any series — `type`, `name`, `data`, `yAxisIndex`, `itemStyle.color`
  - bar — `itemStyle.borderRadius`
  - line — `smooth`, `symbol`, `symbolSize`, `lineStyle.color`,
    `lineStyle.width`, `areaStyle.color`
  - pie — `radius`, `label.formatter` (or `label:false`),
    `itemStyle.borderColor`, `itemStyle.borderWidth`
  - axes — `type`, `data`, `min`, `max`, `axisLabel` (`fontSize`,
    `fontWeight`, `color`, `formatter`), `axisLine`, `splitLine`
  - legend — `show`, `top`, `bottom`, `textStyle.fontSize`,
    `textStyle.fontWeight`

  **`label` on a bar or line series does nothing** — value labels above bars
  are pie-only. If you need the numbers visible on a cartesian chart, put them
  in a table beside it, or use text elements.
- **table**: `columns` (array of `{w}` fractional weights), `rows` (array of
  `{cells:[{html, align?, color?, bg?, bold?}]}`), `header` (bool — row 0 is
  the header), and a `style` object (`headerBg`, `headerColor`, `zebra?`,
  `borderColor`, `borderWidth`, `cellPadX`, `cellPadY`, `fontSize`, `color`,
  `radius`). Renders as a real HTML table. Use for comparison/spec/pricing
  grids — NOT for numeric trends (use a chart).
- **svg**: `asset` or `markup` for static artwork. Prefer composing rects/
  texts/paths — those stay editable and can morph.
- **media**: `kind: video|audio`, `src` = data URI (embedded — travels in the
  file), an external URL / relative path (referenced — keeps the file small,
  needs the network at play time), or `"asset:<key>"`. Video also takes
  `poster`, `fit: cover|contain|fill`, `radius`. Playback flags: `controls`,
  `autoplay`, `loop`, `muted`. **Autoplay fires only in present mode**, and
  browsers require `muted:true` for a video to autoplay. **Embed only SHORT
  clips** — a big data URI bloats the file and makes it slow to open/save;
  host large media and reference its URL instead.

## The rules that make decks feel designed

- **Morph = shared ids.** Slides with `"transition": "morph"` tween any
  elements whose `id` matches the previous slide — position, size, color,
  gradients. This is THE signature move: carry 2–4 ids through the deck and
  rearrange them per slide. Generators must emit deterministic ids.
- **`morphId` decouples morph identity from `id`.** The real pairing key is
  `morphId || id`, so an element can keep whatever `id` it likes and set
  `"morphId": "running-head"` to morph against a differently-named element on
  the next slide. For a generator this beats threading one id by hand through
  every slide, and it lets two independently-created elements pair up. The key
  must be unique **within** a slide. Plain shared `id` still works and is still
  the simplest thing when you control both slides.
- **Entrances**: `fx: { enter: "fade-up", order: 0 }` — equal `order` =
  simultaneous. On a **morph arrival** the rule is per element, and it turns on
  whether that element has a morph partner on the previous slide:
  - **has a partner** → it morphs, and `fx.enter` and `fx.countUp` are both
    skipped. It is already in motion and already showing its number; an
    entrance would fight the tween and a count-up would restart from zero.
  - **no partner** → it is new to the slide, so both run normally. Without an
    `fx.enter` it gets an automatic fade-and-rise so nothing ever just pops in.

  So a headline number, or a panel that sweeps in from the right, is fine on a
  morph slide — just make sure it is new to that slide.
- **Ken-burns**: `fx: { ambient: "kenburns", ken: { dir: "drift|out|in",
  scale: 1.08, duration: 20 } }` — `drift` loops, `out`/`in` settle once on
  slide entry. For full-bleed photos: image at 0,0,1280,720 + a scrim rect
  + text on top. Never combine entrance tweens with motion-path loops.
- **Loops**: two shapes, both under `fx.loop`.
  - `{ type: "dash-march", distance: 18, duration: 1.4 }` — marches the stroke
    dashes along a shape. It animates `strokeDashoffset`, so it needs a
    `stroke` **and** a dash pattern: set `strokeStyle: "dashed"` or `"dotted"`.
    On a solid stroke the tween still runs and there is nothing to see.
  - `{ type: "motion-path", path: "M0,0 C60,-40 140,40 200,0", duration: 6,
    delay: 0, ease: "none", speeds: [1, 1] }` — drifts the element along a
    path given RELATIVE to its resting position (the first anchor is where it
    sits). `speeds` is optional, one multiplier per on-curve point, and lets
    the element dwell in places and rush others; omit it for constant pace.
    Never put an entrance tween on a motion-path element — they fight over the
    same transform.
- **Interactivity**: element `link: "<slide-id>"` jumps on click; a slide
  with `stateOf: "<parent-id>"` is a hidden variant reached only by links
  (arrow keys skip it, ← returns to parent). Give clickable things a padded
  transparent rect as the hit target, not the text itself.
- **Hidden slides**: `"hidden": true` keeps a slide in the deck and out of the
  show — arrow keys skip it, PDF export leaves it out, and it is never the
  file's thumbnail — but an element `link` still reaches it. That is what it is
  for: backup and appendix material you jump to only if asked. By default a
  hidden slide does not consume a page number either, so `{{page}}`/`{{pages}}`
  stay contiguous for the audience; set `present.numberHidden: true` for the
  office-suite behaviour where it keeps its number.

  Not the same as `stateOf`. A state is a variant OF another slide (← returns
  to its parent, and it morphs with it); hidden carries no such relationship.
  Use a state for "click to drill into this", hidden for "only if they ask".
- **Numbers count up** with `fx: { countUp: true }`.
- **Speaker notes** (`notes`) are part of the document — write them; they
  make a template teach itself.

## Layout guardrails

- Canonical canvas 1280×720 (`doc.size` can differ — read it first).
- Keep 96 px side margins (right-most content x ≤ 1184).
- **Column arithmetic, already done.** On 1280×720 inside 96 px margins the
  content band is 1088 px wide. Use these rather than computing your own:

  | Split | Width | `x` positions | Gutter |
  |---|---|---|---|
  | 2 columns | 528 | 96, 656 | 32 |
  | 3 columns | 340 | 96, 470, 844 | 34 |
  | 4 columns | 254 | 96, 374, 652, 930 | 24 |
  | 60 / 40 (text + image) | 624 / 432 | 96, 752 | 32 |

  Every row ends flush at x = 1184. Vertically, a title band of `y:72 h:84`
  over content starting at `y:208` leaves 416 px of content height above a
  96 px bottom margin.
- One accent color; 2 typefaces max. `theme` sets deck defaults.
- Fonts: `doc.fonts` (`{family, asset, weight}`) declares the faces a deck
  carries. Two come with the app: name them by a `builtin:` key instead of an
  asset and no font bytes are written into the file. These are the starter
  deck's own entries:

  ```json
  "fonts": [
    { "family": "Fraunces", "asset": "builtin:fraunces-900", "weight": "900" },
    { "family": "Instrument Sans", "asset": "builtin:instrument-sans", "weight": "400 700" }
  ]
  ```

  `builtin:fraunces-900` is Fraunces at weight 900 only (a display serif for
  headings); `builtin:instrument-sans` is Instrument Sans across weights 400 to
  700. Then write `"'Fraunces', Georgia, serif"` or
  `"'Instrument Sans', system-ui, sans-serif"` in `theme.fontFamily` or on an
  element. Any other face is embedded: a woff2 data URI in `doc.assets`, its
  key in a `doc.fonts` entry. (A shell older than the `builtin:` keys opens
  such a deck with the fallback stack.)
  **A `fontFamily` naming a face the document does not carry falls back
  silently** to the next entry in the stack — there is no warning, and worse,
  it will usually look right to *you*, because you are the one with the
  typeface installed. Everyone else gets the fallback. `validate()` reports
  this (`font-not-embedded`) precisely because you cannot see it locally. So
  use a built-in face, embed the woff2 yourself, start from a template that
  already carries the face, or name a system stack and mean it.
  Always write a full stack (`"'Fraunces', Georgia, serif"`), never a bare
  family name.

## Layouts and `role`

`doc.layouts` is a supported top-level key: an array of Slide-shaped templates
the editor offers under *Apply layout*. Every deck also gets the built-ins
(`layout-title`, `layout-title-content`, `layout-two-col`, `layout-section`,
`layout-three-cards`, `layout-quote`, `layout-image-left`,
`layout-image-right`, `layout-blank`), which are scaled to the deck's
`doc.size` when applied.

The part that matters when you are generating a deck is **`role`**. Any text
element can carry `"role": "title" | "subtitle" | "body" | "kicker"`. Applying a
layout matches donor to target by `id` first and then by `role` + `type`, so
roles are what let someone restyle your deck later without re-typing it —
content rides across, the layout supplies frame and typography. Setting them
costs one key per element and makes a generated deck feel native to the editor.

Two smaller things: a layout's text elements use `placeholder` (a dimmed prompt
shown in the editor, hidden in present and print) rather than `html`, and
slides instantiated from the same layout keep their element ids — which is
exactly why their furniture morphs across a transition.

## Dynamic fields (tokens in text `html`)

Put these tokens in any text element's `html`; they resolve at render time (the
model keeps the raw token, so numbering/props update automatically):
`{{page}}`, `{{pages}}` (position among non-state slides; zero-pad with
`{{page:2}}`→"06"), `{{title}}`, `{{date}}`, `{{time}}`, and the document
properties `{{author}}`, `{{company}}`, `{{subject}}`, `{{event}}`. Set the
props in an optional top-level `"meta": {author, company, subject, event,
keywords}` object — great for title slides and footers that fill from one place.

### Show chrome

While presenting, the show draws its own furniture over the slides. The
top-level `present` object sets it for the whole deck:

- `present.slideNumber` (default `true`): a "3 / 12" counter in the bottom
  corner, numbered the way `{{page}}`/`{{pages}}` are.
- `present.progress` (default `true`): a thin progress bar along the bottom.
- `present.controls` (default `false`): arrow buttons in the corner.
- `present.numberHidden` (default `false`): hidden slides keep their page
  number (see *Hidden slides* above).
- `present.morphSeconds` (absent = 0.65): how long a morph transition takes,
  0.1 to 6; a slower beat suits decks built on code-token morphs.
- `present.typeWriterSeconds` (absent = 0.08): typewriter pace in seconds per
  character, 0.08 to 1; a whole run never takes longer than 6 seconds.

If your slides number themselves (a `{{page}}` footer, a hand-made "3 / 12"),
set `"present": { "slideNumber": false }`, or the show stacks its counter on
top of yours; add `"progress": false` when the design has its own progress
mark.

## Features, with an example each

Each example below is a whole compact document: load it with
`window.bento.loadDoc()` to see it, or lift the elements into your own deck.
CI loads every one of them and fails on a dropped key or an error finding.

### Click builds: `fx.step`

`fx.step` reveals an element on a click instead of with the slide: `1` waits
for the first →, `2` for the second, and so on. It runs its `fx.enter` when it
appears (a plain fade without one); ← hides it again, and → leaves the slide
only once every step is shown. Arriving backward shows every step. Equal
steps appear together. It is one slide, one page number, one morph pairing,
so prefer it to copying a slide three times. An older shell shows every
element at once.

```json
{ "compact": true, "slides": [ { "id": "why", "elements": [
  { "type": "text", "x": 96, "y": 72, "w": 1088, "h": 84, "html": "Why now", "fontSize": 48, "fontWeight": 700, "align": "left" },
  { "type": "text", "x": 96, "y": 208, "w": 1088, "md": "**1.** Costs fell by half", "fontSize": 32, "align": "left", "valign": "top", "fx": { "step": 1, "enter": "fade-up" } },
  { "type": "text", "x": 96, "y": 288, "w": 1088, "md": "**2.** Demand doubled", "fontSize": 32, "align": "left", "valign": "top", "fx": { "step": 2, "enter": "fade-up" } },
  { "type": "text", "x": 96, "y": 368, "w": 1088, "md": "**3.** Two rivals left the market", "fontSize": 32, "align": "left", "valign": "top", "fx": { "step": 3, "enter": "fade-up" } } ] } ] }
```

When a build has to change layout (a diagram that rearranges, not just items
that appear), use consecutive slides with `transition: "morph"` and mark every
slide after the first `"unnumbered": true`: each stays in the walk but takes
the page number of the slide before it, so the audience sees one page, not
three.

### Code, and code morph

A `code` element draws syntax-coloured source: `content` is the plain text and
`grammarName` the language (the [field reference](#element-code) lists the
built-in ones). Token colours come from `theme.codePalette`, the font from
`theme.codeFontFamily`. Two code elements that pair across a `morph` (same
`id` or `morphId`) animate token by token: tokens found on both sides glide to
their new places, the others fade out or in. A token travels about one line height, which reads as
a blink at the default morph speed, so set `present.morphSeconds` to 1 or more
for a deck built on code morphs. `fx.typeWriter: true` types a code element in
when it appears (pace: `present.typeWriterSeconds`).

```json
{ "compact": true, "present": { "morphSeconds": 1.2 }, "slides": [
  { "id": "c1", "elements": [
    { "id": "snippet", "type": "code", "x": 96, "y": 160, "w": 1088, "h": 400, "grammarName": "ts", "fontSize": 28,
      "content": "function total(items) {\n  return items.length\n}" } ] },
  { "id": "c2", "transition": "morph", "elements": [
    { "id": "snippet", "type": "code", "x": 96, "y": 160, "w": 1088, "h": 400, "grammarName": "ts", "fontSize": 28,
      "content": "function total(items: Item[]): number {\n  return items.reduce((n, i) => n + i.qty, 0)\n}" } ] } ] }
```

### Maths

Text `html` renders LaTeX between `$…$` (inline) or `$$…$$` (display);
`\(…\)` and `\[…\]` work too, and `$typst: …$` switches to Typst syntax. The
document keeps the source, so an older shell shows it as typed. Inline `$`
needs no space just inside the delimiters and no digit straight after the
closer, so "it costs $5 and $10" stays prose. In JSON, double every backslash.

```json
{ "compact": true, "slides": [ { "id": "m1", "elements": [
  { "type": "text", "x": 96, "y": 120, "w": 1088, "h": 80, "html": "Euler: $e^{i\\pi} + 1 = 0$", "fontSize": 40, "align": "left" },
  { "type": "text", "x": 96, "y": 260, "w": 1088, "h": 200, "html": "$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$", "fontSize": 48 } ] } ] }
```

### Frames (auto layout)

A frame is a `rect` with a `layout`; elements whose `parentId` names it are
laid out inside it in a row, a column or a grid, with `gap` and `pad`, Figma's
auto layout. The app computes each child's `x y w h` (and the frame's own size
when it `hug`s) and writes them into the document, so an older shell, the
morph and every export see plain positioned elements. Write the children's
geometry roughly; it is replaced on load. `sizing: { "w": "fill" }` shares the
frame's free width between the children that ask for it. Order along the main
axis is the children's position, then their array order. A `parentId` that
names no frame is removed silently.

```json
{ "compact": true, "slides": [ { "id": "f1", "elements": [
  { "id": "stats", "type": "shape", "shape": "rect", "x": 96, "y": 208, "w": 1088, "h": 200, "fill": "#F3F0EA", "radius": 16,
    "layout": { "dir": "row", "gap": 24, "pad": [32, 32, 32, 32], "align": "stretch" } },
  { "id": "stat-1", "parentId": "stats", "type": "text", "x": 128, "y": 240, "w": 300, "h": 136, "md": "**38**\nnew logos", "fontSize": 32, "sizing": { "w": "fill" } },
  { "id": "stat-2", "parentId": "stats", "type": "text", "x": 452, "y": 240, "w": 300, "h": 136, "md": "**118%**\nnet retention", "fontSize": 32, "sizing": { "w": "fill" } },
  { "id": "stat-3", "parentId": "stats", "type": "text", "x": 776, "y": 240, "w": 300, "h": 136, "md": "**4.8**\nNPS change", "fontSize": 32, "sizing": { "w": "fill" } } ] } ] }
```

### Tokens and modes

`theme.tokens` holds named values (colours, numbers, font sizes, font stacks,
opacities, shadows), each with a value per mode. An element binds a property
to one with `themeRefs: { "<path>": "$<name>" }` and keeps the literal beside
it, equal to the token's value in the active mode. In the app, editing a token
or switching the mode (⌘K, *Switch mode*) rewrites every bound literal, so one
switch turns a light deck dark. A document you write or load is read as it
stands: a bound literal that differs from its token's value in the document's
`mode` is taken as a hand edit, so the binding is dropped and the literal
kept. Writing `"mode": "dark"` therefore means writing the dark values too. A
slide's `background` binds the same way. If a deck already has tokens, bind to
them rather than writing new literals.

```json
{ "compact": true,
  "theme": { "background": "#FFFFFF", "tokens": { "modes": ["light", "dark"], "mode": "light", "set": {
    "paper": { "type": "color", "values": { "light": "#FFFFFF", "dark": "#101418" } },
    "ink": { "type": "color", "values": { "light": "#1E2A3A", "dark": "#F2F0EA" } },
    "title.size": { "type": "fontSize", "values": { "light": 56, "dark": 56 } } } } },
  "slides": [ { "id": "t1", "background": "#FFFFFF", "themeRefs": { "background": "$paper" }, "elements": [
    { "type": "text", "x": 96, "y": 96, "w": 1088, "h": 120, "html": "One switch, two looks", "align": "left",
      "fontSize": 56, "color": "#1E2A3A", "themeRefs": { "color": "$ink", "fontSize": "$title.size" } } ] } ] }
```

### Components

A component is a set of ordinary elements sharing `component.id`. The set
marked `main: true` is the main; every other set (one per `groupId`) is a
copy, and `component.key` pairs each copy element with its counterpart in the
main. A copy takes every property from the main except its identity, its
position and the keys it overrides: write a copy equal to the main except
where it differs (here, the label), leave out `sig` and `off`, and the
differences are kept as that copy's overrides. Editing the main later updates
every copy. An older shell sees plain grouped elements.

```json
{ "compact": true, "slides": [
  { "id": "k1", "elements": [
    { "id": "btn-bg", "type": "shape", "shape": "rect", "x": 96, "y": 560, "w": 280, "h": 64, "fill": "#1E2A3A", "radius": 32,
      "groupId": "btn-main", "groupName": "Button", "component": { "id": "button", "key": "bg", "main": true } },
    { "id": "btn-label", "type": "text", "x": 96, "y": 560, "w": 280, "h": 64, "html": "Get started", "fontSize": 24, "color": "#FFFFFF",
      "groupId": "btn-main", "groupName": "Button", "component": { "id": "button", "key": "label", "main": true } } ] },
  { "id": "k2", "elements": [
    { "id": "cta-bg", "type": "shape", "shape": "rect", "x": 96, "y": 560, "w": 280, "h": 64, "fill": "#1E2A3A", "radius": 32,
      "groupId": "cta", "groupName": "Button", "component": { "id": "button", "key": "bg" } },
    { "id": "cta-label", "type": "text", "x": 96, "y": 560, "w": 280, "h": 64, "html": "Book a demo", "fontSize": 24, "color": "#FFFFFF",
      "groupId": "cta", "groupName": "Button", "component": { "id": "button", "key": "label" } } ] } ] }
```

### Paint stacks

A shape may carry several fills and strokes, bottom first: `fills` and
`strokes`, two or more layers each. A fill layer is a colour, optionally a
`gradient` (the colour is then its fallback) and a `blend` mode; a stroke
layer adds `width`, `align` and `dashes`. The plain keys stay and mirror the
TOP visible layer (`fill`, `stroke`, `strokeWidth` …), which is what an older
shell draws, so write them equal to the last layer.

```json
{ "compact": true, "slides": [ { "id": "p1", "background": "#101418", "elements": [
  { "type": "shape", "shape": "rect", "x": 96, "y": 208, "w": 520, "h": 320, "radius": 24,
    "fill": "rgba(255,255,255,0.2)",
    "fills": [
      { "color": "#7A5CFF", "gradient": { "angle": 135, "stops": [ { "at": 0, "color": "#7A5CFF" }, { "at": 1, "color": "#00C2A8" } ] } },
      { "color": "rgba(255,255,255,0.2)", "blend": "overlay" } ],
    "stroke": "#FFFFFF", "strokeWidth": 2,
    "strokes": [ { "color": "#1E2A3A", "width": 8 }, { "color": "#FFFFFF", "width": 2 } ] } ] } ] }
```

## Gotchas

- Escape `<` as `\u003c` anywhere in the JSON when writing the file block.
- Don't invent property names — unknown keys are ignored, so a typo means
  your styling silently doesn't apply.
- `docId` is the document's identity — never regenerate it when editing.
- `readonly: true` makes a PLAYER file — it boots straight into the
  presentation with no editor. Set it only on hand-out copies.
- If `template: true` is set, every open mints a fresh document (that's for
  distributable templates; remove it for a personal deck).
- Charts degrade gracefully but anything outside the list in the **chart**
  element type above is ignored, with no warning — keep options minimal and
  check the rendered slide rather than trusting the JSON.
- **Media size**: embedding a large video as a data URI can push the file into
  the tens of MB and make it slow to open and save. Embed only short clips;
  otherwise host the file and put its URL in `media.src`.

Working examples of everything above: the template decks at
[bento.page](https://bento.page) — open one and read its JSON block.

## Field reference

Every key of the format, object by object, generated from the app's own
tables by `scripts/build-agent-docs.mjs`: the type and the allowed values are
what the load gate accepts, so a key that is not listed here does not exist
and is dropped on load. The same reference ships with the bento-slides skill
as `references/format.md`.

<!-- generated:format -->
Every key of the format, read from the app's own tables: the type, enum and range are what the load gate accepts (a value outside them is dropped on load), and **required** keys are the ones a document or an element cannot do without. Objects: [Document](#document) · [theme](#theme) · [theme.palette](#themepalette) · [theme.codePalette](#themecodepalette) · [theme.tokens](#themetokens) · [present](#present) · [size](#size) · [meta](#meta) · [fonts[]](#fonts) · [Slide](#slide) · [slide.hover](#slidehover) · [slide.comments[]](#slidecomments) · [Every element](#every-element) · [Element: text](#element-text) · [Element: shape](#element-shape) · [Element: image](#element-image) · [Element: svg](#element-svg) · [Element: chart](#element-chart) · [Element: table](#element-table) · [Element: media](#element-media) · [Element: embed](#element-embed) · [Element: code](#element-code) · [component](#component) · [fx](#fx) · [fx.ken](#fxken) · [fx.loop](#fxloop) · [shadow](#shadow) · [Gradient](#gradient) · [fills[] layer](#fills-layer) · [strokes[] layer](#strokes-layer) · [from / to](#from--to) · [layout (frame)](#layout-frame) · [sizing](#sizing) · [bool](#bool) · [textStroke](#textstroke) · [crop](#crop) · [source](#source) · [Table style](#table-style) · [Table rows[]](#table-rows) · [Table cells[]](#table-cells).

### Document

The top level of the `#bento-doc` JSON. Only `format` and a non-empty `slides` are required; the rest is filled from the editor's defaults when missing.

| Key | Type | Meaning |
|---|---|---|
| `assets` | map of string | Shared data: key → data: URI or raw SVG markup, referenced as `asset:<key>`. Written last in a saved file. |
| `blobs` | object | Written by live collaboration for large assets. Never author it. |
| `collab` | object | Live-session credentials. Any key in it is access to the room: read the deck without it and write it back unchanged. |
| `docId` | string | The document's identity (uuid), minted on first open. Omit it in a new deck; never change it in an existing one. |
| `fonts` | array → [fonts[]](#fonts) | Faces the deck carries, each an @font-face at boot. |
| `format` | `"bento/slides"` **required** | Format discriminant, always "bento/slides". Check it before editing a file. |
| `layouts` | array → [Slide](#slide) | The deck's own slide templates (Slide-shaped), offered beside the built-ins under Apply layout. |
| `meta` | object → [meta](#meta) | Document properties for {{author}}, {{company}}, {{subject}}, {{event}}. |
| `modified` | string | Last-saved timestamp, written by the app. |
| `present` | object → [present](#present) | How the show draws its own chrome and paces morphs and typewriters. |
| `readonly` | boolean | true makes a player file: it boots into the show with no editor. |
| `size` | object → [size](#size) | The slide coordinate space in px. Default 1280×720. |
| `slides` | array → [Slide](#slide) **required** | The slides in show order; a state slide sits right after its parent. Must be non-empty. |
| `template` | boolean | true makes a template: every open mints a fresh document. |
| `theme` | object → [theme](#theme) | Deck-wide defaults: colours, fonts, palette slots, tokens. |
| `title` | string | Deck title; also the HTML title and {{title}}. |
| `version` | integer | Format version. The current shells write 1. |

### `theme`

The schema marks four keys required; a document that leaves any of them out still opens, with the editor's value for it.

| Key | Type | Meaning |
|---|---|---|
| `accent` | colour **required** | The accent colour (palette slot accent1); seeds derived chart colours. |
| `background` | colour **required** | Default slide background (palette slot bg1). |
| `chartPalette` | array of colour | Ordered series colours for new charts. Absent = derived from accent. |
| `codeFontFamily` | string | Font stack for code elements without their own fontFamily. Absent = fontFamily. |
| `codePalette` | object → [theme.codePalette](#themecodepalette) | Token colours for code elements. |
| `color` | colour **required** | Default text colour (palette slot tx1). |
| `fontFamily` | string **required** | Font stack for body text; a full-document text box without fontFamily draws in it. |
| `headingFamily` | string | Display face for headings. Absent = fontFamily. |
| `palette` | object → [theme.palette](#themepalette) | Further named brand slots that themeRefs can point at. |
| `table` | object → [Table style](#table-style) | Defaults for newly inserted tables; existing tables keep their own style. |
| `tokens` | object → [theme.tokens](#themetokens) | Design tokens: named values element properties bind to with themeRefs "$name". |

### `theme.palette`

`theme.background`, `theme.color` and `theme.accent` are the slots `bg1`, `tx1` and `accent1`; these are the rest.

| Key | Type | Meaning |
|---|---|---|
| `accent2` | colour | Accent slot 2. |
| `accent3` | colour | Accent slot 3. |
| `accent4` | colour | Accent slot 4. |
| `accent5` | colour | Accent slot 5. |
| `accent6` | colour | Accent slot 6. |
| `bg2` | colour | Second background slot. |
| `folHlink` | colour | Followed-hyperlink colour slot. |
| `hlink` | colour | Hyperlink colour slot. |
| `tx2` | colour | Second text slot. |

### `theme.codePalette`

| Key | Type | Meaning |
|---|---|---|
| `a` | colour | Diff additions. |
| `c` | colour | Comments. |
| `d` | colour | Diff deletions. |
| `f` | colour | Function calls. |
| `k` | colour | Keywords. |
| `n` | colour | Numbers. |
| `p` | colour | Punctuation. |
| `s` | colour | Strings. |

### `theme.tokens`

| Key | Type | Meaning |
|---|---|---|
| `mode` | string | The active mode. Absent = the first. Switching it rewrites every bound literal. |
| `modes` | array of string | Mode names in order (e.g. light, dark). Absent = the single mode "default". |
| `set` | map of { type, values } **required** | Token name → { type, values: { mode → value } }. Names match `[A-Za-z][\w.-]*`, up to 64 characters. Token types: `color`, `number`, `fontFamily`, `fontSize`, `shadow`, `opacity`. |

### `present`

| Key | Type | Meaning |
|---|---|---|
| `controls` | boolean | Arrow buttons in the corner while presenting. Default false. |
| `morphSeconds` | number 0–60 | Morph duration in seconds. Absent = 0.65; clamped to 0.1–6 on read. |
| `numberHidden` | boolean | true: hidden slides keep their page number. Default false (skipped slides are uncounted). |
| `progress` | boolean | The show's progress bar along the bottom. Default true. |
| `slideNumber` | boolean | The show's "3 / 12" counter. Default true; switch it off when the slides number themselves. |
| `typeWriterSeconds` | number 0.08–1 | Typewriter pace, seconds per character. Absent = 0.08; a whole run never takes longer than 6 s. |

### `size`

| Key | Type | Meaning |
|---|---|---|
| `height` | number **required** | Slide height in px. |
| `width` | number **required** | Slide width in px. |

### `meta`

| Key | Type | Meaning |
|---|---|---|
| `author` | string | Fills {{author}}. |
| `company` | string | Fills {{company}}. |
| `event` | string | Fills {{event}}. |
| `keywords` | string | Keywords; provenance only, no field token. |
| `subject` | string | Fills {{subject}}. |

### `fonts[]`

| Key | Type | Meaning |
|---|---|---|
| `asset` | string **required** | `asset:<key>` (a woff2 data URI in assets), or a face the app carries by builtin: key, with no bytes in the file. Built in: `builtin:fraunces-900`, `builtin:instrument-sans`. |
| `family` | string **required** | The family name text uses in its font stack. |
| `style` | string | CSS font-style ("normal", "italic"). |
| `weight` | string | CSS font-weight the face covers ("900", "400 700"). |

### Slide

| Key | Type | Meaning |
|---|---|---|
| `background` | colour | Slide background colour. A full document's slide without it is white, not theme.background. |
| `comments` | array → [slide.comments[]](#slidecomments) | Review threads. Saved in the file, never drawn in the show or print. |
| `elements` | array → [Every element](#every-element) | The slide's elements. Array order is paint order: the first is at the back. |
| `hidden` | boolean | Out of the show (arrow keys skip it, PDF leaves it out) but reachable by a link: backup and appendix slides. |
| `hover` | object → [slide.hover](#slidehover) | Present-mode hover: focus-group dims elements outside the hovered group; reveal swaps showOnHover sets. |
| `id` | string **required** | Stable slide id; links, stateOf and morphs reference it. |
| `name` | string | Friendly name for link pickers and state badges. |
| `notes` | string | Speaker notes; they travel in the file. |
| `stateOf` | string | This slide is a hidden variant of the named slide, reached only by links; ← returns to the parent. |
| `themeRefs` | map of string | Palette slot or $token for the slide's own colours (background). A token can drive `background`. |
| `transition` | `none`, `fade`, `slide`, `zoom`, `morph` | How the slide arrives; morph tweens elements that share a morph key with the previous slide. |
| `unnumbered` | boolean | In the walk but takes no page number: {{page}} shows the previous slide's, so a build over several morph slides reads as one page. |

### `slide.hover`

| Key | Type | Meaning |
|---|---|---|
| `default` | string | reveal: the showOnHover set visible while nothing is hovered. |
| `dim` | number 0–1 | focus-group: opacity of the elements outside the hovered group. Absent = 0.13. |
| `type` | `focus-group`, `reveal` **required** | focus-group or reveal. |

### `slide.comments[]`

| Key | Type | Meaning |
|---|---|---|
| `at` | string | ISO timestamp. |
| `author` | string | Who wrote it. |
| `elementId` | string | The element the thread is pinned to. Absent (or dangling) = the slide. |
| `id` | string | Thread id. |
| `replies` | array of { id, author, text, at } | Replies: { id, author, text, at }. |
| `resolved` | boolean | The thread is resolved. |
| `text` | string | The comment. |
| `x` | number | Point anchor in slide px, when no elementId. |
| `y` | number | Point anchor in slide px, when no elementId. |

### Every element

Keys every element type has (`text`, `shape`, `image`, `svg`, `chart`, `table`, `media`, `embed`, `code`). `x y w h` are slide px from the top-left.

| Key | Type | Meaning |
|---|---|---|
| `alt` | string | What a screen reader says for a non-text element. Absent = decorative. |
| `backdropFilter` | number | Frosted-glass blur of what lies behind, px. Screen only: print drops it. |
| `blend` | string | CSS mix-blend-mode (screen, multiply, overlay …). Absent = normal. |
| `blur` | number | Gaussian blur on the element, px. |
| `blurHidden` | boolean | The blur is switched off but kept. |
| `component` | object → [component](#component) | Component membership: elements sharing component.id form a component; main marks the main, every other set is a copy. |
| `fillHidden` | boolean | The fill is switched off but kept. |
| `flipX` | boolean | Drawn mirrored across the vertical centre line; the box is unchanged. |
| `flipY` | boolean | Drawn mirrored across the horizontal centre line; the box is unchanged. |
| `fx` | object → [fx](#fx) | Presentation effects: entrance, click step, count-up, ambient motion, loops. Run while presenting only. |
| `group` | string | Semantic group tag that hover focus and reveal target. |
| `groupId` | string | Editor grouping: elements sharing it select and move as one. |
| `groupName` | string | The group's name in the layer list, carried by every member. |
| `h` | number | Height in slide px. |
| `hidden` | boolean | Not drawn anywhere (canvas, show, print, preview); still listed in Layers. |
| `id` | string **required** | Identity on the slide, and the default morph key: elements sharing it across adjacent slides morph. |
| `keepAspectRatio` | boolean | Resizing keeps the proportions. Images read absent as true, everything else as false. |
| `link` | string | Click target while presenting: a slide id, or an http(s) URL (opens in a new tab). |
| `locked` | boolean | Editor lock: canvas clicks and marquees skip it. Ignored by present and print. |
| `morphId` | string | Morph key override: pairs with an element whose morphId or id matches, without touching id. Unique within a slide. |
| `name` | string | The author's name for it in the layer list. Display only. |
| `opacity` | number 0–1 | 0 transparent to 1 opaque. |
| `parentId` | string | The auto-layout frame (a rect with layout) this element sits in; the frame derives its x/y/w/h. |
| `role` | string | What it is on the slide; a layout (and compact input) places content by role. The built-in layouts use `title`, `subtitle`, `body`, `left`, `right`, `kicker`, `card1`, `card2`, `card3`, `quote`, `attribution`, `image`. |
| `rotation` | number | Degrees, clockwise. |
| `shadow` | object → [shadow](#shadow) or array → [shadow](#shadow) | Drop shadow(s) following the element's alpha shape; an array stacks. |
| `shadowHidden` | boolean | The shadow is switched off but kept. |
| `showOnHover` | string | Visible only while an element whose group equals this value is hovered (slide hover type reveal). |
| `sizing` | object → [sizing](#sizing) | Inside a frame: fill takes the frame's free space on that axis; absent = fixed. |
| `strokeHidden` | boolean | The stroke is switched off but kept. |
| `themeRefs` | map of string | Property path → palette slot ("accent1", "accent1 -20%") or design token ("$name"). The literal stays on the element and must equal what the ref resolves to. A token can drive a path under `fill`, `fillGradient`, `fills`, `stroke`, `strokeWidth`, `strokeGradient`, `strokes`, `strokeDashes`, `radius`, `radii`, `opacity`, `color`, `colorGradient`, `textStroke`, `fontSize`, `fontFamily`, `fontWeight`, `letterSpacing`, `lineHeight`, `shadow`, `blur`, `backdropFilter`, `layout`, `w`, `h`, `style`. |
| `type` | `"text"` **required** | The element type. |
| `w` | number | Width in slide px. |
| `x` | number | Left edge in slide px. |
| `y` | number | Top edge in slide px. |

### Element: `text`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `align` | `left`, `center`, `right` | Horizontal alignment. |
| `color` | colour | Text colour. |
| `colorGradient` | object → [Gradient](#gradient) | A gradient painted into the glyphs; wins over color. |
| `fontFamily` | string | CSS font stack. Omit it in a full document and the box follows theme.fontFamily. |
| `fontSize` | number | Font size in px. |
| `fontWeight` | number | CSS font weight (400 regular, 700 bold). |
| `html` | string **required** | The text as sanitized HTML. Inline b strong i em u s code br span a, blocks p div h1 h2 ul ol li; attributes stripped except an http(s) href. $…$ and $$…$$ are maths; {{page}} and friends resolve at render. |
| `letterSpacing` | number | Tracking in px. |
| `lineHeight` | number 0–100 | Line height as a multiple of the font size. |
| `placeholder` | string | Dimmed prompt shown in the editor while html is empty; the element is hidden in the show and print while empty. |
| `textStroke` | object → [textStroke](#textstroke) | Outline glyphs; fill "none" makes them hollow. |
| `valign` | `top`, `middle`, `bottom` | Vertical alignment inside the box. |

### Element: `shape`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `bool` | object → [bool](#bool) | A vector boolean: d/pathBox hold the computed outline; the operands ride along for re-editing. |
| `d` | string | Path only: SVG path data in pathBox coordinates. |
| `fill` | colour **required** | Fill colour; on a line, the line's colour. Mirrors the top layer when fills is set. |
| `fillGradient` | object → [Gradient](#gradient) | Gradient fill; wins over fill, which stays as the solid fallback. |
| `fills` | array → [fills[] layer](#fills-layer) | Fill stack, bottom first (two or more layers). When set, fill/fillGradient mirror the top visible layer. |
| `from` | object → [from / to](#from--to) | Connector start: follows an element's border (line or path only). |
| `heads` | `2` | Arrow only: 2 puts a head at both ends. |
| `layout` | object → [layout (frame)](#layout-frame) | Makes a rect a frame that lays out the elements whose parentId names it. |
| `lineEnd` | `none`, `arrow`, `dot`, `bar`, `arrow-open`, `triangle`, `triangle-open`, `diamond`, `diamond-open`, `square`, `circle-open` | Tip at a line's or open path's end. |
| `lineStart` | `none`, `arrow`, `dot`, `bar`, `arrow-open`, `triangle`, `triangle-open`, `diamond`, `diamond-open`, `square`, `circle-open` | Tip at a line's or open path's start. |
| `pathBox` | [4 numbers] | Path only: [x, y, w, h] viewBox the path was drawn in, stretched into the element box. |
| `radii` | [4 numbers] | Per-corner radius [top-left, top-right, bottom-right, bottom-left], rect only; wins over radius. |
| `radius` | number | Corner radius, rect only. |
| `shape` | `rect`, `ellipse`, `triangle`, `arrow`, `line`, `path` **required** | Which shape. |
| `stroke` | colour | Outline colour ("transparent" or "none" for none). |
| `strokeAlign` | `inside`, `center`, `outside` | Where the stroke sits on the outline. Absent = inside on rect, ellipse, triangle; centred on arrow and path. |
| `strokeDash` | number | Legacy dash length, px; strokeStyle wins. |
| `strokeDashes` | [2 numbers] | [dash, gap] in px; wins over strokeStyle. |
| `strokeGradient` | object → [Gradient](#gradient) | Gradient along the stroke; wins over stroke (a line's fill). |
| `strokeStyle` | `solid`, `dashed`, `dotted` | Stroke pattern; dash-march loops need dashed or dotted. |
| `strokeWidth` | number | Outline width, px. |
| `strokes` | array → [strokes[] layer](#strokes-layer) | Stroke stack, bottom first (two or more layers). When set, stroke/strokeWidth/strokeAlign/strokeDashes mirror the top visible layer. |
| `to` | object → [from / to](#from--to) | Connector end: follows an element's border (line or path only). |

### Element: `image`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `crop` | object → [crop](#crop) | Pan and zoom inside the frame. Absent = fit alone. |
| `fit` | `contain`, `cover`, `fill` | How the picture fills the box. |
| `radius` | number | Corner radius, px. |
| `src` | string **required** | data: URI or `asset:<key>`. |

### Element: `svg`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `asset` | string | Key into assets holding raw SVG markup (preferred: dedupes). |
| `css` | string | CSS injected inside the svg, scoped to it (hover states, animations). |
| `markup` | string | Raw inline SVG markup, used when asset is unset. |

### Element: `chart`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `option` | object **required** | ECharts-shaped option as plain JSON, drawn by charts-lite. Bar and line data are plain numbers; template formatters only. |
| `preset` | string | The panel's re-seed key: bar, line, pie or scatter. |
| `source` | object → [source](#source) | Live binding: labels and series values track a table element. |

### Element: `table`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `columns` | array of { w } **required** | Column weights, normalised at render; one entry per column. |
| `header` | boolean | Row 0 is a styled header row. |
| `rows` | array → [Table rows[]](#table-rows) **required** | The rows, each { cells: [...] }. |
| `style` | object → [Table style](#table-style) | The table-wide look; cells carry only overrides. |

### Element: `media`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `autoplay` | boolean | Starts on arrival, in the show only; video needs muted. |
| `controls` | boolean | Shows the player controls. |
| `fit` | `contain`, `cover`, `fill` | Video only: how the frame fills the box. |
| `kind` | `video`, `audio` **required** | video or audio. |
| `loop` | boolean | Restarts at the end. |
| `muted` | boolean | No sound; required for video autoplay. |
| `poster` | string | Video only: still shown before playback. |
| `radius` | number | Corner radius, px. |
| `src` | string **required** | data: URI (embedded), URL or relative path (referenced), or `asset:<key>`. |

### Element: `embed`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `app` | string | The app that made it (bento/dash, bento/type …), or web for a page. |
| `doc` | string or object | The source: plain JSON or `asset:<key>`. |
| `live` | boolean | Opt in to a sandboxed live frame over the view while online. |
| `url` | string | app web only: the http(s) page a live frame loads. |
| `view` | string | The static render that always paints: raw `<svg>` markup or `asset:<key>`. Required in practice. |

### Element: `code`

Its own keys, beside the ones [every element](#every-element) has.

| Key | Type | Meaning |
|---|---|---|
| `align` | `left`, `center`, `right` | Horizontal alignment. |
| `color` | colour | Base text colour before token colours apply. |
| `content` | string | The source text, plain (not HTML). |
| `fontFamily` | string | CSS font stack. Absent = theme.codeFontFamily, then theme.fontFamily. |
| `fontSize` | number | Font size in px. |
| `grammarAssetId` | string | Reserved: a grammar carried as a deck asset. Not used by the current shell. |
| `grammarName` | string | The language that colours it. Absent = js. Built in: `js`, `ts`, `py`, `rust`, `go`, `java`, `sh`, `sql`, `c`, `cpp`, `csharp`, `kotlin`, `swift`, `scala`, `dart`, `zig`, `php`, `ruby`, `perl`, `lua`, `r`, `julia`, `powershell`, `haskell`, `elixir`, `erlang`, `clojure`, `ocaml`, `fsharp`, `json`, `yaml`, `toml`, `ini`, `xml`, `html`, `css`, `graphql`, `proto`, `dockerfile`, `makefile`, `asm`, `elm`, `nim`, `crystal`, `solidity`, `hcl`, `nix`, `matlab`, `fortran`, `pascal`, `groovy`, `verilog`, `vhdl`, `latex`, `objc`, `scheme`, `lisp`, `prolog`, `ada`, `d`, `gleam`, `batch`, `awk`, `tcl`, `vb`, `scss`, `nginx`, `jinja`, `sparql`, `cypher`, `fish`, `apex`, `purescript`, `odin`, `zsh`, `diff`, `patch`, `md`, `markdown`; anything else is coloured as `js`. |
| `lineHeight` | number 0–100 | Line height as a multiple of the font size. |
| `themeAssetId` | string | Reserved: a colour theme carried as a deck asset. Not used by the current shell. |
| `themeName` | string | Reserved: a named colour theme. Token colours come from theme.codePalette. |
| `valign` | `top`, `middle`, `bottom` | Vertical alignment inside the box. |

### `component`

| Key | Type | Meaning |
|---|---|---|
| `id` | string **required** | The component; every element of the main and of each copy carries it. |
| `key` | string **required** | Pairs a copy's element with its counterpart in the main. |
| `main` | `true` | Marks the main's elements. |
| `off` | [2 numbers] | A copy's [dx, dy] offset from its main, written by the app. |
| `over` | array of string | A copy's own overrides: the keys it does not take from the main. |
| `sig` | string | Hash of the main state a copy last followed, written by the app. Omit it: without it a copy's differences count as overrides. |

### `fx`

Presentation effects. They run while presenting only.

| Key | Type | Meaning |
|---|---|---|
| `ambient` | `kenburns` | Continuous ambient motion: kenburns, for full-bleed photos. |
| `countUp` | boolean | Animate the numbers in the text from 0. |
| `enter` | `fade-up`, `fade`, `fade-down`, `slide-left`, `slide-right`, `slide-up`, `slide-down` | Entrance animation when the slide shows. Skipped for an element that morphs in from the previous slide. |
| `enterDur` | number | Entrance duration in seconds. Absent = 0.75 for slide-*, 0.55 for fade-*. |
| `ken` | object → [fx.ken](#fxken) | Ken-burns tuning. |
| `loop` | object → [fx.loop](#fxloop) | A continuous loop: dash-march or motion-path. |
| `order` | number | Stagger order in the entrance sequence; equal values enter together. |
| `step` | number | Click build: 1 or more hides the element until the n-th → reveals it (with its enter, or a fade). Absent/0 = shown with the slide. |
| `typeWriter` | boolean | Code only: the text types in a character at a time when it appears. |

### `fx.ken`

| Key | Type | Meaning |
|---|---|---|
| `dir` | `drift`, `out`, `in` | drift (default) loops a slow zoom; out and in play once per arrival. |
| `duration` | number | Seconds. |
| `scale` | number 0–100 | The far end of the zoom, e.g. 1.08. |

### `fx.loop`

| Key | Type | Meaning |
|---|---|---|
| `delay` | number | motion-path: seconds before the first lap. |
| `distance` | number | dash-march: px the dashes travel per lap. |
| `duration` | number | Seconds per lap (required for motion-path). |
| `ease` | string | motion-path: easing over each lap. Default none (constant tempo). |
| `path` | string | motion-path: SVG path data relative to the element's resting position (the first anchor is where it sits). |
| `speeds` | array of number | motion-path: one speed multiplier per anchor (1 normal, below 1 dwells, above 1 rushes). |
| `type` | `dash-march`, `motion-path` **required** | dash-march marches a dashed stroke; motion-path moves the element along path. |

### `shadow`

One shadow, or an array of them (they stack).

| Key | Type | Meaning |
|---|---|---|
| `blur` | number **required** | Blur radius, px. |
| `color` | colour **required** | Shadow colour (rgba for softness). |
| `x` | number | Horizontal offset, px. |
| `y` | number | Vertical offset, px. |

### Gradient

The shape of `fillGradient`, `strokeGradient`, `colorGradient` and a paint layer's `gradient`.

| Key | Type | Meaning |
|---|---|---|
| `angle` | number | Degrees, CSS convention: 0 = bottom→top, 90 = left→right. |
| `cx` | number -10–10 | Radial centre x as a fraction of the box. Default 0.5. |
| `cy` | number -10–10 | Radial centre y as a fraction of the box. Default 0.5. |
| `kind` | `radial` | radial: stops run from (cx, cy) out to r. Absent = linear. |
| `r` | number 0–100 | Radial radius as a fraction of the box. Default 0.5. |
| `stops` | array of { at, color } **required** | Ordered stops { at: 0..1, color }. |

### `fills[]` layer

| Key | Type | Meaning |
|---|---|---|
| `blend` | `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` | How the layer mixes with what lies beneath it. Absent = normal. |
| `color` | colour **required** | The layer's colour; with a gradient, its solid fallback. |
| `gradient` | object → [Gradient](#gradient) | A gradient for this layer. |
| `hidden` | boolean | Kept but not drawn. |

### `strokes[]` layer

| Key | Type | Meaning |
|---|---|---|
| `align` | `inside`, `center`, `outside` | Where the stroke sits on the outline. |
| `blend` | `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` | How the layer mixes with what lies beneath it. Absent = normal. |
| `color` | colour **required** | The layer's colour; with a gradient, its solid fallback. |
| `dashes` | [2 numbers] | [dash, gap] in px. |
| `gradient` | object → [Gradient](#gradient) | A gradient along the stroke. |
| `hidden` | boolean | Kept but not drawn. |
| `width` | number **required** | Stroke width, px. |

### `from` / `to`

| Key | Type | Meaning |
|---|---|---|
| `el` | string **required** | Id of the element this end follows, on the same slide. |
| `side` | `auto`, `top`, `right`, `bottom`, `left` | Which border to attach to; auto picks the nearest. |

### `layout` (frame)

| Key | Type | Meaning |
|---|---|---|
| `align` | `start`, `center`, `end`, `stretch` | Cross-axis alignment; stretch fills it. Default start. |
| `clip` | boolean | Children are clipped to the frame. |
| `cols` | number 1–64 | Grid only: number of columns. Default 2. |
| `dir` | `row`, `col`, `grid` **required** | Main axis: row, col, or a grid of equal cells. |
| `gap` | number **required** | Space between children, px. |
| `hug` | boolean | The frame sizes itself to its children. |
| `justify` | `start`, `center`, `end`, `space-between` | Main-axis distribution. Default start. |
| `pad` | [4 numbers] **required** | Padding inside the frame [top, right, bottom, left], px. |
| `wrap` | boolean | Row/col only: a child that would pass the edge starts a new line. |

### `sizing`

| Key | Type | Meaning |
|---|---|---|
| `h` | `fixed`, `fill` | fill takes the frame's free height; fixed (or absent) keeps h. |
| `minH` | number | In a wrapping frame, the least height a fill child counts as when lines break. |
| `minW` | number | In a wrapping frame, the least width a fill child counts as when lines break. |
| `w` | `fixed`, `fill` | fill takes the frame's free width; fixed (or absent) keeps w. |

### `bool`

| Key | Type | Meaning |
|---|---|---|
| `op` | `union`, `subtract`, `intersect`, `exclude` **required** | The operation. |
| `shapes` | array of { align, alt, backdropFilter, blend, blur, blurHidden, color, colorGradient, component, fillHidden, flipX, flipY, fontFamily, fontSize, fontWeight, fx, group, groupId, groupName, h, hidden, html, id, keepAspectRatio, letterSpacing, lineHeight, link, locked, morphId, name, opacity, parentId, placeholder, role, rotation, shadow, shadowHidden, showOnHover, sizing, strokeHidden, textStroke, themeRefs, type, valign, w, x, y } or { alt, backdropFilter, blend, blur, blurHidden, bool, component, d, fill, fillGradient, fillHidden, fills, flipX, flipY, from, fx, group, groupId, groupName, h, heads, hidden, id, keepAspectRatio, layout, lineEnd, lineStart, link, locked, morphId, name, opacity, parentId, pathBox, radii, radius, role, rotation, shadow, shadowHidden, shape, showOnHover, sizing, stroke, strokeAlign, strokeDash, strokeDashes, strokeGradient, strokeHidden, strokeStyle, strokeWidth, strokes, themeRefs, to, type, w, x, y } or { alt, backdropFilter, blend, blur, blurHidden, component, crop, fillHidden, fit, flipX, flipY, fx, group, groupId, groupName, h, hidden, id, keepAspectRatio, link, locked, morphId, name, opacity, parentId, radius, role, rotation, shadow, shadowHidden, showOnHover, sizing, src, strokeHidden, themeRefs, type, w, x, y } or { alt, asset, backdropFilter, blend, blur, blurHidden, component, css, fillHidden, flipX, flipY, fx, group, groupId, groupName, h, hidden, id, keepAspectRatio, link, locked, markup, morphId, name, opacity, parentId, role, rotation, shadow, shadowHidden, showOnHover, sizing, strokeHidden, themeRefs, type, w, x, y } or { alt, backdropFilter, blend, blur, blurHidden, component, fillHidden, flipX, flipY, fx, group, groupId, groupName, h, hidden, id, keepAspectRatio, link, locked, morphId, name, opacity, option, parentId, preset, role, rotation, shadow, shadowHidden, showOnHover, sizing, source, strokeHidden, themeRefs, type, w, x, y } or { alt, backdropFilter, blend, blur, blurHidden, columns, component, fillHidden, flipX, flipY, fx, group, groupId, groupName, h, header, hidden, id, keepAspectRatio, link, locked, morphId, name, opacity, parentId, role, rotation, rows, shadow, shadowHidden, showOnHover, sizing, strokeHidden, style, themeRefs, type, w, x, y } or { alt, autoplay, backdropFilter, blend, blur, blurHidden, component, controls, fillHidden, fit, flipX, flipY, fx, group, groupId, groupName, h, hidden, id, keepAspectRatio, kind, link, locked, loop, morphId, muted, name, opacity, parentId, poster, radius, role, rotation, shadow, shadowHidden, showOnHover, sizing, src, strokeHidden, themeRefs, type, w, x, y } or { alt, app, backdropFilter, blend, blur, blurHidden, component, doc, fillHidden, flipX, flipY, fx, group, groupId, groupName, h, hidden, id, keepAspectRatio, link, live, locked, morphId, name, opacity, parentId, role, rotation, shadow, shadowHidden, showOnHover, sizing, strokeHidden, themeRefs, type, url, view, w, x, y } or { align, alt, backdropFilter, blend, blur, blurHidden, color, component, content, fillHidden, flipX, flipY, fontFamily, fontSize, fx, grammarAssetId, grammarName, group, groupId, groupName, h, hidden, id, keepAspectRatio, lineHeight, link, locked, morphId, name, opacity, parentId, role, rotation, shadow, shadowHidden, showOnHover, sizing, strokeHidden, themeAssetId, themeName, themeRefs, type, valign, w, x, y } **required** | The operand shapes, bottom first, in slide coordinates as they were when combined. |

### `textStroke`

| Key | Type | Meaning |
|---|---|---|
| `color` | colour **required** | Outline colour. |
| `fill` | colour | Glyph interior; "none" for hollow letters. Absent = the text colour. |
| `width` | number **required** | Outline width, px. |

### `crop`

| Key | Type | Meaning |
|---|---|---|
| `scale` | number 1–64 **required** | Zoom beyond cover-fit, 1 or more. |
| `x` | number 0–1 **required** | Which edge of the enlarged picture the frame aligns to horizontally: 0 left, 0.5 centre, 1 right. |
| `y` | number 0–1 **required** | Vertical alignment the same way: 0 top, 1 bottom. |

### `source`

| Key | Type | Meaning |
|---|---|---|
| `tableId` | string **required** | The table element's id on the same slide. |

### Table `style`

Also the shape of `theme.table`, where every key is optional.

| Key | Type | Meaning |
|---|---|---|
| `borderColor` | colour | Cell border colour. |
| `borderWidth` | number | Cell border width, px. |
| `cellPadX` | number | Horizontal cell padding, px. |
| `cellPadY` | number | Vertical cell padding, px. |
| `color` | colour | Body cell text colour. |
| `fontFamily` | string | Cell font stack. Absent = theme.fontFamily. |
| `fontSize` | number | Cell font size, px. |
| `headerBg` | colour | Header row background. |
| `headerColor` | colour | Header row text colour. |
| `radius` | number | Outer corner radius, px. |
| `zebra` | colour | Stripe colour for alternate body rows. Absent = no stripes. |

### Table `rows[]`

| Key | Type | Meaning |
|---|---|---|
| `cells` | array → [Table cells[]](#table-cells) **required** | The row's cells, one per column. |

### Table `cells[]`

| Key | Type | Meaning |
|---|---|---|
| `align` | `left`, `center`, `right` | Horizontal alignment in the cell. |
| `bg` | colour | Background override. |
| `bold` | boolean | Bold override. |
| `color` | colour | Text colour override. |
| `html` | string | Cell content: the same sanitized subset as text html. |
<!-- /generated -->

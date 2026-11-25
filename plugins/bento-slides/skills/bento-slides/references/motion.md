# Motion: morph, builds, entrances, loops, states, hover

Read this when the material changes across slides, is revealed step by step,
drills into detail, or needs an entrance, a loop or hover behaviour. All of it
runs while presenting; the editor and print show the slide at rest. If the
deck already has a motion style (its transitions, its entrance kinds and
timing), match it.

## Transitions and morph

A slide's `transition` is `none`, `fade`, `slide`, `zoom` or `morph`. On a
`morph` slide, every element whose morph key matches an element on the
previous slide tweens from there: position, size, colour and gradients.
The morph key is `morphId` when set, else `id`; it must be unique within a
slide.

```json
{ "compact": true, "slides": [
  { "id": "s1", "transition": "none", "elements": [
    { "id": "headline", "type": "text", "x": 96, "y": 140, "w": 900, "h": 200, "html": "Big claim.", "fontSize": 120, "fontWeight": 900 },
    { "id": "bar", "type": "shape", "shape": "rect", "x": 96, "y": 380, "w": 320, "h": 16, "fill": "#E8442E" } ] },
  { "id": "s2", "transition": "morph", "elements": [
    { "id": "headline", "type": "text", "x": 96, "y": 84, "w": 500, "h": 80, "html": "Big claim.", "fontSize": 40, "fontWeight": 900 },
    { "id": "bar", "type": "shape", "shape": "rect", "x": 96, "y": 170, "w": 16, "h": 450, "fill": "#E8442E" } ] } ] }
```

The headline shrinks into a running head and the bar swings upright. (This is
the compact form; written into the file, each element carries its type's
full key set, `SKILL.md` section 6.)

- Carrying two to four ids through a run of slides and rearranging them is
  what makes a deck feel continuous. Generated ids need to be deterministic,
  so a re-run produces the same pairs.
- `morphId` pairs two elements whose ids differ; it is the simpler choice when
  a generator creates each slide on its own.
- `present.morphSeconds` sets how long a morph takes (0.65 s when absent).

## Click builds

`fx.step` reveals an element on a click within one slide: an element with
`"fx": { "step": 1 }` is hidden when the slide appears and shown on the first
→, running its `fx.enter` (or a fade); `step: 2` on the second, and so on.
← hides the last step again, and → leaves the slide only once every step is
shown. Elements without a step are there from the start. It stays one slide
with one page number, and a shell that predates steps shows everything at
once.

A build made of several slides instead (each morphing into the next) can mark
the later ones `"unnumbered": true`: they stay in the walk but reuse the page
number of the slide before them.

## Entrances

`fx.enter` is one of `fade-up`, `fade`, `fade-down`, `slide-left`,
`slide-right`, `slide-up`, `slide-down`. `fx.order` staggers them (equal
values enter together) and `fx.enterDur` sets the duration in seconds (0.55
for `fade-*`, 0.75 for `slide-*` when absent).

On a morph arrival the rule is per element: an element with a morph partner on
the previous slide morphs, and its `fx.enter` and `fx.countUp` are skipped; an
element without one is new to the slide, so both run, and without an
`fx.enter` it fades in with a short rise.

`fx.countUp: true` counts the numbers in a text box up from zero when it
appears. `fx.typeWriter: true` types a `code` element in a character at a time;
`present.typeWriterSeconds` sets the pace.

## Ambient motion and loops

- **Ken-burns** on a photograph:
  `"fx": { "ambient": "kenburns", "ken": { "dir": "drift", "scale": 1.08, "duration": 20 } }`.
  `drift` loops; `out` and `in` play once when the slide appears. For a
  full-bleed photo: the image at the full canvas, a translucent scrim rect
  over it, then the text.
- **`dash-march`**: `"fx": { "loop": { "type": "dash-march", "distance": 18, "duration": 1.4 } }`
  marches a stroke's dashes along a line or path. It needs a visible stroke
  and `strokeStyle: "dashed"` or `"dotted"`; on a solid stroke there is
  nothing to see, and `validate()` reports `dash-march-no-dash`.
- **`motion-path`**: `"fx": { "loop": { "type": "motion-path", "path": "M0,0 C60,-40 140,40 200,0", "duration": 6 } }`
  drifts the element along a path relative to where it rests; `delay`,
  `ease` and `speeds` (one multiplier per on-curve point) are optional. An
  entrance on the same element fights the loop over its transform, so give it
  one or the other (`validate()` reports `entrance-on-motion-path`).

## States, hidden slides and links

- An element's `link` is a slide id (jump there when clicked while
  presenting) or an `http(s)` URL (opens in a new tab).
- A slide with `"stateOf": "<parent id>"` is a variant of that slide: the
  arrow keys skip it, a `link` reaches it, ← returns to the parent, and it
  morphs with the parent when ids are shared. Use it for "click to see
  detail".
- `"hidden": true` keeps a slide in the deck and out of the show (skipped by
  the arrow keys, left out of PDF export), still reachable by a `link`. Use it
  for backup material. `validate()` reports a hidden slide nothing links to.
- A padded transparent rect makes a better click target than the text itself.

## Hover

A slide's `hover` reacts to the pointer while presenting:

- `{ "type": "focus-group", "dim": 0.13 }` dims every element outside the
  hovered element's `group` (elements carry `"group": "<name>"`).
- `{ "type": "reveal", "default": "<group>" }` shows only the elements whose
  `showOnHover` names the hovered element's `group`; `default` is the set shown
  when nothing is hovered.

Click is for state slides; hover is for in-slide detail.

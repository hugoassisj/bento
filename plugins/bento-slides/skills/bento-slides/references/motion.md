# Motion: morph, builds, entrances

Read this when the material changes across slides or is revealed step by
step. All of it
runs while presenting; the editor and print show the slide at rest. If the
deck already has a motion style (its transitions, its entrance kinds and
timing), match it; otherwise keep motion to what explains a step. With reduced
motion asked for (the viewer's system setting, or M in the show) morphs,
entrances, count-ups and loops are skipped and each element shows its final
state; a click build still waits for its clicks, each step appearing at once.

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

# Loops, states, links and hover

Read this only when the brief asks for a looping motion, click-through detail
(a state slide or a link), a backup slide, or a hover reveal. A deck reads
fine without any of it, and the show skips every loop under reduced motion.

## Loops (optional)

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

# Defaults for when the deck doesn't decide

These never override the deck's own choices or the user's words.

Read this when you create a deck from nothing, or when an existing deck leaves
a choice open. Each default says when it applies and why it is a good
starting point. Where the deck already does something (its margins, its type
sizes, its accent), match the deck instead; where the user asked for
something, do that.

## Canvas and margins

- **Canvas.** If you are creating the deck and the user named no format,
  1280×720 (16:9) is a good default, because it is what the editor creates and
  what the built-in layouts are drawn for. If the deck has its own `size`,
  work in it; all coordinates are px on that canvas.
- **Side margins.** If the deck shows no margin of its own, 96 px left and
  right on a 1280-wide canvas (content between x 96 and x 1184) is a good
  default, because it is what the built-in layouts scale to and what
  `validate()`'s `past-margin` check assumes. If the deck's content sits
  elsewhere, measure its margin from its slides and pass it to
  `validate(undefined, { margin: … })`.
- **Columns.** If you are placing columns by hand inside 96 px margins on
  1280×720, these splits already end flush at x 1184, so no arithmetic is
  needed:

  | Split | Width | `x` positions | Gutter |
  |---|---|---|---|
  | 2 columns | 528 | 96, 656 | 32 |
  | 3 columns | 340 | 96, 470, 844 | 34 |
  | 4 columns | 254 | 96, 374, 652, 930 | 24 |
  | 60 / 40 (text + image) | 624 / 432 | 96, 752 | 32 |

  A row frame with `sizing: { "w": "fill" }` children does the same split for
  any width, so it is usually the better choice.
- **Vertical rhythm.** If the deck has no title band of its own, a title at
  `y 72`, `h 84` with content from `y 208` leaves 416 px of content height
  above a 96 px bottom margin, so the slide keeps the same margin on every
  side.

## Type

- **Faces.** If you are creating the deck and it carries no faces, the two
  the app ships are a good pair, because they cost no bytes: Fraunces 900 for
  display (`builtin:fraunces-900`) and Instrument Sans 400 to 700 for text
  (`builtin:instrument-sans`). Declare them in `doc.fonts` and write
  `"'Instrument Sans', system-ui, sans-serif"` as `theme.fontFamily`.
- **How many.** Two typefaces at most is a good default for a fresh deck,
  because a third rarely adds meaning and makes the hierarchy harder to read.
- **Sizes.** If the deck has no type scale, the built-in layouts' sizes are a
  reasonable one at 1280×720: about 60 px for a cover title, 35 px for a slide
  title, 19 to 21 px for body text, 14 px for a kicker. Body text much
  below 18 px is hard to read from the back of a room.
- **Headings that wrap.** If a title runs to a third line, shortening the
  words usually reads better than shrinking the type.

## Colour

- **Accent.** One accent colour is a good default for a fresh deck, because a
  single accent tells the viewer where to look; a second one competes. If the
  deck already uses several, keep using its set.
- **Contrast.** On a deck you are creating, text and shapes that contrast
  with their background are a good default, because a projector washes out
  what a screen shows. Inside a deck's own system,
  report weak contrast in the hand-off rather than recolouring.
- **Charts.** A fresh deck reads more calmly when charts take their series
  colours from the theme (`theme.chartPalette`, or the palette slots) than
  from the charting engine's default palette.

## Motion and structure

- **Motion with a purpose.** A deck reads well when motion follows meaning:
  morph between slides about the same thing, a click build for a list you
  talk through, a count-up for a headline number. A cover or section divider
  is a natural place for one quiet ambient motion (a ken-burns drift, a slow
  loop), and an easy one to overdo.
- **Speaker notes.** On a deck you are creating, notes on every slide are a
  good default, because they travel in the file and double as the talk
  track.
- **Show chrome.** If your slides number themselves (a `{{page}}` footer),
  set `"present": { "slideNumber": false }`, because the show otherwise draws
  its own counter on top of yours; add `"progress": false` if the design has
  its own progress mark.

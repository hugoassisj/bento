# Issue drafts for this fork

Issues are switched off on this fork, so the backlog lives here as files: **one Markdown file per issue**, grouped by epic, each with YAML front matter (`id`, `title`, `labels`, `priority`, `size`, `depends_on`) so it can be turned into a real GitHub issue mechanically.

- **Start with [`00-READ-FIRST.md`](00-READ-FIRST.md).** It is the shared contract: hard rules, the verification bar, label meanings.
- Every file was written from a hands-on audit of **bento/slides 1.3.0** (upstream `nyblnet/bento` `main` at `29b5c80`). File and line pointers are against that commit; re-verify before relying on them.
- IDs (`F-07`, `AI-12`, …) are stable. Cross-references use IDs, not issue numbers.
- [`IMPLEMENTATION-PROMPT.md`](IMPLEMENTATION-PROMPT.md) is a ready-to-paste prompt for a new Claude Code session that implements these in parallel on dedicated branches.
- To create real issues once Issues are enabled: `node issues/create-issues.mjs --dry-run`, then without the flag (uses the `gh` CLI; untested against GitHub, see the script header).

## Issue file shape

```markdown
---
id: F-07
title: "validator: field tokens are measured as literal text"
epic: 1-foundations
type: bug            # bug | enhancement | proposal
priority: P1         # P0 loses work or misleads silently · P1 blocks a common task · P2 friction · P3 polish
size: S              # S days · M a week or two · L a month or more
evidence: seen       # seen (reproduced in the running app) | code (read in source) | mixed
labels: [bug, "priority:P1", "size:S", "evidence:seen", "area:validator"]
depends_on: []       # IDs that must land first
related: [SC-01]     # IDs worth reading alongside
upstream: []         # e.g. ["nyblnet/bento#966"]
---
## Summary
## What the user experiences
## Reproduce
## Evidence
## How others do it
## Proposed change
## Acceptance criteria
## Tests
## Out of scope
## Notes for the implementer
```

## Order of work

Epics are numbered in the order they should be taken. Epic 1 unblocks most of the others; epics 2 and 4 share machinery (the patch language, the checker, themed layouts). Inside an epic take `P0` and `bug` first. Flags: **fmt** adds an optional key to the document format · **up** needs the upstream maintainer's answer before building for upstream · **k** touches the kernel zone.

### 1 · Shared foundations — [`1-foundations/`](1-foundations/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| F-01 | Built-in layouts and new elements follow the deck theme | enh | P1 | M | |
| F-02 | Theme presets on Start from scratch; apply a background to all slides | enh | P1 | M | |
| F-03 | Text boxes size themselves: click hugs, drag fixes the width, overflow badge with Shrink to fit | enh | P1 | M | |
| F-04 | Text pasted onto the slide keeps its formatting, fits its box, and does not stack | enh | P2 | S | |
| F-05 | Slide, layout and list actions become commands (shortcuts, palette, menus) | enh | P1 | M | |
| F-06 | ⌘K shows unavailable commands with the reason, and matches synonyms | enh | P2 | S | |
| F-07 | Validator measures field tokens as literal text (false overflow on the shipped starter) | bug | P1 | S | |
| F-08 | Validator flags what it silently accepts: unknown element type, invalid colour, dangling parent, string-typed numbers | enh | P1 | S | |
| F-09 | Validator sees what people see: contrast, overlap, text outside its frame, clipped chart labels | enh | P1 | M | |
| F-10 | Check deck panel: validator findings shown in the editor | enh | P1 | M | |
| F-11 | An unreadable document block silently opens the starter deck | bug | P0 | S | |

### 2 · AI authoring that works — [`2-ai-authoring/`](2-ai-authoring/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| AI-01 | Skill package rebuild: structure, precedence protocol, workflow, gotchas | enh | P1 | M | |
| AI-02 | Generated agent reference; rebuild the published guide from it; docs-drift test | enh | P1 | M | |
| AI-03 | Correct the wrong and missing statements in today's agent docs (interim patch) | bug | P1 | S | |
| AI-04 | `bento` agent CLI: new, extract, inspect, lint, render, apply | enh | P1 | L | |
| AI-05 | `scripts/bento-check.mjs` fails to produce a report | bug | P1 | S | |
| AI-06 | `window.bento.render()`: a public slide rasteriser | enh | P2 | S | |
| AI-07 | `window.bento.outline()`, `patch(ops)`, `stats()`: targeted edits for slides | enh | P1 | M | up |
| AI-08 | Compact input speaks the design system: token and slot names as values, `use`, `like`, theme defaults | enh | P1 | M | |
| AI-09 | Layout and role: an unknown role never drops content; add stats, timeline, big-number and chart layouts | enh | P1 | M | |
| AI-10 | Frames for agents: fit text after layout, fix stretch with hug, equal-height rows | enh | P1 | L | |
| AI-11 | `loadDoc` report computes findings before the layout pass | bug | P1 | S | |
| AI-12 | Report silent binding losses; add a stale-token finding | enh | P1 | M | |
| AI-13 | Change the accent as one operation; no stale bound values on disk | enh | P2 | M | |
| AI-14 | Replace from JSON that survives a chatbot: fences, trailing commas, truncation, summary before applying | enh | P1 | M | |
| AI-15 | Copy prompt for a chatbot: outline plus patch instructions, reply applied as a patch | enh | P2 | M | |
| AI-16 | Design-system-wins guard: protected-by-default patch; `unbound-literal` and `off-system` findings | enh | P2 | M | |
| AI-17 | Eval suite for the skill: baseline, brand-preservation cases, trigger set | enh | P1 | M | |
| AI-18 | Tool server exposing outline, read slide, inspect, patch, validate, render | enh | P3 | M | |

### 3 · The Showcase deck as the reference — [`3-showcase/`](3-showcase/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| SC-01 | Showcase validates clean; a deliberate bleed can be marked; CI gate | bug | P1 | S | |
| SC-02 | Showcase covers what shipped: builds, a picture with crop and alt text, media, modes, paint layers, booleans | enh | P1 | M | up |
| SC-03 | The tour is visible in the editor; stale chart notes corrected | enh | P1 | M | |
| SC-04 | Showcase as the model deck: every value bound, saved layouts, alt text on all visuals | enh | P2 | M | |
| SC-05 | Start from scratch: blank or keep this look; reset the title | enh | P1 | S | |

### 4 · The Assistant, finished and extended — [`4-assistant/`](4-assistant/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| AS-01 | Port the Assistant drawer (upstream PR #532) onto the 1.3.0 editor | enh | P1 | L | up |
| AS-02 | Assistant size budget: what to cut to approach 15 KB | enh | P2 | S | up |
| AS-03 | The Assistant knows the design system: tokens, components, frames, layouts | enh | P1 | M | up |
| AS-04 | Key window: a disposable-key host that needs no extension | enh | P1 | L | up |
| AS-05 | On-device model path with no key | enh | P2 | M | up |
| AS-06 | Actions where you work: selection bar, ⌘K fallthrough, starter prompts | enh | P1 | M | |
| AS-07 | Review before apply: before and after, per-change accept or reject, plain-language refusals | enh | P1 | L | |
| AS-08 | Variants as rendered thumbnails | enh | P2 | M | |
| AS-09 | Deck review: findings explained with offered fixes; the model sees the rendered slide | enh | P2 | M | |
| AS-10 | Assistant tasks: outline to deck, speaker notes, translate as a copy, alt text | enh | P2 | M | |

### 5 · The design system, for people who never used Figma — [`5-design-system/`](5-design-system/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| DS-01 | Auto layout presets (equal columns, equal rows, grid); Fill on a multi-selection; worded sizing labels | enh | P1 | M | |
| DS-02 | Built-in Three cards and Two columns layouts become auto-layout frames | enh | P2 | M | |
| DS-03 | Frames adopt what is drawn or dropped onto them | enh | P1 | S | |
| DS-04 | Library tab: components with thumbnails, search, drag to place | enh | P1 | M | |
| DS-05 | Editing a theme colour in a non-default mode silently overwrites every mode | bug | P1 | S | |
| DS-06 | Per-mode theme palette | enh | P2 | M | fmt |
| DS-07 | Token chips show value and name; usage counts are labelled | enh | P2 | S | |
| DS-08 | Add mode scrolls the left panel sideways and clips headings | bug | P2 | S | |
| DS-09 | Top toolbar jumps sideways when the selection changes | bug | P2 | S | |
| DS-10 | Worded Arrange menu and Tidy up | enh | P2 | M | |
| DS-11 | Design-token import and export (design-tokens JSON) | enh | P2 | M | |
| DS-12 | Proposal: token aliases and text styles | proposal | P3 | L | fmt |
| DS-13 | Proposal: component variants, properties and swap | proposal | P3 | L | fmt |
| DS-14 | Proposal: frame children placed absolutely, per-child alignment, grid spans, max size | proposal | P3 | L | fmt |

### 6 · Motion and presenting — [`6-motion-presenting/`](6-motion-presenting/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| MP-01 | Bullets build one at a time (per-paragraph steps) | enh | P1 | M | fmt |
| MP-02 | Build order list in the Animate tab | enh | P1 | L | |
| MP-03 | Clicking a step badge to reorder leaves two elements on the same step | bug | P2 | S | |
| MP-04 | Push, zoom and fade keep the outgoing slide opaque; labelled picker; per-slide duration | enh | P2 | M | fmt |
| MP-05 | Morph duration and easing per slide | enh | P2 | M | fmt |
| MP-06 | Present-only export: choose whether notes, comments and hidden slides are included | bug | P0 | S | |
| MP-07 | Black screen swallows the clicker | bug | P1 | S | |
| MP-08 | In-show help sheet; `?` dims the screen today; retire stray Reveal keys | enh | P2 | S | |
| MP-09 | Jump to a slide from the audience window: grid overlay, number then Enter | enh | P2 | M | |
| MP-10 | Speaker view: build steps, notes font size, timer pause and countdown | enh | P1 | M | |
| MP-11 | Laser pointer from the speaker view | enh | P2 | M | |
| MP-12 | Play slide in place | enh | P2 | M | |
| MP-13 | Hover reveal: one picker that writes all three settings, with a status line | enh | P2 | M | |
| MP-14 | PDF export options: a page per click step, notes pages, background quality | enh | P1 | M | |
| MP-15 | Present from the beginning; Present from here | enh | P3 | S | |
| MP-16 | Slide sections in the slide list | enh | P2 | M | fmt, up |
| MP-17 | Rehearse mode and timed auto-advance | enh | P3 | M | fmt |
| MP-18 | Audience view in its own window for a second monitor | enh | P3 | M | |
| MP-19 | Present mode on touch: visible exit and next; no silent exit on over-swipe | enh | P3 | S | |

### 7 · Data: paste, tables, charts — [`7-data/`](7-data/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| DT-01 | One spreadsheet-paste pipeline: canvas, cell, chart grid | enh | P1 | M | |
| DT-02 | Switching a chart's type discards its data | bug | P0 | S | |
| DT-03 | Chart from table: parse real-world numbers, say what was charted, fit the placement | bug | P1 | S | |
| DT-04 | Table structure editing: header strips; insert, delete and move rows and columns anywhere | enh | P1 | M | |
| DT-05 | Cell and range selection; a Cell section in the inspector | enh | P1 | L | |
| DT-06 | Table overflow: grow the box with its content; warn when it leaves the slide | enh | P1 | M | |
| DT-07 | Linked chart: lock the data grid; add a data-source picker | bug | P2 | S | |
| DT-08 | Chart data sheet: a wide grid docked under the canvas; scatter data UI | enh | P2 | M | |
| DT-09 | Chart engine: stacked bars, value labels, title, axis names, number format | enh | P2 | L | k |
| DT-10 | Code blocks: Tab indents; paste detects code; language guess | bug | P1 | S | |
| DT-11 | Count-up keeps formatting and counts only the chosen number | bug | P2 | S | |
| DT-12 | Fields and maths render inside table cells | enh | P3 | S | |
| DT-13 | New chart and table defaults: centred placement, readable axis text, content layouts | enh | P3 | S | |
| DT-14 | Maths: show the reason for invalid LaTeX | enh | P3 | S | |

### 8 · The first hour, and editor polish — [`8-first-hour/`](8-first-hour/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| FH-01 | Placeholder prompt text becomes real slide content | bug | P0 | S | |
| FH-02 | Tab in a plain text box leaves the box; the next keystrokes replace the text | bug | P0 | S | |
| FH-03 | Entering text editing places the caret where you clicked | enh | P1 | S | |
| FH-04 | Style part of a line: colour, size and font on a text run | enh | P1 | L | fmt |
| FH-05 | Empty state: open on a Title layout with the title focused; typing must not arm tools | enh | P1 | S | |
| FH-06 | Dropping an image or media file onto the canvas does nothing | bug | P1 | S | |
| FH-07 | Image placeholders: a real picture slot that fills and crops | enh | P2 | M | |
| FH-08 | Show on every slide: footers and repeated elements | enh | P2 | M | fmt |
| FH-09 | Menus and dialogs: keyboard and screen-reader semantics | bug | P1 | M | |
| FH-10 | Toasts are announced; failures offer an action | enh | P1 | S | |
| FH-11 | Slide list: keyboard focus; Move earlier and later | enh | P2 | M | |
| FH-12 | Lists: ordered-list autoformat; bullet and number buttons in the Text section | enh | P2 | S | |
| FH-13 | Crop with edge handles | enh | P3 | M | |
| FH-14 | First save asks for a name while the title is still the default | enh | P2 | S | |
| FH-15 | Side panels auto-collapse in a narrow window | enh | P2 | S | |
| FH-16 | Present mode for screen readers: hidden steps, alt text, focusable links | enh | P2 | M | |
| FH-17 | Editor accessibility: landmarks, forced-colors, field border contrast | enh | P3 | M | |
| FH-18 | Speaker view popup gets `dir` and `lang`; dates follow the UI locale | bug | P3 | S | |
| FH-19 | Polish batch: hidden-slide thumbnail, toast overprint, layout picker thumbnails, text colour label, fractional sizes | enh | P3 | S | |
| FH-20 | Find in deck, and jump to a slide, from ⌘K | enh | P2 | M | |

### 9 · Parked: phone editing — [`9-parked/`](9-parked/)

| ID | Title | Type | P | Size | Flags |
|---|---|---|---|---|---|
| PK-01 | Touch: a one-finger swipe moves an unselected element | bug | P2 | S | |
| PK-02 | Phone top bar: Undo and Format always visible | enh | P3 | S | |
| PK-03 | Slide long-press menu: Move up and Move down | enh | P3 | S | |
| PK-04 | Phone: Format as a bottom sheet; horizontal slide strip | enh | P3 | L | |

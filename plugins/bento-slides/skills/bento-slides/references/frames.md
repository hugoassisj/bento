# Auto-layout frames

Read this when you build a row, a column, a grid or a set of cards: a frame
places the children so you do not compute coordinates.

A frame is a `rect` shape with a `layout`; the elements whose `parentId` names
it are laid out inside it. Write `dir`, `gap` and `pad` on every `layout`: one
missing any of them is dropped (the load report says so) and the rect stops
being a frame. The app writes the children's boxes (and the frame's own size
when it hugs) every time the file opens and after every edit, so the file
stays ordinary positioned elements for any reader.

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

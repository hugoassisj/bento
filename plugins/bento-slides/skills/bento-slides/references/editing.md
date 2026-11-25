# Editing a deck on disk

Read this when you read or write a `.bento.html` file directly. `SKILL.md`
section 1 is the rule; these scripts follow it.

## Reading the block: `inspect.mjs`

`node inspect.mjs deck.bento.html` prints the outline and the design system
as JSON: everything step 1 of the workflow needs, with `collab` field names
but no values and an asset count but no data.

```js
// node inspect.mjs deck.bento.html
// Prints the deck's outline and design system as JSON. Never prints a
// collab value or picture data.
import { readFileSync } from 'node:fs'
const html = readFileSync(process.argv[2], 'utf8')
const block = /<script[^>]*\bid="bento-doc"[^>]*>([\s\S]*?)<\/script>/.exec(html)
if (!block) throw new Error('no #bento-doc block: not a bento file')
if (!block[1].trim()) { console.log('{"empty": true}'); process.exit(0) }
const { collab, assets, ...doc } = JSON.parse(block[1])
if (doc.format !== 'bento/slides') { console.log(JSON.stringify({ format: doc.format })); process.exit(0) }
// the element keys a binding can drive, less w and h (geometry, on every element)
const BINDABLE = ['fill', 'fillGradient', 'fills', 'stroke', 'strokeWidth', 'strokeGradient', 'strokes', 'strokeDashes',
  'radius', 'radii', 'opacity', 'color', 'colorGradient', 'textStroke', 'fontSize', 'fontFamily', 'fontWeight',
  'letterSpacing', 'lineHeight', 'shadow', 'blur', 'backdropFilter', 'layout', 'style']
let values = 0, bound = 0
const refs = new Map()
const components = {}
for (const s of doc.slides) {
  for (const h of [s, ...s.elements]) {
    const keys = h === s ? ['background'] : BINDABLE
    const tops = new Set(Object.keys(h.themeRefs ?? {}).map((p) => p.split('.')[0]))
    for (const k of keys) if (h[k] !== undefined) { values++; if (tops.has(k)) bound++ }
    for (const r of Object.values(h.themeRefs ?? {})) refs.set(r, (refs.get(r) ?? 0) + 1)
  }
  for (const e of s.elements) {
    if (!e.component) continue
    const c = (components[e.component.id] ??= { main: null, copies: new Set() })
    if (e.component.main) (c.main ??= { slide: s.id, name: e.groupName ?? e.name ?? '', ids: [] }).ids.push(e.id)
    else c.copies.add(`${s.id}/${e.groupId ?? e.id}`)
  }
}
const W = doc.size?.width ?? 1280
const boxes = doc.slides.flatMap((s) => s.elements).filter((e) => e.type === 'text' && e.w < W * 0.9)
const tk = doc.theme?.tokens
const modes = (Array.isArray(tk?.modes) ? tk.modes : []).filter((m) => typeof m === 'string')
if (!modes.length) modes.push('default')
const mode = modes.includes(tk?.mode) ? tk.mode : modes[0] // as the app picks it
const textOf = (e) => (e.html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
console.log(JSON.stringify({
  format: doc.format, title: doc.title, size: doc.size,
  collab: collab ? Object.keys(collab) : null,
  assets: assets ? Object.keys(assets).length : 0,
  theme: { ...doc.theme, tokens: undefined },
  tokens: tk && { modes, mode, // name: [type, value in the active mode, else the first mode that has one]
    set: Object.fromEntries(Object.entries(tk.set ?? {}).map(([n, t]) => [n, [t.type, [mode, ...modes].map((m) => t.values?.[m]).find((v) => v !== undefined)]])) },
  textExtent: boxes.length ? [Math.min(...boxes.map((e) => e.x)), Math.max(...boxes.map((e) => e.x + e.w))] : null,
  bound: `${bound} of ${values} style values carry a themeRefs binding`,
  refs: Object.fromEntries([...refs].sort((a, b) => b[1] - a[1])),
  components: Object.fromEntries(Object.entries(components).map(([id, c]) => [id, { main: c.main, copies: c.copies.size }])),
  layouts: (doc.layouts ?? []).map((l) => ({ id: l.id, name: l.name, roles: l.elements.map((e) => e.role).filter(Boolean) })),
  fonts: doc.fonts ?? [],
  present: doc.present,
  slides: doc.slides.map((s, i) => ({
    n: i + 1, id: s.id, transition: s.transition,
    ...(s.stateOf ? { stateOf: s.stateOf } : {}), ...(s.hidden ? { hidden: true } : {}),
    elements: s.elements.length, text: s.elements.filter((e) => e.type === 'text').map(textOf).filter(Boolean).slice(0, 3),
  })),
}))
```

`tokens.set` gives each token's type and its value in the active mode: the
literal to write beside a `$name` ref. `bound` counts style values (paint,
type, stroke, shadow) carrying a binding; a deck that binds many expects
yours bound too. `refs` lists the slots and tokens it uses, most used first.
`textExtent` is the leftmost and rightmost edge of its text boxes, its
margins in practice. A component's `main.ids` are the elements to duplicate
for a copy. To work on the document
yourself, parse the block the same way and keep `collab` and `assets` out of
anything you print.

## Writing the block back: `splice.mjs`

Write the full document to a JSON file (without `collab`; with or without
`assets`) and run `node splice.mjs deck.bento.html doc.json`.

```js
// node splice.mjs deck.bento.html doc.json
// Writes the FULL document in doc.json into the deck's block. The deck's own
// collab and docId are kept whatever doc.json says; its assets are put back
// when doc.json has no "assets" key. Escapes every "<", keeps the assets map
// on the last line, and leaves the rest of the file byte for byte.
import { readFileSync, writeFileSync } from 'node:fs'
const [file, json] = process.argv.slice(2)
const html = readFileSync(file, 'utf8')
const block = /(<script[^>]*\bid="bento-doc"[^>]*>)([\s\S]*?)<\/script>/.exec(html)
if (!block) throw new Error('no #bento-doc block: not a bento file')
const old = block[2].trim() ? JSON.parse(block[2]) : {}
if (old.format === 'bento/enc') throw new Error('password-protected deck: it cannot be edited as JSON')
const doc = JSON.parse(readFileSync(json, 'utf8'))
if (doc.compact || doc.format !== 'bento/slides' || !doc.slides?.length) {
  throw new Error('not a full bento/slides document (a compact one goes in through the app: loadDoc or Replace from JSON)')
}
delete doc.collab
if (old.collab) doc.collab = old.collab
if (old.docId) doc.docId = old.docId
if (!('assets' in doc) && old.assets) doc.assets = old.assets
const { assets, ...rest } = doc
let text = JSON.stringify(rest)
if (assets !== undefined) text = `${text.slice(0, -1)},\n"assets":${JSON.stringify(assets)}}`
text = text.replace(/</g, '\\u003c')
const start = block.index + block[1].length
writeFileSync(file, `${html.slice(0, start)}\n${text}\n${html.slice(start + block[2].length)}`)
```

It refuses a compact document, a password-protected deck and anything that
is not a bento/slides document, and splices by position, so a `$` in the text
(a formula, a price) is safe.

## Ids and changes

- Keep every existing `id`: comments, links, morph pairs and component copies
  refer to them. A new element needs an `id` unique on its slide, a new slide
  one unique in the deck; a readable scheme (`s4-chart`) keeps re-runs stable.
- Change what the user asked for and leave the rest, including keys you do
  not recognise and the order of what you did not move.
- A new slide is best copied from a neighbour made from the same layout, so it
  shares that slide's geometry, bindings and furniture ids.
- Removing a frame from the JSON leaves its children where they are; remove
  or move them too. Delete a component main in the editor (it promotes the
  first copy to be the new main), not in the JSON.

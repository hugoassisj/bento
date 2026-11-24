# Editing a deck on disk

Read this when you edit a `.bento.html` file directly: reading the block
safely, writing it back, ids, a shared deck, and getting the empty app. The
file contract in `SKILL.md` section 1 is the rule; this is how to follow it.

## Getting the empty app

When the user has no deck and agrees to a download, the published app is the
file to write into (this is the only step that needs the network):

```bash
curl -fsSL https://bento.page/releases/slides/Bento_Slides.bento.html -o "Q4_Review.bento.html"
```

(Windows without curl:
`iwr https://bento.page/releases/slides/Bento_Slides.bento.html -OutFile Q4_Review.bento.html`.)
Name the file after the deck's topic, and check that it contains
`id="bento-doc"`. Its block is empty: opened in a browser it shows a starter
deck to a new user, but on disk there is nothing to discard or copy from, so
write a whole new document into it.

## Reading the block: `inspect.mjs`

Save this as `inspect.mjs` and run `node inspect.mjs deck.bento.html`. It
prints the outline and the design system as JSON (the `collab` field names,
never their values; the number of assets, never their data), which is
everything step 1 of the workflow needs.

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
    if (e.component.main) c.main ??= { slide: s.id, name: e.groupName ?? e.name ?? '' }
    else c.copies.add(`${s.id}/${e.groupId ?? e.id}`)
  }
}
const textOf = (e) => (e.html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
console.log(JSON.stringify({
  format: doc.format, title: doc.title, size: doc.size,
  collab: collab ? Object.keys(collab) : null,
  assets: assets ? Object.keys(assets).length : 0,
  theme: { ...doc.theme, tokens: undefined },
  tokens: doc.theme?.tokens && {
    modes: doc.theme.tokens.modes ?? ['default'], mode: doc.theme.tokens.mode,
    set: Object.fromEntries(Object.entries(doc.theme.tokens.set ?? {}).map(([n, t]) => [n, t.type])),
  },
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
}, null, 1))
```

`bound` counts the style values (paint, type, stroke, shadow and similar)
that carry a `themeRefs` binding; a deck that binds many of its values expects
yours to be bound too. `refs` shows which slots and tokens the deck actually
uses, most used first.

To work on the document, parse the block the same way and keep `collab` and
`assets` out of anything you print. `jq 'del(.collab, .assets)'` on the
extracted JSON does the same in a shell.

## Writing the block back: `splice.mjs`

Write the full document you want to a JSON file (without `collab`; with or
without `assets`) and run `node splice.mjs deck.bento.html doc.json`.

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

It refuses a compact document, a password-protected deck and anything that is
not a bento/slides document. A `$` in the text (a formula, a price) is safe:
the script splices by position, not with a string replacement that would read
`$&` as a pattern.

## Ids

- Keep every existing `id`: comments, links, morph pairing and component
  copies refer to them.
- A new element needs an `id` unique on its slide. A readable, deterministic
  scheme (`s4-chart`, `s4-note-1`) makes a re-run produce the same ids. Reuse
  an id on the next slide on purpose, to morph.
- A new slide needs an `id` unique in the deck; a `link` or `stateOf` names it.
- In the compact form an element may leave `id` out; it becomes
  `<slideId>-<type>-<index>`.

## Changing an existing deck

- Change what the user asked for and leave the rest as it is, including keys
  you do not recognise and the order of slides and elements you did not move.
- Adding slides: copy the structure of a neighbouring slide made from the same
  layout (the deck's `layouts`, or the slide your new one follows), so the new
  slide shares its geometry, its bindings and its furniture's ids.
- Removing an element that is a frame removes its layout, not its children:
  they keep their boxes. Remove the children too, or move them.
- A component main deleted from the deck leaves its copies without a main; the
  app promotes the first copy to be the new main when you delete it in the
  editor, so delete a main there, or not at all.

## A deck that is shared live

`collab` in the block holds the deck's live-session credentials; the app mints
them when a deck is created, so treat every deck that has them as one that can
join a room. `splice.mjs` keeps `collab` untouched. Before you open such a deck in a browser you
drive, set `localStorage['bento-offline'] = 'on'` before the page loads (for
example in an init script), or the app joins the room and every edit you make
reaches everyone in it. Tell the user the deck carries live-session keys.

## Through the app instead

With a browser you drive, the app does the splicing, the escaping and the
derived values (frames, components, bindings) for you:

1. Open the deck (offline switch on if it has `collab`).
2. `window.bento.read()` returns the document without its keys
   (`window.bento.read({ compact: true })` in the compact form).
3. `window.bento.loadDoc(json)` loads your full or compact document, keeps the
   open deck's `docId` and session, and returns the load report (`dropped`,
   `findings`, `expanded`, `fitted`, `laidOut`); `false` means the JSON was not
   a document and nothing changed.
4. `window.bento.measure({ html, w, fontSize, lineHeight })` returns
   `{ height, width, lines }` for text you have not placed yet.
5. `window.bento.serialize()` returns the whole file; write it to the deck's
   path. It carries the `collab` keys, so write it straight to disk and do not
   print it.

#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// outline() and patch(): read a deck cheaply, change it surgically.
//
// BUNDLED, not run directly — the gate and the renderer import extensionless:
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-ops.ts --bundle \
//     --platform=node --format=esm --outfile="$TMPDIR/test-slides-ops.mjs" \
//     && node "$TMPDIR/test-slides-ops.mjs"
//
// WHAT THIS PROVES, on the shipped starter deck and a fixture carrying
// sharing keys, an embedded document, a picture and a table:
//   - the outline is under 15 KB for the starter, carries every element's
//     words, no sharing key, no asset bytes, and the deck's design system;
//     the slide view elides long values, and a patch writing one back is
//     refused;
//   - a one-element edit changes that element only (every other element's
//     JSON identical, untouched slides the same objects);
//   - all or nothing: one refused op and nothing changes, every op gets a
//     reply index-aligned with the ops, each refusal says why; `partial`
//     applies the rest; a dry run reports the same and changes nothing;
//   - an unknown verb, an address that does not resolve and a field the gate
//     drops are each refused by name; no input throws;
//   - docId, collab and readonly never change, whatever the ops say;
//   - hostile markup (img onerror, a javascript: link, svg <script>, an
//     elided placeholder) does not reach the next document;
//   - ordering: slide numbers mean the deck as read; an array runs in order
//     and later ops name what earlier ones created (caller ids);
//   - the design system: a token or slot name writes the literal and the
//     binding; a bound value is never silently replaced by a literal;
//     detach; a component copy carries its main's sig; a frame child joins
//     its frame;
//   - the stale-edit guard (base hash) and stats().
// Ported cases from upstream PR #532's scripts/test-slides-assistant.ts
// (its ops section and condition C payloads), on the live-document patch.

import { starterDoc } from '../slides/src/starterdeck.ts'
import { outlineDoc, docStats, deckHash, words, OUTLINE_TEXT_MAX } from '../slides/src/outline.ts'
import { patchDoc, normalizeOps, type PatchReport, type PatchError } from '../slides/src/ops.ts'
import { validateDoc } from '../slides/src/validate.ts'
import { sanitizeHtml, sanitizeSvgCss, sanitizeSvgMarkup } from '../slides/src/render.ts'
import { mainSig, components } from '../slides/src/components.ts'
import type { BentoDoc } from '../slides/src/model.ts'

let checks = 0
let failures = 0
function ok(cond: unknown, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
type Obj = Record<string, any>
const env = { san: { html: sanitizeHtml, svg: sanitizeSvgMarkup, svgCss: sanitizeSvgCss }, validate: (d: BentoDoc) => validateDoc(d, { measure: false }) }
const run = (doc: BentoDoc, ops: unknown, opts: Obj = {}) => patchDoc(doc, ops, opts, env)
const rep = (r: { report: PatchReport | PatchError }) => r.report as PatchReport
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')

// --- fixture: sharing keys, an embedded document, a picture, a table, a chart
const SECRET = 'room-key-SECRET-0123456789abcdef'
const PRIV = 'writer-priv-SECRET-fedcba'
const EMB = 'embedded-room-SECRET-777'
const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(400)
function fixture(): BentoDoc {
  const d = starterDoc()
  d.docId = 'docid-fixture-1'
  d.collab = { room: 'wss://example.invalid/r/x', key: SECRET, writerPriv: PRIV, writerPub: 'pub' } as BentoDoc['collab']
  d.assets = { ...(d.assets ?? {}), photo: PNG }
  const s = d.slides[1]
  s.elements.push(
    { id: 'pic', type: 'image', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, src: PNG, fit: 'cover', radius: 0, alt: 'A harbour at dusk' } as any,
    { id: 'emb', type: 'embed', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, app: 'bento/dash', view: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', doc: { format: 'bento/dash', docId: 'inner', collab: { key: EMB } } } as any,
  )
  return d
}

console.log('\noutline: the deck view')
{
  const d = starterDoc()
  const o = outlineDoc(d)
  ok(bytes(o) < 15000, `the starter's outline is under 15 KB (${bytes(o)} B, the document ${bytes(JSON.stringify(d))} B)`)
  const missing: string[] = []
  d.slides.forEach((s, i) => s.elements.forEach((e: Obj) => {
    const w = e.type === 'text' ? words(e.html) : e.type === 'code' ? String(e.content ?? '') : ''
    if (!w || /^(\{\{[^}]*\}\}\s*)+$/.test(w)) return
    const head = JSON.stringify(w.slice(0, OUTLINE_TEXT_MAX)).slice(0, -1)
    if (!o.includes(`${i + 1}/${e.id}`) || !o.includes(head)) missing.push(`${i + 1}/${e.id}`)
  }))
  ok(missing.length === 0, `every element's words are in it, addressed <slide>/<id> (missing: ${missing.slice(0, 5).join(', ') || 'none'})`)
  const cells = (d.slides.flatMap((s) => s.elements).find((e) => e.type === 'table') as Obj | undefined)?.rows?.flatMap((r: Obj) => r.cells.map((c: Obj) => words(c.html))) ?? []
  ok(cells.length > 0 && cells.every((c: string) => o.includes(JSON.stringify(c))), `every table cell is in it (${cells.length})`)
  ok(/hash [0-9a-z]{14}/.test(o) && o.includes(deckHash(d)), 'the header carries the content hash patch() takes as base')
  ok(/palette: bg1 #/.test(o) && /tokens \(18\)/.test(o) && /components: "Key hint"/.test(o) && /layouts: .*built-in title/.test(o), 'the header names the palette, the 18 tokens, the components and the layouts')
  ok(/state of sd-s-charts/.test(o) && /\(→ sd-s-charts-pie\)/.test(o), 'states and links are marked')
  ok(/frame \(row/.test(o) && /copy of "Button"/.test(o) && /main of "Key hint"/.test(o), 'frames, component mains and copies are marked')
  ok(/\{color=accent3\}/.test(o) && /usual bindings \(not repeated below\):/.test(o), 'bindings: the usual ones once in the header, the rest on their lines')
  ok(/\+\d+ more: svg/.test(o), 'decoration is counted, not listed')
  const f = outlineDoc(d, { find: 'scatter' })
  ok(f.length < o.length / 3 && f.includes('## 10 ') && !f.includes('## 2 '), `{ find } narrows to the slides and lines that match (${f.length} chars)`)
  ok(outlineDoc(d, { find: 'zzzz-nothing' }).includes('nothing matches'), '{ find } says so when nothing matches')
}

console.log('\noutline: secrets, assets, the slide view')
{
  const d = fixture()
  const views = [outlineDoc(d), outlineDoc(d, { slide: 2 }), outlineDoc(d, { slide: d.slides[1].id }), ...d.slides.map((_, i) => outlineDoc(d, { slide: i + 1 }))]
  const all = views.join('\n')
  ok(![SECRET, PRIV, EMB, 'wss://example.invalid'].some((k) => all.includes(k)), 'no view carries a sharing key, the room, or the embedded document\'s key')
  ok(!all.includes('iVBORw0KGgoiVBOR') && !all.includes('base64,'), 'no view carries asset bytes')
  ok(/2\/pic image "A harbour at dusk"/.test(views[0]), 'a picture is listed by its alt text')
  ok(/"src":"@@elided image\/png [0-9]+ KB@@"/.test(views[1]) && /"doc":"@@elided document/.test(views[1]), 'the slide view elides the picture and the embedded document by size')
  ok(views[1] === views[2], 'a slide is named by number or by id alike')
  ok(views[1].split('\n').filter((l) => l.startsWith('2/')).length === d.slides[1].elements.length, 'the slide view lists every element, one line each')
  ok(outlineDoc(d, { slide: 99 }).startsWith('# no slide 99'), 'a slide that is not there is said, not thrown')
  const r = run(d, [{ op: 'set', id: '2/pic', src: '@@elided image/png 4 KB@@' }])
  ok(!rep(r).committed && /placeholder/.test(rep(r).skipped[0]?.reason ?? ''), 'a patch that writes an elided placeholder back is refused')
}

console.log('\npatch: one edit changes one element')
{
  const d = starterDoc()
  const before = JSON.stringify(d)
  const r = run(d, { edits: [{ id: '1/sd-title', text: 'X' }] })
  const R = rep(r)
  ok(R.ok && R.committed && R.replies.length === 1 && R.replies[0].ok && R.replies[0].op === 'edit 1/sd-title', `applied: ${JSON.stringify(R.replies)}`)
  ok(JSON.stringify(d) === before, 'the input document is not mutated')
  const n = r.next!
  let other = 0, same = 0
  d.slides.forEach((s, si) => s.elements.forEach((e, ei) => {
    if (si === 0 && e.id === 'sd-title') return
    other++
    if (JSON.stringify(n.slides[si].elements[ei]) === JSON.stringify(e)) same++
  }))
  ok(same === other, `every other element's JSON is unchanged (${same}/${other})`)
  ok(n.slides.slice(1).every((s, k) => s === d.slides[k + 1]), 'the other slides are the very same objects')
  ok((n.slides[0].elements.find((e) => e.id === 'sd-title') as Obj).html === 'X', 'the title reads X')
  ok(R.hash === deckHash(n) && R.hash !== deckHash(d), 'the report carries the new hash')
  const again = run(n, { edits: [{ id: '1/sd-title', text: 'X' }] })
  ok(rep(again).replies[0].unchanged && !rep(again).committed, 'the same edit again is a no-op (unchanged), not a second change')
}

console.log('\npatch: all or nothing, replies, dry run')
{
  const d = starterDoc()
  const ops = [
    { op: 'edits', id: '1/sd-title', text: 'New title' },
    { op: 'frobnicate', x: 1 },
    { op: 'set', id: '3/nope', fill: '#fff' },
    { op: 'set', id: '1/sd-title', bogusKey: 1, onclick: 'alert(1)' },
    { op: 'notes', slide: 2, text: 'hello' },
  ]
  const r = run(d, ops)
  const R = rep(r)
  ok(R.ok && !R.committed && r.next === null, 'one refused op: nothing is committed')
  ok(R.replies.length === ops.length && R.replies[0].ok && R.replies[4].ok, 'every op gets a reply, index-aligned')
  ok(/unknown op "frobnicate"/.test(R.replies[1].reason ?? ''), `an unknown verb is refused by name: ${R.replies[1].reason}`)
  ok(/no element "nope" on slide 3 \(with words there: /.test(R.replies[2].reason ?? ''), `an address that does not resolve says what is there: ${R.replies[2].reason?.slice(0, 90)}`)
  ok(/bogusKey: unknown key for a text element/.test(R.replies[3].reason ?? '') && /onclick/.test(R.replies[3].reason ?? ''), 'fields the gate drops are refused, with the path and the reason')
  ok(R.skipped.map((s) => s.i).join() === '1,2,3' && /nothing was changed/.test(R.hint ?? ''), 'skipped lists the refused ops by index; the hint says what to do')
  const p = rep(run(d, ops, { partial: true }))
  ok(p.committed && p.replies[0].ok && p.replies[4].ok && p.skipped.length === 3, '{ partial: true } applies what passes and still lists the rest')
  const good = [{ op: 'edits', id: '1/sd-title', text: 'Y' }, { op: 'add', after: 19, layout: 'title', title: 'The end' }]
  const real = rep(run(d, good)), dry = run(d, good, { dryRun: true })
  const strip = (x: PatchReport) => JSON.stringify({ replies: x.replies, skipped: x.skipped, findings: x.findings })
  ok(rep(dry).dryRun && !rep(dry).committed && dry.next === null && strip(rep(dry)) === strip(real), 'a dry run reports the same replies, refusals and findings, and changes nothing')
  const junk: unknown[] = [null, 5, 'not json', '[1,2]', [], {}, { edits: 'x' }, { edits: [null, 5, 'x', { id: 7 }] }, { set: [{ id: '1/sd-title', __proto__: { x: 1 } }] }, { add: [{ after: -4 }, { after: 'zz' }, { after: 2, from: 999 }] }, { move: [{ slide: 1, to: 1 }, { slide: 'a', to: 'b' }] }, { remove: [1, 1, 99] }, [{ op: 'insert', slide: 1 }], [{ insert: { slide: 1, type: 'nope' } }], [{ op: 'chart', id: '8/sd-main-chart', series: 'x' }], [{ op: 'cells', id: '11/sd-table', row: 99, col: 1, text: 'x' }]]
  let threw = 0
  for (const j of junk) { try { const x = run(d, j); if (!x.report) threw++ } catch { threw++ } }
  ok(threw === 0, `no input throws (${junk.length} malformed patches, each answered)`)
  ok(!run(d, 5).report.ok && (run(d, 5).report as PatchError).err === 'bad-patch', 'a patch that is not an object or a list is a bad-patch error')
}

console.log('\npatch: identity and capability never change')
{
  const d = fixture()
  d.readonly = false
  const r = run(d, [
    { op: 'set', id: '1/sd-title', docId: 'evil', collab: { key: 'evil' }, readonly: true, comments: [], component: { id: 'x', key: 'k' }, themeRefs: { color: 'accent1' } },
    { op: 'slide', slide: 1, docId: 'evil', collab: 'evil' },
    { op: 'insert', slide: 1, type: 'text', md: 'x', docId: 'evil', collab: {} },
    { op: 'add', after: 1, title: 'x', docId: 'evil', collab: {}, readonly: true },
  ], { partial: true })
  const n = r.next ?? d
  ok(n.docId === 'docid-fixture-1' && (n.collab as Obj).key === SECRET && n.readonly === false, 'docId, collab and readonly are the document\'s own')
  ok(rep(r).skipped.length >= 3 && rep(r).skipped.every((s) => /cannot be|not a slide field/.test(s.reason)), 'each attempt is refused by name')
  ok(!JSON.stringify(n.slides).includes('evil'), 'nothing of the attempt reached the slides')
}

console.log('\npatch: hostile content (condition C of PR #532)')
{
  const d = starterDoc()
  const IMG = '<p>hi <img src=x onerror="window.__pwn=1"> <b onclick="window.__pwn=2">bold</b> <a href="javascript:window.__pwn=3">l</a></p>'
  const r = run(d, [
    { op: 'edits', id: '1/sd-title', text: IMG },
    { op: 'set', id: '2/sd-title', html: IMG },
    { op: 'cells', id: '11/sd-table', row: 1, col: 1, text: '<img src=x onerror=alert(1)>' },
    { op: 'insert', slide: 1, type: 'svg', id: 'art', x: 0, y: 100, w: 100, h: 100, markup: '<svg viewBox="0 0 10 10"><script>window.__pwn=4</script><rect width="5" height="5" onclick="window.__pwn=5"/></svg>', css: '@import url(https://evil.example/x.css); .r{fill:blue}' },
    { op: 'insert', slide: 1, type: 'shape', id: 'hit', shape: 'rect', x: 0, y: 0, w: 1, h: 1, link: 'javascript:window.__pwn=6' },
  ], { partial: true })
  const n = r.next!
  const out = JSON.stringify(n.slides)
  ok(!!n && rep(r).committed, 'the patch applied, cleaned')
  ok(!/<img|<script|<[a-z][^>]*\son\w+=|<a [^>]*href=\\"javascript:/i.test(out), 'no <img>, <script>, on* handler or javascript: href (as markup) in the next document')
  const hit = n.slides[0].elements.find((e) => e.id === 'hit') as Obj
  ok(hit && !('link' in hit), 'the javascript: link did not reach the document (the shape did, without it)')
  ok((rep(r).notes ?? []).some((x) => /1\/hit link/.test(x)), 'the report says the link was removed')
  ok(!/@import|evil\.example/.test(out), 'the svg css @import did not reach the document')
  const t1 = n.slides[0].elements.find((e) => e.id === 'sd-title') as Obj
  ok(/&lt;img/.test(t1.html) && /<b>|bold/.test(t1.html), 'an edit\'s markup is text: escaped, never parsed')
}

console.log('\npatch: order, numbering, caller ids')
{
  const d = starterDoc()
  const ids = d.slides.map((s) => s.id)
  // the PR's example: "add after 3, remove 5, move 7 to 2" means the deck as read
  const r = run(d, { add: [{ after: 3, layout: 'title', title: 'New' }], remove: [5], move: [{ slide: 7, to: 2 }] })
  const got = r.next!.slides.map((s) => s.id)
  const want = [ids[0], ids[6], ids[1], ids[2], 'slide-1', ids[3], ...ids.slice(5, 6), ...ids.slice(7)]
  ok(JSON.stringify(got) === JSON.stringify(want), 'object form: numbers mean the deck as read (add after 3, remove 5, move 7 to 2)')
  const a = run(d, [
    { op: 'add', after: 2, from: 2, id: 'copy-2', title: 'A copy' },
    { op: 'edits', id: 'copy-2/sd-title', text: 'Edited in the same patch' },
    { op: 'insert', slide: 'copy-2', type: 'text', id: 'note-box', md: 'Added', x: 96, y: 600, w: 400 },
    { op: 'set', id: 'copy-2/note-box', fontSize: 30 },
  ])
  const A = rep(a)
  const copy = a.next!.slides[2]
  ok(A.committed && copy.id === 'copy-2' && A.replies[0].ids?.[0] === 'copy-2', 'add takes the caller\'s slide id and returns it')
  ok((copy.elements.find((e) => e.id === 'sd-title') as Obj).html === 'Edited in the same patch' && (copy.elements.find((e) => e.id === 'note-box') as Obj).fontSize === 30, 'later ops name what earlier ops created')
  ok(copy.elements.filter((e) => e.id !== 'note-box').every((e) => d.slides[1].elements.some((x) => x.id === e.id)), 'a duplicate keeps its element ids, so it morphs with its source')
  const dup = rep(run(a.next!, [{ op: 'add', after: 2, id: 'copy-2', title: 'again' }]))
  ok(!dup.committed && /taken/.test(dup.skipped[0]?.reason ?? ''), 'replaying an add with the same id is refused by name, not done twice')
  const gone = rep(run(d, [{ op: 'remove', slide: 5 }, { op: 'notes', slide: 5, text: 'x' }]))
  ok(/removed earlier in this patch/.test(gone.skipped[0]?.reason ?? ''), 'naming a slide an earlier op removed is refused clearly')
  const states = run(d, { remove: [8] })
  ok(rep(states).replies[0].op === 'remove 8 (+2 states)' && !states.next!.slides.some((s) => s.stateOf === 'sd-s-charts'), 'removing a slide takes its states with it')
  ok(normalizeOps({ move: [], edits: [{}] }).map((o: Obj) => o.verb).join() === 'edits', 'object form: content verbs run before structure')
}

console.log('\npatch: the design system')
{
  const d = starterDoc()
  const r = run(d, [
    { op: 'insert', slide: 2, type: 'shape', id: 'card', shape: 'rect', x: 96, y: 500, w: 300, h: 120, fill: 'accent2', radius: '$radius.md' },
    { op: 'insert', slide: 2, type: 'text', id: 'lbl', md: 'Label', x: 96, y: 640, w: 300, color: 'tx1', fontFamily: '$font.body' },
  ])
  const n = r.next!
  const card = n.slides[1].elements.find((e) => e.id === 'card') as Obj
  const lbl = n.slides[1].elements.find((e) => e.id === 'lbl') as Obj
  ok(card.fill === d.theme.palette?.accent2 && card.themeRefs?.fill === 'accent2' && card.radius === 14 && card.themeRefs?.radius === '$radius.md', 'a slot or token name writes the literal and the binding')
  ok(lbl.color === d.theme.color && lbl.themeRefs?.color === 'tx1' && lbl.themeRefs?.fontFamily === '$font.body', 'text takes the deck\'s ink and font by name')
  const b = rep(run(d, [{ op: 'set', id: '2/sd-title', color: '#123456' }]))
  ok(!b.committed && /bound to tx1/.test(b.skipped[0]?.reason ?? '') && /detach/.test(b.skipped[0]?.reason ?? ''), 'a literal over a bound value is refused, naming the binding and the way out')
  const dt = run(d, [{ op: 'set', id: '2/sd-title', color: '#123456', detach: true }])
  const t = dt.next!.slides[1].elements.find((e) => e.id === 'sd-title') as Obj
  ok(t.color === '#123456' && !t.themeRefs?.color && t.themeRefs?.fontFamily, '"detach": true writes the literal and drops only that binding')
  const bad = rep(run(d, [{ op: 'set', id: '2/sd-title', color: '$radius.md' }, { op: 'set', id: '2/sd-title', fontSize: '$nope' }]))
  ok(/radius\.md is a number token/.test(bad.replies[0].reason ?? '') && /no token named \$nope/.test(bad.replies[1].reason ?? ''), 'a token of the wrong type, or no such token, is refused by name')
  const c = run(d, [{ op: 'insert', slide: 2, use: 'Key hint', x: 96, y: 600, texts: { 'sd-hint-key': 'S', 'sd-hint-label': 'SAVE' } }])
  const C = rep(c)
  const comp = components(d).find((x) => x.name === 'Key hint')!
  const copies = c.next!.slides[1].elements.filter((e) => e.component?.id === comp.id) as Obj[]
  ok(C.committed && copies.length === comp.main.length && copies.every((e) => e.component.sig === mainSig(comp.main as any)), `a component copy carries its main's sig (${copies.length} elements)`)
  ok(copies.some((e) => e.html === 'S') && copies.some((e) => e.html === 'SAVE') && C.replies[0].ids?.length === copies.length, 'texts fill the copy; the reply lists the new addresses')
  const f = run(d, [{ op: 'insert', slide: 3, type: 'text', id: 'stat-x', md: 'NEW', parentId: 'sd-stat-0' }])
  ok((f.next!.slides[2].elements.find((e) => e.id === 'stat-x') as Obj)?.parentId === 'sd-stat-0', 'an insert with parentId joins the frame')
  const nf = rep(run(d, [{ op: 'insert', slide: 3, type: 'text', md: 'x', parentId: 'sd-title' }]))
  ok(/not an unlocked auto-layout frame/.test(nf.skipped[0]?.reason ?? ''), 'a parentId that is not a frame is refused')
  const tk = Object.keys(d.theme.tokens!.set).length
  ok(Object.keys(r.next!.theme.tokens!.set).length === tk && JSON.stringify(r.next!.theme) === JSON.stringify(d.theme), 'the theme and its tokens are untouched by any op')
}

console.log('\npatch: stale edits, stats')
{
  const d = starterDoc()
  const h = deckHash(d)
  const s = run(d, { edits: [{ id: '1/sd-title', text: 'Z' }] }, { base: 'not-the-hash' })
  ok(!s.report.ok && (s.report as PatchError).err === 'stale' && /read outline\(\) again/.test((s.report as PatchError).detail), 'a base that is not the deck\'s hash is refused as stale, saying what to do')
  const g = run(d, { edits: [{ id: '1/sd-title', text: 'Z' }] }, { base: h })
  ok(rep(g).committed, 'the current hash as base applies')
  const st = docStats(fixture(), JSON.stringify(fixture()))
  ok(st.assets[0].key === 'photo' && st.assets[0].bytes === PNG.length && st.assets.every((a, k) => k === 0 || a.bytes <= st.assets[k - 1].bytes), 'stats() lists the largest assets first')
  ok(st.slides === 19 && st.shown === 15 && st.tokens === 18 && st.components === 3 && st.bound > 0 && st.literal > 0 && st.outlineBytes < st.bytes / 5, `stats(): ${st.slides} slides, ${st.shown} shown, ${st.bound} bound / ${st.literal} literal, outline ${st.outlineBytes} B of ${st.bytes} B`)
}

console.log('\nwhat it costs an agent (bytes / 4 ≈ tokens)')
{
  const d = starterDoc()
  const full = JSON.stringify(d)
  const o = outlineDoc(d)
  const big = starterDoc()
  while (big.slides.length < 40) big.slides.push(...JSON.parse(JSON.stringify(starterDoc().slides.slice(1, 12))).map((s: Obj, k: number) => ({ ...s, id: `${s.id}-x${big.slides.length + k}`, stateOf: undefined })))
  big.slides.length = 40
  const bo = outlineDoc(big)
  const patch = JSON.stringify([{ op: 'edits', id: '3/sd-title', text: 'Software you never have to install.' }, { op: 'notes', slide: 3, text: 'Say it slowly.' }])
  console.log(`  starter: document ${bytes(full)} B (~${Math.round(bytes(full) / 4)} tok), outline ${bytes(o)} B (~${Math.round(bytes(o) / 4)} tok)`)
  console.log(`  40 slides: document ${bytes(JSON.stringify(big))} B (~${Math.round(bytes(JSON.stringify(big)) / 4)} tok), outline ${bytes(bo)} B (~${Math.round(bytes(bo) / 4)} tok)`)
  console.log(`  a retitle + notes: patch ${bytes(patch)} B (~${Math.round(bytes(patch) / 4)} tok) vs rewriting the document ${bytes(full)} B`)
  ok(bytes(bo) < bytes(JSON.stringify(big)) / 8 && bytes(bo) <= 48000 + 400, 'a 40-slide outline stays bounded and under an eighth of the document')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)

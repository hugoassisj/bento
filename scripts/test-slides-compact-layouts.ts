#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Compact input, round three: placement by layout and role (compact.ts).
//
//   node scripts/test-slides-compact-layouts.ts
//
// WHAT THIS PROVES. A compact slide that names a layout and gives its
// elements roles expands to EXACTLY the layout's frames with the content
// applied (through model.ts applyLayout — the same matching the editor's
// "Apply layout" uses), slides born from the same layout share element ids
// (so their chrome morphs), an unknown role falls back to the body slot with
// a load-report note, explicit geometry always wins, more bodies than slots
// stack into the slot without overlapping (equal shares here; compactload.ts
// restacks by measured height — source-asserted), the four added built-in
// layouts carry the roles AGENTS.md says they do, and AGENTS.md's table of
// layouts and roles is generated from the code so it cannot drift.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { expandDocWithStats, layoutRoles, findLayout, LAYOUT_ALIASES, STACK_GAP } from '../slides/src/compact.ts'
import { builtinLayouts, applyLayout, type Slide, type SlideElement, type TextElement, type ImageElement } from '../slides/src/model.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
type Obj = Record<string, unknown>
const els = (s: Slide) => s.elements as unknown as Obj[]
const text = (s: Slide, id: string) => s.elements.find((e) => e.id === id) as TextElement | undefined
const frame = (e: SlideElement | undefined) => e ? `${e.x},${e.y},${e.w}x${e.h}` : 'none'

console.log('the built-in layouts and their roles\n')
const layouts = builtinLayouts()
const byId = Object.fromEntries(layouts.map((l) => [l.id, l]))
const expectRoles: Record<string, string[]> = {
  'layout-title': ['title', 'subtitle'],
  'layout-title-content': ['title', 'body'],
  'layout-two-col': ['title', 'body', 'left', 'right'],
  'layout-section': ['title', 'kicker'],
  'layout-three-cards': ['title', 'card1', 'card2', 'card3'],
  'layout-quote': ['quote', 'attribution'],
  'layout-image-left': ['image', 'title', 'body'],
  'layout-image-right': ['title', 'body', 'image'],
  'layout-blank': [],
}
ok(layouts.map((l) => l.id).sort().join() === Object.keys(expectRoles).sort().join(), `nine built-in layouts (${layouts.length})`)
for (const [id, roles] of Object.entries(expectRoles)) {
  ok(Object.keys(layoutRoles(byId[id])).sort().join() === [...roles].sort().join(), `${id}: roles ${roles.join(', ') || '(none)'}`)
}
ok(layoutRoles(byId['layout-two-col']).left === 'l2c-left' && layoutRoles(byId['layout-two-col']).right === 'l2c-right', 'left/right are the first and second body slot of the two-column layout')
const ids = layouts.flatMap((l) => l.elements.map((e) => e.id))
ok(new Set(ids).size === ids.length, 'every layout element id is unique across the built-ins (lineage cannot collide)')
const cards = byId['layout-three-cards']
ok(['l3c-bg1', 'l3c-card1'].every((id) => cards.elements.find((e) => e.id === id)?.groupId === 'l3c-g1'), 'a card and its backdrop share a groupId (they move as one)')
ok(['title-body', 'two-column', 'cards'].every((a) => findLayout(a, {})?.id === LAYOUT_ALIASES[a]) && findLayout('quote', {})?.id === 'layout-quote' && findLayout('layout-section', {})?.id === 'layout-section', 'a layout is found by alias, by short name and by id')
const scaled = findLayout('title-body', { size: { width: 1280, height: 720 } })!
ok(text(scaled, 'ltc-title')!.w === 1088, 'the layout is scaled to the deck size (1088 wide on a 1280 deck)')

console.log('\nexpansion by role\n')
const one = expandDocWithStats({ compact: true, slides: [
  { id: 'a', layout: 'title-body', elements: [{ role: 'title', md: 'Hi' }, { role: 'body', md: '- a\n- b' }] },
  { id: 'b', layout: 'title-body', elements: [{ role: 'title', md: 'Second' }, { role: 'body', md: 'Text' }] },
] })
const a = one.doc.slides[0], b = one.doc.slides[1]
const ref = findLayout('title-body', { size: { width: 1280, height: 720 } })!
ok(els(a).map((e) => e.id).join() === ref.elements.map((e) => e.id).join(), 'the slide has exactly the layout\'s elements, in order, with the layout\'s ids')
ok(frame(text(a, 'ltc-title')) === frame(text(ref, 'ltc-title')) && frame(text(a, 'ltc-body')) === frame(text(ref, 'ltc-body')), 'title and body sit exactly on the layout\'s frames')
ok(text(a, 'ltc-title')!.html === 'Hi' && /•\u00a0a<br>•\u00a0b|<li>a/.test(text(a, 'ltc-body')!.html), 'content applied: the title, and the markdown body as the editor converts it')
ok(text(a, 'ltc-title')!.fontSize === text(ref, 'ltc-title')!.fontSize && text(a, 'ltc-title')!.fontWeight === 700, 'typography is the layout\'s (44→scaled, weight 700), not the compact default')
ok(els(a).every((e) => !(e.placeholder && !(e.html as string))), 'no leftover placeholder prompt: every text slot was filled')
ok(text(b, 'ltc-title')!.id === text(a, 'ltc-title')!.id, 'two slides from the same layout share element ids — their titles morph')
ok(!('layout' in (a as unknown as Obj)), 'the compact `layout` key never reaches the document')
ok(one.stats.laidOut === 2 && one.stats.notes.length === 0, 'stats: two slides laid out, no notes')

console.log('\nfallbacks, explicit geometry, images\n')
const two = expandDocWithStats({ compact: true, slides: [
  { id: 'c', layout: 'title-body', elements: [
    { role: 'title', md: 'T' }, { role: 'quote', md: 'Q' },
    { type: 'shape', shape: 'rect', x: 10, y: 20, w: 30, h: 40, role: 'title' },
    { type: 'text', role: 'title', x: 700, y: 600, w: 200, h: 50, html: 'Explicit' },
  ] },
  { id: 'd', layout: 'section', elements: [{ role: 'body', md: 'No body slot here' }] },
  { id: 'e', layout: 'no-such-layout', elements: [{ type: 'text', x: 1, y: 2, w: 3, h: 4, html: 'x' }] },
  { id: 'f', layout: 'image-left', elements: [{ type: 'image', role: 'image', src: 'data:,', fit: 'cover' }, { role: 'title', md: 'Pic' }] },
  { id: 'g', layout: 'two-column', elements: [{ role: 'left', md: 'L' }, { role: 'right', md: 'R' }] },
] })
const c = two.doc.slides[0]
ok(text(c, 'ltc-body')!.html === 'Q', 'a role the layout has no slot for lands in the body slot')
ok(two.stats.notes.some((n) => n.path === '/slides/0/elements/1/role' && /^layout: no `quote` slot in layout `layout-title-content` \(its roles: title, body\); placed after the body slot's content/.test(n.reason)), 'and the load report says so, with the path, the layout\'s roles and the `layout: ` prefix')
const shape = els(c).find((e) => e.type === 'shape' && e.x === 10)
ok(!!shape && shape.w === 30 && shape.h === 40, 'explicit geometry wins: the shape sits where the author put it, role or not')
const explicit = els(c).find((e) => e.html === 'Explicit')
ok(!!explicit && explicit.x === 700 && explicit.y === 600, 'a text with a frame and a role is placed as given, not into the slot')
ok(text(c, 'ltc-title')!.html === 'T', '…and the slot took the frameless title')
const d = two.doc.slides[1]
ok(two.stats.notes.some((n) => n.path === '/slides/1/elements/0/role' && /no body slot; placed at the default frame/.test(n.reason)) && els(d).some((e) => e.html === 'No body slot here'), 'no body slot at all: placed at the default frame, reported')
const e = two.doc.slides[2]
ok(two.stats.notes.some((n) => n.path === '/slides/2/layout' && /unknown layout/.test(n.reason)) && els(e).length === 1 && els(e)[0].x === 1, 'an unknown layout: elements placed as given, reported')
const f = two.doc.slides[3]
const pic = f.elements.find((x) => x.id === 'lil-image') as ImageElement | undefined
ok(!!pic && pic.type === 'image' && pic.src === 'data:,' && pic.fit === 'cover' && frame(pic) === frame(text(findLayout('image-left', { size: { width: 1280, height: 720 } })!, 'lil-image')), 'an image donor REPLACES the image slot: picture, fit kept, slot frame and id')
ok(text(f, 'lil-title')!.html === 'Pic', 'the title beside it is filled')
const g = two.doc.slides[4]
ok(text(g, 'l2c-left')!.html === 'L' && text(g, 'l2c-right')!.html === 'R', 'left/right fill the two-column layout\'s columns')

console.log('\nstacking bodies\n')
const three = expandDocWithStats({ compact: true, slides: [
  { id: 'h', layout: 'title-body', elements: [{ role: 'title', md: 'T' }, { role: 'body', md: 'p1' }, { role: 'body', md: 'p2' }, { role: 'body', md: 'p3' }] },
] })
const h = three.doc.slides[0]
const slot = text(findLayout('title-body', { size: { width: 1280, height: 720 } })!, 'ltc-body')!
const bodies = ['ltc-body', 'ltc-body-2', 'ltc-body-3'].map((id) => text(h, id)!)
ok(bodies.every(Boolean) && bodies.map((x) => x.html).join() === 'p1,p2,p3', 'three bodies → the slot and two more, ids derived from the slot')
const share = Math.floor((slot.h - STACK_GAP * 2) / 3)
ok(bodies.every((x) => x.h === share) && bodies.every((x, i) => x.y === slot.y + i * (share + STACK_GAP)), `equal shares of the slot (${share} px) with a ${STACK_GAP} px gap`)
ok(bodies.every((x, i) => i === 0 || x.y >= bodies[i - 1].y + bodies[i - 1].h), 'no overlap')
ok(bodies[2].y + bodies[2].h <= slot.y + slot.h, 'the stack stays inside the slot')
ok(bodies.every((x) => x.x === slot.x && x.w === slot.w && x.fontSize === slot.fontSize), 'each keeps the slot\'s x, width and typography')
ok(three.stats.stacks.length === 1 && three.stats.stacks[0].ids.join() === 'ltc-body,ltc-body-2,ltc-body-3' && three.stats.autoHeight.length === 3, 'stats name the stack and mark each for measuring')
const load = read('slides/src/compactload.ts')
ok(/export function restack\(/.test(load) && /fitAutoHeights\(doc, stats\)\n\s*restack\(doc, stats\)/.test(load), 'compactload restacks by measured height after fitting (browser side)')
ok(/y \+= el\.h \+ STACK_GAP/.test(load), 'restack lays them top-to-bottom with the same gap')
ok(/restack\(store\.doc, \{ stacks: parsed\.report\.stacks \}\)/.test(read('slides/src/main.ts')), 'the fonts-ready re-fit restacks too')

console.log('\nno content is ever lost (AI-09)\n')
{
  type X = { id: string; type: string; html?: string; src?: string; x: number }
  // an authored text box may leave `type` out; what it carries is its html
  const content = (el: Obj) => (el.type === 'image' ? `img:${el.src}` : (el.type ?? 'text') === 'text' && el.html ? `txt:${el.html}` : '')
  const authored = (role: string) => role === 'image' ? { type: 'image', role, src: `data:image/png;base64,${role}` } : { role, html: role.toUpperCase() }
  // the reproduction from the issue: an unknown role before the named columns
  const rep = expandDocWithStats({ compact: true, slides: [{ layout: 'two-col', elements: [
    { role: 'title', html: 'TITLE' }, { role: 'kicker', html: 'KICKER' }, { role: 'left', html: 'LEFT' }, { role: 'right', html: 'RIGHT' }] }] })
  const rs = rep.doc.slides[0].elements as unknown as X[]
  const where = (html: string) => rs.filter((e) => e.html === html)
  ok(['TITLE', 'KICKER', 'LEFT', 'RIGHT'].every((h) => where(h).length === 1), `title, kicker, left and right are each present exactly once (${rs.filter((e) => e.html).map((e) => `${e.id}=${e.html}`).join(' ')})`)
  ok(where('LEFT')[0]?.id === 'l2c-left' && where('RIGHT')[0]?.id === 'l2c-right' && where('KICKER')[0]?.id === 'l2c-left-2', 'LEFT fills the left column, RIGHT the right one, and the unknown kicker stacks AFTER the left column\'s own text')
  ok(where('RIGHT')[0]?.x > where('LEFT')[0]?.x, 'RIGHT is drawn to the right of LEFT')
  ok(rep.stats.notes.length === 1 && /^layout: no `kicker` slot in layout `layout-two-col` \(its roles: title, body, left, right\)/.test(rep.stats.notes[0].reason), `the note names the layout's valid roles (${rep.stats.notes[0]?.reason})`)
  const swap = expandDocWithStats({ compact: true, slides: [{ layout: 'two-col', elements: [{ role: 'right', html: 'RIGHT' }, { role: 'left', html: 'LEFT' }] }] }).doc.slides[0].elements as unknown as X[]
  ok(swap.find((e) => e.html === 'RIGHT')?.id === 'l2c-right' && swap.find((e) => e.html === 'LEFT')?.id === 'l2c-left', '`right` written before `left` still lands RIGHT in the right column')
  // what cannot sit in its slot keeps its own frame, with a note — never dropped
  const odd = expandDocWithStats({ compact: true, slides: [{ layout: 'image-left', elements: [
    { type: 'image', role: 'title', src: 'data:,a' }, { type: 'image', role: 'image', src: 'data:,b' }, { type: 'image', role: 'image', src: 'data:,c' }, { role: 'title', html: 'T' }] }] })
  const os = odd.doc.slides[0].elements as unknown as X[]
  ok(['data:,a', 'data:,b', 'data:,c'].every((src) => os.filter((e) => e.src === src).length === 1) && os.find((e) => e.src === 'data:,b')?.id === 'lil-image' && os.find((e) => e.html === 'T')?.id === 'lil-title', 'an image with a text role and a second image for the image slot are kept at their own frames; the slots take the rest')
  ok(odd.stats.notes.length === 2 && odd.stats.notes.every((n) => n.reason.startsWith('layout: ')), `both are reported with the layout prefix (${odd.stats.notes.map((n) => n.reason).join(' | ')})`)

  // the property: every built-in layout, every ordering of its roles plus one unknown role
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const perms = (xs: string[]): string[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))
  const sample = (xs: string[], n: number) => Array.from({ length: n }, () => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a })
  for (const l of builtinLayouts()) {
    if (l.id === 'layout-blank') continue
    const map = layoutRoles(l)
    const roles = Object.keys(map)
    const orders = roles.length <= 5 ? perms(roles) : sample(roles, 120)
    let cases = 0, lost = 0, misplaced = 0
    const bad: string[] = []
    for (const order of orders) for (let at = 0; at <= order.length; at++) {
      const withUnknown = [...order.slice(0, at), 'aside', ...order.slice(at)]
      const r = expandDocWithStats({ compact: true, slides: [{ layout: l.id, elements: withUnknown.map(authored) }] })
      const out = r.doc.slides[0].elements as unknown as Obj[]
      const want = withUnknown.map((role) => content(authored(role) as Obj)).sort()
      const got = out.map(content).filter(Boolean).sort()
      cases++
      if (want.join('|') !== got.join('|')) { lost++; if (bad.length < 2) bad.push(`${withUnknown.join(',')} → ${got.join(',')}`) }
      for (const role of order) {
        const el = out.find((e) => content(e) === content(authored(role) as Obj))
        const slot = map[role]
        if (!el || !(el.id === slot || String(el.id).startsWith(`${slot}-`))) misplaced++
      }
    }
    ok(lost === 0 && misplaced === 0, `${l.id}: ${cases} orderings (+1 unknown role at every position): the author's content in = content out, each named role in its own slot${bad.length ? ' — ' + bad.join(' ; ') : ''}${misplaced ? ` (${misplaced} misplaced)` : ''}`)
  }
}

console.log('\nthe editor path is the same one\n')
const donorSlide = { id: 'x', elements: [{ id: 'q', type: 'text', role: 'title', html: 'Hi', x: 0, y: 0, w: 1, h: 1 }] } as unknown as Slide
const applied = applyLayout(donorSlide, byId['layout-title-content'], new Set(ids))
ok((applied.find((x) => x.id === 'ltc-title') as TextElement).html === 'Hi', 'applyLayout (the editor\'s "Apply layout") fills a slot by role the same way')
ok(/applyLayout\(slideForApply, layout, known\)/.test(read('slides/src/compact.ts')), 'compact.ts calls that function, not a copy of it')
ok(!/layout\?:/.test(read('slides/src/model.ts').slice(read('slides/src/model.ts').indexOf('export interface Slide '))), 'the Slide model gains no `layout` field — input only')

console.log('\nAGENTS.md cannot drift\n')
const agents = read('AGENTS.md')
for (const l of layouts) {
  if (l.id === 'layout-blank') continue
  const roles = Object.keys(layoutRoles(l))
  const line = `\`${l.id.replace(/^layout-/, '')}\` — ${roles.join(', ')}`
  ok(agents.includes(line), `AGENTS.md lists ${line}`)
}
ok(/"layout": "title-body"/.test(agents) && /"role": "title"/.test(agents), 'AGENTS.md shows the layout + role example')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

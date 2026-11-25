// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Follow the load report's advice, one piece at a time.
//
// loadDoc / Replace from JSON report what loading changed in what the author
// wrote (slides/src/derivelosses.ts), each entry ending in what to write. An
// agent does exactly that and loads again, so every piece of advice must be
// TRUE WHEN FOLLOWED ALONE. For every advice entry of every deck this takes
// each way the entry offers (write the value at the path it names, leave the
// literal out, remove the reference, give the copy the main's value, remove
// the parentId, write the children at the frame's coordinate), applies it ALONE
// to the JSON that was sent, loads that, and checks:
//   - every element is still there, and every text and src is unchanged;
//   - every binding that held still holds (same token);
//   - the binding the advice was about now holds (write / leave out);
//   - the entry is gone, and no entry appears that was not there before,
//     unless the followed entry announced it ("then also: …");
//   - leaving the literal out gives the same value as writing the advised one.
//
// No imports, so the same text runs in node (scripts/test-slides-load-advice.ts,
// through compactload.ts) and in a page (…-browser.mjs, through
// window.bento.loadDoc, with the real fonts and text fitting).

const segs = (p) => p.split('/').slice(1)
function at(root, p) { let h = root; for (const s of p) h = Array.isArray(h) ? h[Number(s)] : h?.[s]; return h }
function setDot(o, p, v) { const s = p.split('.'); let c = o; for (const k of s.slice(0, -1)) { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k] } c[s[s.length - 1]] = v }
function delDot(o, p) { const s = p.split('.'); let c = o; for (const k of s.slice(0, -1)) { c = c?.[k]; if (!c) return } if (c) delete c[s[s.length - 1]] }
const flat = (v, out = []) => { if (Array.isArray(v)) v.forEach((x) => flat(x, out)); else if (v && typeof v === 'object') out.push(v); return out }
const kind = (d) => d.reason.split(':')[0]
export const isAdvice = (d) => /^(binding dropped|binding replaced|override added|parent removed|children reordered)/.test(d.reason)

// ---- decks ------------------------------------------------------------------
const tokens = (extra = {}) => ({ set: {
  card: { type: 'color', values: { default: '#F2F0EA' } },
  ink: { type: 'color', values: { default: '#222222' } },
  fs: { type: 'fontSize', values: { default: 30 } },
  op: { type: 'opacity', values: { default: 0.5 } },
  r: { type: 'number', values: { default: 12 } },
  g: { type: 'number', values: { default: 20 } },
  hh: { type: 'number', values: { default: 80 } },
  ww: { type: 'number', values: { default: 300 } },
  sh: { type: 'shadow', values: { default: { x: 0, y: 4, blur: 12, color: '#00000033' } } },
  ...extra,
} })
const C = (slides, more = {}) => ({ compact: true, title: 'p', theme: { tokens: tokens() }, slides, ...more })
const rect = (o) => ({ type: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100, ...o })

/** Decks that write every kind of thing the load report speaks about. */
export const ADVICE_DECKS = {
  basic: C([{ id: 's1', elements: [
    rect({ id: 'a', fill: '#123456', themeRefs: { fill: '$card' } }),
    rect({ id: 'b', x: 400, stroke: '#123456', strokeWidth: 2, themeRefs: { stroke: '$card' } }),
    rect({ id: 'c', x: 700, radius: 4, themeRefs: { radius: '$r' } }),
    rect({ id: 'd', y: 300, opacity: 1, themeRefs: { opacity: '$op' } }),
    rect({ id: 'e', y: 300, x: 400, w: 120, themeRefs: { w: '$ww' } }),
    { type: 'text', id: 't', x: 100, y: 500, w: 600, md: 'Hello', color: '#000000', fontSize: 20, themeRefs: { color: '$ink', fontSize: '$fs' } },
    { type: 'text', id: 't2', x: 100, y: 600, w: 600, h: 50, html: '<p>hi</p>', themeRefs: { h: '$hh' } },
  ] }]),
  alpha: C([{ id: 's1', elements: [
    rect({ id: 'a', fill: '#12345680', themeRefs: { fill: '$card' } }),
    rect({ id: 'b', x: 400, fill: 'rgba(1,2,3,0.4)', themeRefs: { fill: '$card' } }),
  ] }]),
  modes: { compact: true, theme: { tokens: { ...tokens({ card: { type: 'color', values: { light: '#FFFFFF', dark: '#111111' } } }), modes: ['light', 'dark'], mode: 'dark' } },
    slides: [{ id: 's1', background: '#333333', themeRefs: { background: '$card' }, elements: [rect({ id: 'a', fill: '#FFFFFF', themeRefs: { fill: '$card' } })] }] },
  nested: C([{ elements: [
    { type: 'text', md: 'title', x: 10, y: 10, w: 500, color: '#000000', themeRefs: { color: '$ink' } },
    [rect({ fill: '#000000', themeRefs: { fill: '$card' } }), [rect({ x: 500, fill: '#000001', themeRefs: { fill: '$card' } }), { md: 'body', x: 10, y: 400, w: 500, color: '#010101', themeRefs: { color: '$ink' } }]],
  ] }, { elements: [[rect({ fill: '#000002', themeRefs: { fill: '$card' } })]] }]),
  frames: C([{ id: 's1', elements: [
    rect({ id: 'f', x: 50, y: 50, w: 1100, h: 300, fill: '#EEEEEE', layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] }, themeRefs: { 'layout.gap': '$g', fill: '$card' } }),
    rect({ id: 'k1', parentId: 'f', x: 900, fill: '#000000', themeRefs: { fill: '$card' } }),
    rect({ id: 'k2', parentId: 'f', x: 0, w: 100, themeRefs: { w: '$ww' } }),
    { id: 'k3', parentId: 'f', type: 'text', x: 400, y: 0, w: 200, md: 'kid', fontSize: 12, themeRefs: { fontSize: '$fs' } },
    rect({ id: 'orph', parentId: 'nope', y: 500, fill: '#000000', themeRefs: { fill: '$card' } }),
    rect({ id: 'nf', y: 500, x: 600, themeRefs: { 'layout.gap': '$g' } }),
    rect({ id: 'shd', y: 400, x: 900, themeRefs: { 'shadow.color': '$ink' } }),
  ] }]),
  fill_sizing: C([{ id: 's1', elements: [
    rect({ id: 'f', x: 50, y: 50, w: 1100, h: 300, layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }),
    rect({ id: 'k', parentId: 'f', w: 100, sizing: { w: 'fill' }, themeRefs: { w: '$ww' } }),
    rect({ id: 'j', parentId: 'f', w: 100 }),
  ] }]),
  wrapgrid: C([{ id: 's1', elements: [
    rect({ id: 'gf', x: 50, y: 50, w: 1100, h: 600, layout: { dir: 'grid', cols: 2, gap: 10, pad: [10, 10, 10, 10] } }),
    rect({ id: 'g1', parentId: 'gf', x: 700, y: 400 }), rect({ id: 'g2', parentId: 'gf', x: 0, y: 0 }), rect({ id: 'g3', parentId: 'gf', x: 700, y: 0 }),
  ] }, { id: 's2', elements: [
    rect({ id: 'wf', x: 50, y: 50, w: 600, h: 600, layout: { dir: 'row', wrap: true, gap: 10, pad: [10, 10, 10, 10] } }),
    rect({ id: 'w1', parentId: 'wf', x: 400, y: 300 }), rect({ id: 'w2', parentId: 'wf', x: 0, y: 0 }), rect({ id: 'w3', parentId: 'wf', x: 300, y: 0 }),
  ] }]),
  components: C([{ id: 's1', elements: [
    rect({ id: 'm', groupId: 'gm', fill: '#AA0000', component: { id: 'c1', key: 'k', main: true }, themeRefs: { stroke: '$ink' }, stroke: '#000000', strokeWidth: 2 }),
    rect({ id: 'cp', groupId: 'gc', x: 500, fill: '#00AA00', component: { id: 'c1', key: 'k' } }),
    rect({ id: 'cp2', groupId: 'gc2', x: 800, fill: '#123456', component: { id: 'c1', key: 'k' }, themeRefs: { fill: '$card' } }),
    rect({ id: 'cp3', groupId: 'gc3', y: 400, fill: '#AA0000', stroke: '#111111', strokeWidth: 2, component: { id: 'c1', key: 'k', sig: 'x' }, themeRefs: { stroke: '$ink' } }),
  ] }, { id: 's2', elements: [
    rect({ id: 'cp4', groupId: 'gc4', fill: '#AA0000', component: { id: 'c1', key: 'k', over: ['radius'] }, radius: 4, themeRefs: { radius: '$r' } }),
  ] }]),
  copy_own_binding: C([{ id: 's1', elements: [
    rect({ id: 'm', groupId: 'gm', fill: '#AA0000', component: { id: 'c1', key: 'k', main: true } }),
    rect({ id: 'cp', groupId: 'gc', x: 500, fill: '#F2F0EA', stroke: '#123456', strokeWidth: 3, component: { id: 'c1', key: 'k' }, themeRefs: { fill: '$card' } }),
    rect({ id: 'cq', groupId: 'gq', x: 800, fill: '#AA0000', component: { id: 'c1', key: 'k', sig: 'reset' }, stroke: '#222222', themeRefs: { stroke: '$ink' } }),
  ] }]),
  roles_builtin: C([{ id: 's1', layout: 'title-body', elements: [
    { role: 'title', md: 'Title', color: '#000000', themeRefs: { color: '$ink' } },
    { role: 'body', md: 'Body', fontSize: 10, themeRefs: { fontSize: '$fs' } },
    { role: 'body', md: 'Body2', color: '#000000', themeRefs: { color: '$ink' } },
  ] }, { id: 's2', layout: 'title-body', elements: [
    { role: 'title', id: 'ltc-title', md: 'T2', color: '#000000', themeRefs: { color: '$ink' } },
    { role: 'title', x: 100, y: 600, w: 500, h: 60, md: 'framed', color: '#000000', themeRefs: { color: '$ink' } },
  ] }]),
  roles_own: C([{ id: 's1', layout: 'L1', elements: [
    { role: 'title', md: 'Hello', color: '#000000', themeRefs: { color: '$ink' } },
  ] }, { id: 's2', layout: 'L1', elements: [
    { role: 'title', id: 'lt', md: 'Hi again' },
  ] }, { id: 's3', layout: 'L1', elements: [{ role: 'title', md: 'three' }] }],
  { layouts: [{ id: 'L1', name: 'Mine', background: '#FFFFFF', transition: 'fade', notes: '', elements: [
    { id: 'lt', type: 'text', role: 'title', x: 100, y: 100, w: 1000, h: 100, rotation: 0, opacity: 1, html: '<p>Title</p>', fontFamily: 'Inter, sans-serif', fontSize: 40, fontWeight: 700, color: '#000000', align: 'left', themeRefs: { color: '$ink' } },
    { id: 'lbg', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 900, rotation: 0, opacity: 1, fill: '#000000', stroke: 'none', strokeWidth: 0, radius: 0, themeRefs: { fill: '$card' } },
  ] }] }),
  states: C([{ id: 's1', elements: [rect({ id: 'a', fill: '#000000', themeRefs: { fill: '$card' } })] },
    { id: 's1b', stateOf: 's1', elements: [rect({ id: 'a', x: 600, fill: '#000000', themeRefs: { fill: '$card' } })] }]),
  slidebg: C([{ id: 's1', background: '#000000', themeRefs: { background: '$card' }, elements: [] },
    { id: 's2', layout: 'section', themeRefs: { background: '$card' }, elements: [{ role: 'title', md: 'x' }] }]),
  tablechart: C([{ id: 's1', elements: [
    { type: 'table', id: 'tb', x: 100, y: 100, w: 600, h: 200, columns: 2, rows: [['a', 'b'], ['c', 'd']], themeRefs: { 'style.headerBg': '$card', 'style.fontSize': '$fs' } },
    { type: 'chart', id: 'ch', x: 700, y: 100, w: 400, h: 300, option: { series: [] }, opacity: 0.9, themeRefs: { opacity: '$op' } },
    { type: 'code', id: 'cd', x: 100, y: 400, w: 600, h: 200, content: 'x=1', fontSize: 10, themeRefs: { fontSize: '$fs' } },
  ] }]),
  palette: C([{ id: 's1', elements: [
    rect({ id: 'p', fill: '#000000', themeRefs: { fill: 'accent1' } }),
    rect({ id: 'pa', x: 400, fill: '#00000080', themeRefs: { fill: 'accent1 /a' } }),
    rect({ id: 'mix', x: 700, fill: '#000000', stroke: '#000000', strokeWidth: 2, themeRefs: { fill: 'accent1', stroke: '$ink' } }),
  ] }]),
  full_doc: { format: 'bento/slides', version: 1, title: 'F', size: { width: 1280, height: 720 },
    theme: { background: '#ffffff', color: '#111111', accent: '#f7a600', fontFamily: 'Inter, sans-serif', tokens: tokens() },
    slides: [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: [
      { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#123456', stroke: '#000000', strokeWidth: 0, radius: 0, themeRefs: { fill: '$card' } },
      { id: 'b', type: 'shape', shape: 'rect', x: 200, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#123456', stroke: '#000000', strokeWidth: 0, themeRefs: { radius: '$r' } },
    ] }] },
}

// ---- following ----------------------------------------------------------------

/** Every way an entry offers to fix it, each applied alone to a copy of the input. */
function ways(input, d, bad) {
  const res = []
  const r = d.reason
  const copyAt = (p) => { const next = structuredClone(input); return { next, h: at(next, p) } }
  if (r.startsWith('binding dropped') || r.startsWith('binding replaced')) {
    const m = /\/themeRefs\/(.+)$/.exec(d.path)
    const prop = m[1]
    const hp = segs(d.path.slice(0, m.index))
    const w = /Write (.+?) at "([^"]+)"(?: and (.+?) at "([^"]+)")?(?: in (\/\S+))?(?: \([^)]*\))? to keep it bound/.exec(r)
    const rm = /Remove themeRefs\["([^"]+)"\]/.exec(r)
    if (w) {
      const target = w[5] ? segs(w[5]) : hp
      const { next, h } = copyAt(target)
      if (!h) bad(`advice target ${w[5] ?? d.path} names nothing in the input`)
      else {
        setDot(h, w[2], JSON.parse(w[1]))
        if (w[3]) setDot(h, w[4], JSON.parse(w[3]))
        res.push({ how: `write ${w[1]} at ${w[2]}${w[3] ? ` and ${w[3]} at ${w[4]}` : ''}${w[5] ? ' in ' + w[5] : ''}`, next, prop })
      }
    } else if (rm) {
      const { next, h } = copyAt(hp)
      if (!h?.themeRefs) bad(`advice path ${d.path} has no themeRefs in the input`)
      else { delete h.themeRefs[rm[1]]; res.push({ how: `remove themeRefs["${rm[1]}"]`, next, removes: `${rm[1]}` }) }
    } else bad(`binding advice names nothing to do: ${r}`)
    const leave = /or leave "([^"]+)" out/.exec(r)
    if (leave) {
      const { next, h } = copyAt(hp)
      if (h) { delDot(h, leave[1]); res.push({ how: `leave ${leave[1]} out`, next, prop, omit: true }) }
    }
  } else if (r.startsWith('override added')) {
    const hp = segs(d.path).slice(0, -1)
    const w = /Write (.+?) at "([^"]+)" on this copy/.exec(r)
    const rm = /Remove "([^"]+)" from this copy/.exec(r)
    const { next, h } = copyAt(hp)
    if (!h?.component) bad(`override advice path ${d.path} has no component in the input`)
    else if (w) { setDot(h, w[2], JSON.parse(w[1])); res.push({ how: `write the main's ${w[1]} at ${w[2]}`, next }) }
    else if (rm) { delDot(h, rm[1]); res.push({ how: `remove ${rm[1]} from the copy`, next }) }
    else if (/Set component\.sig to "reset"/.test(r)) { h.component.sig = 'reset'; res.push({ how: 'sig reset', next }) }
    else bad(`override advice names nothing to do: ${r}`)
  } else if (r.startsWith('parent removed')) {
    const hp = segs(d.path).slice(0, -1)
    const { next, h } = copyAt(hp)
    if (!h) bad(`parent advice path ${d.path} names nothing in the input`)
    else { delete h.parentId; res.push({ how: 'remove parentId', next }) }
  } else if (r.startsWith('children reordered')) {
    const hp = segs(d.path)
    const { next, h: f } = copyAt(hp)
    const xm = /"x": (-?[\d.]+)/.exec(r), ym = /"y": (-?[\d.]+)/.exec(r)
    const slide = at(next, hp.slice(0, 2))
    for (const k of flat(slide.elements)) if (k.parentId === f.id) { if (xm) k.x = Number(xm[1]); if (ym) k.y = Number(ym[1]) }
    res.push({ how: `children at ${xm?.[0] ?? ''} ${ym?.[0] ?? ''}`, next })
  }
  return res
}

const ids = (doc) => new Set([...doc.slides.flatMap((s) => s.elements.map((e) => `${s.id}|${e.id}`)), ...(doc.layouts ?? []).flatMap((s) => s.elements.map((e) => `L${s.id}|${e.id}`))])
const refs = (doc) => {
  const m = new Map()
  for (const [g, list] of [['S', doc.slides], ['L', doc.layouts ?? []]]) for (const s of list) {
    for (const [p, r] of Object.entries(s.themeRefs ?? {})) m.set(`${g}${s.id}||${p}`, r)
    for (const e of s.elements) for (const [p, r] of Object.entries(e.themeRefs ?? {})) m.set(`${g}${s.id}|${e.id}|${p}`, r)
  }
  return m
}
const contentOf = (doc) => doc.slides.map((s) => s.elements.map((e) => (e.html ?? e.src ?? '')).join('¦')).join('§')
/** The binding an entry speaks about, as refs() keys it. */
function bindingKey(d, prop) {
  const m = /element "([^"]+)" on (slide|layout) "([^"]+)"|^binding (?:dropped|replaced): (slide|layout) "([^"]+)"/.exec(d.reason)
  if (!m) return null
  return m[1] ? `${m[2] === 'slide' ? 'S' : 'L'}${m[3]}|${m[1]}|${prop}` : `${m[4] === 'slide' ? 'S' : 'L'}${m[5]}||${prop}`
}
/** The value an entry's holder has at `prop` in a loaded document. */
function valueAt(doc, d, prop) {
  const m = /element "([^"]+)" on (slide|layout) "([^"]+)"|^binding (?:dropped|replaced): (slide|layout) "([^"]+)"/.exec(d.reason)
  if (!m) return undefined
  const list = (m[2] ?? m[4]) === 'slide' ? doc.slides : doc.layouts ?? []
  const s = list.find((x) => x.id === (m[3] ?? m[5]))
  const h = m[1] ? s?.elements.find((e) => e.id === m[1]) : s
  return JSON.stringify(prop.split('.').reduce((o, k) => o?.[k], h))
}
/** "then also: override added on element "cp" ("stroke"), …" — what following announces. */
const announced = (d) => {
  const m = /then also: ([^)]*)\)/.exec(d.reason)
  return m ? m[1] : ''
}

/**
 * Follow every piece of advice of every deck alone. `load(json)` returns
 * `{ doc, report }` or null. Returns the lines, the count followed and the problems.
 */
export async function followAll(load, decks) {
  const lines = []
  const problems = []
  let followed = 0
  const log = (m) => lines.push(m)
  for (const [name, deck] of Object.entries(decks)) {
    const json = typeof deck === 'string' ? deck : JSON.stringify(deck)
    const bad = (m) => { problems.push(`${name}: ${m}`); log('  PROBLEM ' + m) }
    const first = await load(json)
    if (!first) { bad('does not load'); continue }
    const input = JSON.parse(json)
    const adv = first.report.dropped.filter(isAdvice)
    log(`${name}: ${adv.length} advice entries`)
    for (const d of adv) {
      log(`    · ${d.path}: ${d.reason}`)
      if (/\bundefined\b/.test(d.reason)) bad(`${d.path}: the reason says "undefined": ${d.reason}`)
    }
    const id0 = ids(first.doc), refs0 = refs(first.doc), content0 = contentOf(first.doc)
    const before = new Set(adv.map((x) => x.path + kind(x)))
    for (const d of adv) for (const w of ways(input, d, bad)) {
      followed++
      const tag = `${d.path} :: ${w.how}`
      const again = await load(JSON.stringify(w.next))
      if (!again) { bad(`${tag}: no longer loads`); continue }
      const id1 = ids(again.doc)
      for (const k of id0) if (!id1.has(k)) bad(`${tag}: element ${k} lost`)
      if (contentOf(again.doc) !== content0) bad(`${tag}: text/src content changed`)
      const refs1 = refs(again.doc)
      for (const [k, r] of refs0) if (refs1.get(k) !== r) bad(`${tag}: binding ${k}=${r} held before, now ${refs1.get(k)}`)
      if (w.prop) {
        const key = bindingKey(d, w.prop)
        if (!key || !refs1.has(key)) bad(`${tag}: following it, the binding ${key} still does not hold`)
      }
      const still = again.report.dropped.filter(isAdvice)
      const same = still.find((x) => x.path === d.path && kind(x) === kind(d))
      if (same) bad(`${tag}: the same entry is still reported: ${same.reason}`)
      const said = announced(d)
      for (const x of still) {
        if (before.has(x.path + kind(x))) continue
        const id = /element "([^"]+)"/.exec(x.reason)?.[1]
        if (id && said.includes(`"${id}"`)) continue
        bad(`${tag}: a NEW entry ${x.path}: ${x.reason}`)
      }
      if (w.omit) {
        const wr = ways(input, d, bad).find((z) => z.how.startsWith('write'))
        const a2 = wr && await load(JSON.stringify(wr.next))
        const v1 = valueAt(again.doc, d, w.prop), v2 = a2 ? valueAt(a2.doc, d, w.prop) : 'no write advice'
        if (v1 !== v2) bad(`${tag}: leaving it out gives ${v1}, writing the advised value gives ${v2}`)
      }
    }
  }
  return { lines, followed, problems }
}

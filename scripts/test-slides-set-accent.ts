#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Changing the accent is one operation that leaves no stale bound value.
//
//   node scripts/test-slides-set-accent.ts
//
// WHAT THIS PROVES. Setting `theme.accent` alone leaves every literal bound to
// the accent holding the old colour until the app next opens and saves the
// deck; a find-and-replace of the hex rewrites colours nobody bound. On the
// starter deck, setAccent (slides/src/accent.ts):
//   - leaves no palette-bound literal behind the palette (validate(): no
//     theme-ref-stale), and the result is a derive fixed point;
//   - re-derives a chart palette that the old accent derived, keeps a
//     hand-chosen one byte for byte and says so, and leaves an absent one absent;
//   - lists unbound values near the old accent and leaves them byte-identical,
//     where the find-and-replace variant changes them;
//   - changes nothing but the accent, the derived chart palette and bound
//     literals: tokens, component mains and layouts keep every other value;
//   - is one undo step through the editor's store.

// validate.ts reaches render.ts and its extensionless imports: resolve them as the build does
import { register } from 'node:module'
register('./lib/ts-resolve-hooks.mjs', import.meta.url)
const { starterDoc } = await import('../slides/src/starterdeck.ts')
const { setAccent, writeAccent, nearAccent, NEAR_ACCENT } = await import('../slides/src/accent.ts')
const { derive, deriveMemory } = await import('../slides/src/derive.ts')
const { validateDoc } = await import('../slides/src/validate.ts')
const { deriveChartPalette } = await import('../slides/src/model.ts')
const { parseThemeRef } = await import('../slides/src/palette.ts')
const { Store } = await import('../slides/src/store.ts')

let checks = 0
let failures = 0
const ok = (c: unknown, msg: string) => { checks++; if (!c) { failures++; console.error('  FAIL ', msg) } else console.log('  ok   ', msg) }

const GREEN = '#0A7F5A'
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const stale = (d: any) => validateDoc(d, { measure: false }).findings.filter((f) => f.code === 'theme-ref-stale')
const at = (holder: any, path: string) => path.split('.').reduce((c, k) => (c == null ? c : c[k]), holder)
const holderOf = (d: any, n: { slide?: string; element?: string }) => {
  const s = [...d.slides, ...(d.layouts ?? [])].find((x: any) => x.id === n.slide)
  return n.element ? s?.elements.find((e: any) => e.id === n.element) : s
}

const base = starterDoc()
// a saved layout carries bound literals too (the starter has none of its own)
base.layouts = [{ ...clone(base.slides[1]), id: 'rig-layout' }]
const OLD = base.theme.accent

// --- the trap: the accent alone -----------------------------------------------
const alone = clone(base)
alone.theme.accent = GREEN
const staleAlone = stale(alone).length
ok(staleAlone > 0, `setting theme.accent alone leaves bound literals at the old colour (${staleAlone} theme-ref-stale)`)

// --- the operation --------------------------------------------------------------
const doc = clone(base)
const report = setAccent(doc, GREEN)!
ok(report && report.from === OLD && report.to === GREEN && doc.theme.accent === GREEN, `setAccent sets the accent (${OLD} → ${doc.theme.accent})`)
ok(stale(doc).length === 0, `no theme-ref-stale after setAccent (${stale(doc).length})`)
let changedBound = 0
for (const [i, s] of [...base.slides, ...base.layouts!].entries()) {
  const s2 = [...doc.slides, ...doc.layouts!][i]
  for (const [j, h] of ([s, ...s.elements] as any[]).entries()) {
    const h2: any = [s2, ...s2.elements][j]
    for (const [p, tk] of Object.entries(h.themeRefs ?? {})) if (parseThemeRef(tk as string) && at(h, p) !== at(h2, p)) changedBound++
  }
}
const inLayout = doc.layouts![0].elements.filter((e: any, k: number) => JSON.stringify(e) !== JSON.stringify(base.layouts![0].elements[k])).length
ok(report.followed === changedBound && changedBound >= staleAlone && inLayout > 0,
  `the report counts every bound value that followed, saved layouts included (${report.followed}; ${staleAlone} on slides, ${inLayout} layout elements changed)`)
const fixed = JSON.stringify(doc)
ok(!derive(doc, deriveMemory(doc)) && JSON.stringify(doc) === fixed, 'the result is a derive fixed point: opening it changes nothing')
let left = 0
for (const s of doc.slides) for (const h of [s, ...s.elements] as any[]) for (const [p, t] of Object.entries(h.themeRefs ?? {})) {
  const r = parseThemeRef(t as string)
  if (r?.slot === 'accent1' && r.shift === 0 && String(at(h, p)).toLowerCase() === OLD.toLowerCase()) left++
}
ok(left === 0, `no element bound to accent1 still holds ${OLD} (${left})`)

// --- the chart palette ---------------------------------------------------------
ok(report.chartPalette === 'kept' && JSON.stringify(doc.theme.chartPalette) === JSON.stringify(base.theme.chartPalette),
  `the starter's hand-chosen chart palette is unchanged (${report.chartPalette})`)
ok(report.notes.some((n) => /chart palette left as set/i.test(n)), 'and the report says "chart palette left as set"')
const derived = clone(base)
derived.theme.chartPalette = deriveChartPalette(OLD)
const rd = setAccent(derived, GREEN)!
ok(rd.chartPalette === 'rederived' && JSON.stringify(derived.theme.chartPalette) === JSON.stringify(deriveChartPalette(GREEN)),
  `a chart palette derived from the old accent is re-derived from the new one (${rd.chartPalette}: ${derived.theme.chartPalette?.slice(0, 2)})`)
ok(!rd.nearby.some((n) => n.path.startsWith('theme.chartPalette')), 'a re-derived chart palette is not listed as a look-alike')
const absent = clone(base)
delete absent.theme.chartPalette
const ab = setAccent(absent, GREEN)!
ok(ab.chartPalette === 'follows' && absent.theme.chartPalette === undefined, `no chart palette stays absent: new charts derive from the accent (${ab.chartPalette})`)
const t = { ...clone(base.theme), chartPalette: deriveChartPalette('#ABCDEF') }
ok(writeAccent(t, GREEN) === 'kept' && t.chartPalette[0] === '#ABCDEF', 'a palette derived from some OTHER colour counts as hand-chosen and is kept')

// --- look-alikes: listed, never rewritten -------------------------------------
ok(report.nearby.length > 0, `unbound values near ${OLD} are listed (${report.nearby.length}, within ${NEAR_ACCENT})`)
let moved = 0, bound = 0
for (const n of report.nearby) {
  if (n.path.startsWith('theme.')) { if (at(doc, n.path) !== at(base, n.path)) moved++; continue }
  const after = holderOf(doc, n), before = holderOf(base, n)
  if (at(after, n.path) !== n.value || at(before, n.path) !== n.value) moved++
  if (Object.keys(after?.themeRefs ?? {}).some((r) => n.path === r || n.path.startsWith(`${r}.`))) bound++
}
ok(moved === 0, `every listed look-alike is byte-identical in the document (${moved} moved)`)
ok(bound === 0, `no listed look-alike is a bound path (${bound})`)
ok(report.nearby.some((n) => /^option\.color\.\d+$/.test(n.path)), 'chart series colours already on a slide are among them')
ok(report.nearby.every((n) => n.distance <= NEAR_ACCENT), 'every listed value is within the documented distance')
ok(nearAccent(doc, '#123456').every((n) => n.distance <= NEAR_ACCENT), 'the rule holds for any colour')
// the find-and-replace variant changes a literal the operation leaves alone
const replaced = JSON.parse(JSON.stringify(alone).replace(new RegExp(OLD, 'gi'), GREEN))
const exact = report.nearby.filter((n) => !n.path.startsWith('theme.') && n.value.toLowerCase() === OLD.toLowerCase())
const clobbered = exact.filter((n) => at(holderOf(replaced, n), n.path) === GREEN)
ok(exact.length > 0 && clobbered.length === exact.length,
  `find-and-replace rewrites unbound ${OLD} literals the operation keeps (${clobbered.length} of ${exact.length}, e.g. ${exact[0]?.element}.${exact[0]?.path})`)
ok(stale(replaced).length > 0, `and still leaves shifted bound values stale (${stale(replaced).length} theme-ref-stale)`)

// --- the design system is untouched -------------------------------------------
const { accent: _a, ...themeAfter } = doc.theme
const { accent: _b, ...themeBefore } = base.theme
ok(JSON.stringify(themeAfter) === JSON.stringify(themeBefore), 'the theme changes only at theme.accent (tokens, palette slots, chart palette, code palette)')
const diffs: string[] = []
const walk = (a: any, b: any, path: string) => {
  if (a === b) return
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!path && k === 'elements') continue // a slide's elements are holders of their own
      walk(a[k], b[k], path ? `${path}.${k}` : k)
    }
  } else diffs.push(path)
}
const strays: string[] = []
for (const [i, s] of [...base.slides, ...(base.layouts ?? [])].entries()) {
  const s2 = [...doc.slides, ...(doc.layouts ?? [])][i]
  for (const [j, h] of [s, ...s.elements].entries()) {
    const h2: any = [s2, ...s2.elements][j]
    diffs.length = 0
    walk(h, h2, '')
    for (const d of diffs) {
      const refs = h2.themeRefs ?? {}
      const tok = d.startsWith('themeRefs.') && parseThemeRef(refs[d.slice(10)] ?? '')
      // component.sig is the hash of the main a copy last followed: derived, and it moves with the main's colours
      if (!(parseThemeRef(refs[d] ?? '') || tok || d === 'component.sig')) strays.push(`${h2.id}.${d}`)
    }
  }
}
ok(strays.length === 0, `every other change is a palette-bound literal (or a copy's record of its main): components, layouts and tokens keep their values${strays.length ? ` (${strays.slice(0, 5).join(', ')})` : ''}`)
ok(JSON.stringify(doc.slides.map((s) => s.elements.map((e) => e.id))) === JSON.stringify(base.slides.map((s) => s.elements.map((e) => e.id))), 'no element is added, removed or reordered')

// --- refusal -------------------------------------------------------------------
const bad = clone(base)
const r0 = JSON.stringify(bad)
ok(setAccent(bad, 'green') === null && setAccent(bad, '#0A7F5A80') === null && setAccent(bad, 'url(x)') === null && JSON.stringify(bad) === r0,
  'a value that is not #rgb or #rrggbb is refused and changes nothing')

// --- one undo step ---------------------------------------------------------------
const store = new Store(clone(base))
const before = JSON.stringify(store.doc)
store.commit(() => { setAccent(store.doc, GREEN) })
const after = JSON.stringify(store.doc)
store.undo()
ok(JSON.stringify(store.doc) === before, 'one undo restores the accent and every bound literal')
store.redo()
ok(JSON.stringify(store.doc) === after, 'one redo puts them all back')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

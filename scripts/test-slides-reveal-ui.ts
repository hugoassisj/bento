#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Reveal authoring rig: reading order, the three verbs, the badge click, and
// the badges never reaching a render output.
//
//   node scripts/test-slides-reveal-ui.ts
//
// WHAT THIS PROVES. "Reveal in order" is a pure function of the selection's
// geometry — top-to-bottom, then left-to-right, rows found by vertical
// overlap — so two runs give the same numbers and a list numbers down while a
// row of cards numbers across. The verbs continue the slide's sequence rather
// than restarting it; Remove clears only what was stepped; a badge click
// moves its element one place later by swapping, so no two elements ever end
// up on one step by accident and the steps stay 1..k, never 0. And the badge layer is editor chrome
// beside the render surface: render.ts, present.ts and preview.ts do not know
// its class name, so thumbnails, present, print and the file-manager preview
// cannot carry one.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readingOrder, revealInOrder, revealTogether, removeReveal, advanceStep, hasSteps, moveStep, joinStep, compactSteps, removeStep, stepGroups, staggered, type Placed } from '../slides/src/editor/reveal.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const el = (id: string, x: number, y: number, w = 200, h = 60, step?: number): Placed =>
  ({ id, x, y, w, h, ...(step ? { fx: { step } } : {}) })
const ids = (els: { id: string }[]) => els.map((e) => e.id).join(' ')
const steps = (p: { id: string; step: number }[]) => p.map((q) => `${q.id}:${q.step}`).join(' ')

console.log('reading order\n')
const list = [el('c', 100, 300), el('a', 100, 100), el('b', 100, 200)]
ok(ids(readingOrder(list)) === 'a b c', 'a bullet list numbers down the page')
const cards = [el('r', 900, 200, 300, 200), el('l', 100, 200, 300, 200), el('m', 500, 200, 300, 200)]
ok(ids(readingOrder(cards)) === 'l m r', 'a row of cards numbers across')
const ragged = [el('r', 900, 210, 300, 180), el('l', 100, 200, 300, 220), el('m', 500, 190, 300, 200)]
ok(ids(readingOrder(ragged)) === 'l m r', 'cards a few pixels off each other are still one row')
const grid = [el('d', 500, 400), el('b', 500, 100), el('c', 100, 400), el('a', 100, 100)]
ok(ids(readingOrder(grid)) === 'a b c d', 'a 2×2 grid reads row by row')
const twoCol = [el('r1', 700, 100, 200, 60), el('l2', 100, 180, 200, 60), el('l1', 100, 100, 200, 60), el('r2', 700, 180, 200, 60)]
ok(ids(readingOrder(twoCol)) === 'l1 r1 l2 r2', 'two columns of lines interleave by row, as a reader scans them')
const tall = [el('title', 100, 40, 1000, 80), el('body', 100, 140, 1000, 400), el('side', 900, 200, 200, 60)]
ok(ids(readingOrder(tall)) === 'title body side', 'an element inside a taller neighbour\'s extent joins its row, after it')
const shuffled = [...grid].reverse()
ok(ids(readingOrder(shuffled)) === ids(readingOrder(grid)), 'order does not depend on input order')
ok(ids(readingOrder([el('y', 100, 100), el('x', 100, 100)])) === 'x y', 'exact ties break by id — deterministic')
ok(readingOrder([]).length === 0, 'empty selection, empty order')

console.log('\nreveal in order\n')
const slide = [el('t', 100, 40, 1000, 80), el('p1', 100, 200), el('p2', 100, 300), el('p3', 100, 400)]
ok(steps(revealInOrder(slide, [slide[3], slide[1], slide[2]])) === 'p1:1 p2:2 p3:3', 'three bullets → steps 1, 2, 3 in reading order')
const withBase = [el('t', 100, 40, 1000, 80, 2), el('p1', 100, 200), el('p2', 100, 300)]
ok(steps(revealInOrder(withBase, [withBase[1], withBase[2]])) === 'p1:3 p2:4', 'a second batch continues after the slide\'s last step')
const renumber = [el('p1', 100, 200, 200, 60, 5), el('p2', 100, 300, 200, 60, 9)]
ok(steps(revealInOrder(renumber, renumber)) === 'p1:1 p2:2', 're-ordering the same batch renumbers it from 1 (its own steps do not count as a base)')
ok(steps(revealInOrder(slide, [slide[2]])) === 'p2:1', 'one element → the next free step')

console.log('\nreveal together / remove\n')
ok(steps(revealTogether(slide, [slide[1], slide[2], slide[3]])) === 'p1:1 p2:1 p3:1', 'together → one step for all')
ok(steps(revealTogether(withBase, [withBase[1], withBase[2]])) === 'p1:3 p2:3', '…after the rest of the slide')
ok(steps(removeReveal([el('a', 0, 0, 1, 1, 2), el('b', 0, 0, 1, 1), el('c', 0, 0, 1, 1, 1)])) === 'a:0 c:0', 'remove clears only the stepped ones')
ok(removeReveal([el('b', 0, 0, 1, 1)]).length === 0, 'nothing stepped → nothing to write (no spurious undo step)')

console.log('\nbadge click: move, never collide\n')
// The click used to CYCLE one element (1 → … → max+1 → 1) and write it alone,
// so from 1, 2, 3 a click on 3 gave 1, 2, 1: two elements on step 1 and no
// step 3 (MP-03). These checks replace the cycle's: '1 → 2' is now a swap with
// the element on 2; 'at the top wraps to 1' now moves the rest one later;
// 'joins one past the others' last step' is now 'leaves its group'; 'never
// to 0' stands as it was.
/** Apply a click's patches to a copy of the slide, as the badge layer does. */
const click = (s: Placed[], id: string, dir: 1 | -1 = 1): Placed[] => {
  const patch = new Map(advanceStep(s, s.find((e) => e.id === id)!, dir).map((q) => [q.id, q.step]))
  return s.map((e) => (patch.has(e.id) ? { ...e, fx: { ...(e.fx ?? {}), step: patch.get(e.id) } } : e))
}
const at = (s: Placed[]) => s.map((e) => `${e.id}:${e.fx?.step ?? 0}`).join(' ')
/** Steps are exactly 1..k and no element shares its step with another. */
const distinct = (s: Placed[]) => {
  const st = s.map((e) => e.fx?.step ?? 0).filter((n) => n > 0).sort((a, b) => a - b)
  return st.every((n, i) => n === i + 1)
}
const abc = [el('a', 0, 0, 1, 1, 1), el('b', 0, 0, 1, 1, 2), el('c', 0, 0, 1, 1, 3)]
ok(at(click(abc, 'c')) === 'a:2 b:3 c:1', `a click on the last (3) brings it first and moves the rest one later (${at(click(abc, 'c'))})`)
ok(distinct(click(abc, 'c')), '…no two elements share a step, no number is missing (the parent gave a:1 b:2 c:1)')
ok(at(click(abc, 'a')) === 'a:2 b:1 c:3', `a click on 1 swaps it with the element on 2 (${at(click(abc, 'a'))})`)
ok(at(click(abc, 'b')) === 'a:1 b:3 c:2', `a click on 2 swaps it with the element on 3 (${at(click(abc, 'b'))})`)
let walk = abc
const seen: string[] = []
for (let n = 0; n < 3; n++) { walk = click(walk, 'a'); seen.push(String(walk[0].fx?.step)); ok(distinct(walk), `click ${n + 1} on a: ${at(walk)} — no duplicate`) }
ok(seen.join(',') === '2,3,1', `repeated clicks walk it through every place (${seen.join(',')})`)
ok(at(walk) === at(abc), 'and k clicks on a k-step slide give back the order it started with')
ok(at(click(click(abc, 'b'), 'b', -1)) === at(abc), 'Shift-click (earlier) undoes a click (later)')
ok(at(click(abc, 'a', -1)) === 'a:3 b:1 c:2', `Shift-click on the first sends it last, the rest one earlier (${at(click(abc, 'a', -1))})`)
const shared = [el('a', 0, 0, 1, 1, 1), el('b', 0, 0, 1, 1, 1), el('c', 0, 0, 1, 1, 2)]
ok(at(click(shared, 'a')) === 'a:2 b:1 c:3', `one of two on a shared step leaves it for its own step right after; later steps move up (${at(click(shared, 'a'))})`)
ok(distinct(click(shared, 'a')), '…and the sequence is 1..k with nothing shared')
ok(at(click(shared, 'b', -1)) === 'a:2 b:1 c:3', `Shift-click on a shared step takes its own step right BEFORE the group (${at(click(shared, 'b', -1))})`)
const pair = [el('x', 0, 0, 1, 1, 1), el('p', 0, 0, 1, 1, 2), el('q', 0, 0, 1, 1, 2)]
ok(at(click(pair, 'x')) === 'x:2 p:1 q:1', `a click swaps with a whole "together" group, which stays together (${at(click(pair, 'x'))})`)
const gaps = [el('a', 0, 0, 1, 1, 2), el('b', 0, 0, 1, 1, 5), el('c', 0, 0, 1, 1, 9)]
ok(at(click(gaps, 'a')) === 'a:2 b:1 c:3', `a slide with gaps (2, 5, 9) comes out numbered 1..k (${at(click(gaps, 'a'))})`)
ok(advanceStep([el('a', 0, 0, 1, 1, 1)], el('a', 0, 0, 1, 1, 1)).length === 0, 'alone on the slide on step 1: nothing to write (no spurious undo step)')
ok(advanceStep(abc, el('z', 0, 0, 1, 1)).length === 0, 'an element without a step is not given one — adding is a verb, not a click')
ok([1, 2, 3].every((s) => advanceStep(abc, abc[s - 1]).every((q) => q.step > 0)), 'never to 0 — removing is a verb, not a click')

// Property: on random small slides, any run of clicks keeps the steps exactly
// 1..k, never shrinks the set of stepped elements, and never makes two
// elements share a step unless they already shared one ("together").
let seed = 0x5eed
const rnd = (n: number) => { // mulberry32: Math.imul keeps every bit exact
  let t = (seed = (seed + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) % n
}
let propFail = ''
let clicks = 0
for (let trial = 0; trial < 400 && !propFail; trial++) {
  const n = 1 + rnd(6)
  let s: Placed[] = Array.from({ length: n }, (_, i) => el('e' + i, 0, 0, 1, 1, rnd(4) === 0 ? 0 : 1 + rnd(4)))
  if (!s.some((e) => e.fx?.step)) continue
  const sharedBefore = new Set<string>()
  for (const a of s) for (const b of s) if (a.id < b.id && a.fx?.step && a.fx.step === b.fx?.step) sharedBefore.add(`${a.id}|${b.id}`)
  const stepped = s.filter((e) => e.fx?.step).map((e) => e.id).join()
  for (let k = 0; k < 12; k++) {
    const pick = s.filter((e) => e.fx?.step)
    const before = at(s)
    s = click(s, pick[rnd(pick.length)].id, rnd(3) === 0 ? -1 : 1)
    clicks++
    const st = s.filter((e) => e.fx?.step)
    const uniq = [...new Set(st.map((e) => e.fx!.step!))].sort((a, b) => a - b)
    if (!uniq.every((v, i) => v === i + 1)) { propFail = `steps not 1..k: ${before} → ${at(s)}`; break }
    if (st.map((e) => e.id).join() !== stepped) { propFail = `stepped set changed: ${before} → ${at(s)}`; break }
    for (const a of st) for (const b of st) if (a.id < b.id && a.fx!.step === b.fx!.step && !sharedBefore.has(`${a.id}|${b.id}`)) propFail = `${a.id} and ${b.id} collided: ${before} → ${at(s)}`
    if (propFail) break
  }
}
ok(!propFail && clicks > 3000, `${clicks} clicks over random slides: always 1..k, nothing newly shared${propFail ? ` — ${propFail}` : ''}`)
ok(!hasSteps(slide) && hasSteps(withBase), 'badges show only when the slide has a step')

console.log('\nbuild order list: move, join, compact, remove\n')
// The Animate tab's Build order list (MP-02). Each verb hands back a 1..k
// numbering, and only the elements whose number changes get a patch.
const apply = (s: Placed[], patches: { id: string; step: number }[]): Placed[] => {
  const m = new Map(patches.map((q) => [q.id, q.step]))
  return s.map((e) => (m.has(e.id) ? { ...e, fx: { ...(e.fx ?? {}), step: m.get(e.id) } } : e))
}
const groupsAt = (s: Placed[]) => stepGroups(s).map((g) => g.join('+')).join(' | ')
ok(groupsAt(abc) === 'a | b | c' && groupsAt(pair) === 'x | p+q', `groups read in step order, a shared step as one group (${groupsAt(pair)})`)
ok(at(apply(abc, moveStep(abc, 'c', 0))) === 'a:2 b:3 c:1', `dragging the row on step 3 above step 1 gives c 1, a 2, b 3 (${at(apply(abc, moveStep(abc, 'c', 0)))})`)
ok(distinct(apply(abc, moveStep(abc, 'c', 0))), '…no duplicate, no gap')
ok(at(apply(abc, moveStep(abc, 'a', 2))) === 'a:3 b:1 c:2', `the first dragged to the end goes last, the rest close up (${at(apply(abc, moveStep(abc, 'a', 2)))})`)
ok(at(apply(abc, moveStep(abc, 'a', 1))) === 'a:2 b:1 c:3', `toIndex counts the groups that remain: 1 = after b (${at(apply(abc, moveStep(abc, 'a', 1)))})`)
ok(moveStep(abc, 'b', 1).length === 0 && moveStep(abc, 'a', 0).length === 0, 'dropped where it already is: nothing to write (no spurious undo step)')
ok(at(apply(abc, moveStep(abc, 'c', -5))) === at(apply(abc, moveStep(abc, 'c', 0))) && at(apply(abc, moveStep(abc, 'a', 99))) === at(apply(abc, moveStep(abc, 'a', 2))), 'toIndex is clamped to the list')
const moved = apply(abc, moveStep(abc, 'c', 0))
ok(moveStep(moved, 'c', 0).length === 0, 'idempotent: the same move again changes nothing')
ok(at(apply(pair, moveStep(pair, 'q', 0))) === 'x:2 p:3 q:1', `a member dragged out of a shared step gets its own step; its partner stays (${at(apply(pair, moveStep(pair, 'q', 0)))})`)
ok(at(apply(pair, moveStep(pair, 'q', 2))) === 'x:1 p:2 q:3', `…or after it (${at(apply(pair, moveStep(pair, 'q', 2)))})`)
ok(moveStep(abc, 'z', 0).length === 0 && moveStep([...abc, el('n', 0, 0, 1, 1)], 'n', 0).length === 0, 'an element that is not stepped is not moved onto a step — that is a Reveal verb')
ok(at(apply(abc, joinStep(abc, 'c', 1))) === 'a:1 b:2 c:1', `dropping c onto step 1 reveals it with a (${at(apply(abc, joinStep(abc, 'c', 1)))})`)
ok(at(apply(abc, joinStep(abc, 'a', 3))) === 'a:2 b:1 c:2', `joining a later step closes the hole it leaves (${at(apply(abc, joinStep(abc, 'a', 3)))})`)
ok(joinStep(abc, 'b', 2).length === 0 && joinStep(abc, 'b', 7).length === 0, 'joining its own step, or a step nobody holds, changes nothing')
ok(at(apply(pair, joinStep(pair, 'q', 1))) === 'x:1 p:2 q:1', `a member of a pair can join another step; its partner stays (${at(apply(pair, joinStep(pair, 'q', 1)))})`)
ok(at(apply(gaps, compactSteps(gaps))) === 'a:1 b:2 c:3', `compact closes gaps: 2, 5, 9 → 1, 2, 3 (${at(apply(gaps, compactSteps(gaps)))})`)
const gapPair = [el('a', 0, 0, 1, 1, 4), el('b', 0, 0, 1, 1, 4), el('c', 0, 0, 1, 1, 9), el('d', 0, 0, 1, 1)]
ok(at(apply(gapPair, compactSteps(gapPair))) === 'a:1 b:1 c:2 d:0', `…elements sharing a step still share it; unstepped stay unstepped (${at(apply(gapPair, compactSteps(gapPair)))})`)
ok(compactSteps(abc).length === 0 && compactSteps(apply(gaps, compactSteps(gaps))).length === 0, 'compact is idempotent: a contiguous slide gets no patch')
ok(at(apply(abc, removeStep(abc, 'a'))) === 'a:0 b:1 c:2', `removing the row on step 1 clears it and the later steps close up (${at(apply(abc, removeStep(abc, 'a')))})`)
ok(at(apply(pair, removeStep(pair, 'p'))) === 'x:1 p:0 q:2', `removing one of a pair leaves its partner on the step (${at(apply(pair, removeStep(pair, 'p')))})`)
ok(removeStep(abc, 'z').length === 0, 'removing an element with no step writes nothing')
// Property: any run of moves, joins and removes keeps the steps 1..k and
// never loses or invents a stepped element (removes aside).
let listFail = ''
let ops = 0
for (let trial = 0; trial < 300 && !listFail; trial++) {
  let s: Placed[] = Array.from({ length: 1 + rnd(6) }, (_, i) => el('e' + i, 0, 0, 1, 1, rnd(4) === 0 ? 0 : 1 + rnd(5)))
  for (let k = 0; k < 10; k++) {
    const pick = s.filter((e) => e.fx?.step)
    if (!pick.length) break
    const id = pick[rnd(pick.length)].id
    const before = at(s)
    const op = rnd(5)
    const kept = pick.length - (op === 4 ? 1 : 0)
    const sts = [...new Set(pick.map((e) => e.fx!.step!))]
    s = apply(s, op < 2 ? moveStep(s, id, rnd(sts.length + 1)) : op < 4 ? joinStep(s, id, sts[rnd(sts.length)]) : removeStep(s, id))
    ops++
    const st = s.filter((e) => e.fx?.step)
    const uniq = [...new Set(st.map((e) => e.fx!.step!))].sort((a, b) => a - b)
    if (!uniq.every((v, i) => v === i + 1)) { listFail = `op ${op} on ${id}: steps not 1..k: ${before} → ${at(s)}`; break }
    if (st.length !== kept) { listFail = `op ${op} on ${id}: stepped count ${st.length}, expected ${kept}: ${before} → ${at(s)}`; break }
  }
}
ok(!listFail && ops > 1500, `${ops} list operations over random slides: always 1..k${listFail ? ` — ${listFail}` : ''}`)
const st3 = (o?: number) => (o === undefined ? {} : { order: o })
const g3 = [{ id: 'p', fx: { step: 2, ...st3() } }, { id: 'q', fx: { step: 2, ...st3() } }, { id: 'r', fx: { step: 2, ...st3() } }]
ok(staggered(g3).map((x) => `${x.el.id}${x.at}`).join(' ') === 'p0 q1 r2', 'no fx.order: each enters one beat after the one before, in slide order (present.ts runEnterFx)')
const g3b = [{ id: 'p', fx: { step: 2, order: 2 } }, { id: 'q', fx: { step: 2 } }, { id: 'r', fx: { step: 2, order: 0 } }]
ok(staggered(g3b).map((x) => `${x.el.id}${x.at}`).join(' ') === 'q0 r0 p2', `fx.order sorts and sets the beat; equal beats enter together (${staggered(g3b).map((x) => `${x.el.id}${x.at}`).join(' ')})`)
const present = read('slides/src/present.ts')
ok(/\.sort\(\(a, b\) => \(a\[0\]\.fx!\.order \?\? 0\) - \(b\[0\]\.fx!\.order \?\? 0\)\)/.test(present) && /const step = fx\.order \?\? i/.test(present) && /delay: \(revealing \? 0 : 0\.12\) \+ Math\.min\(step, 24\) \* 0\.05/.test(present),
  'the show still staggers a step by fx.order the way staggered() says (the Stagger field reports the real beat)')

console.log('\nbadges never reach a render output\n')
for (const f of ['slides/src/render.ts', 'slides/src/present.ts', 'slides/src/preview.ts', 'slides/src/print.ts']) {
  let src = ''
  try { src = read(f) } catch { continue }
  ok(!/step-badge|stepbadges|StepBadges/.test(src), `${f} knows nothing of the badge`)
}
const canvas = read('slides/src/editor/canvas.ts')
ok(/new StepBadges\(store, this\.stage,/.test(canvas), 'the layer mounts on the STAGE beside the render surface, not inside it')
const badges = read('slides/src/editor/stepbadges.ts')
ok(/hasSteps\(slide\.elements\)/.test(badges), 'the layer stands down on a slide without steps')
const onClick = badges.slice(badges.indexOf("addEventListener('click'"))
ok(/advanceStep\(/.test(onClick) && (onClick.match(/store\.commit\(/g) ?? []).length === 1 && /for \(const \{ id, step \} of patches\)/.test(onClick),
  'a badge click writes every renumbered element in ONE commit — one undo step')
ok(/set the number in Animate'/.test(badges) && !/in Presenting'/.test(badges), 'the tooltip names the Animate tab, where the number row lives')
ok(!/renderSlide|sanitizeHtml/.test(badges), 'the badge module never renders slide content')

console.log('\nentry points\n')
const editor = read('slides/src/editor/editor.ts')
ok(/label: t\('Reveal in order'\)/.test(editor) && /label: t\('Reveal together'\)/.test(editor) && /label: t\('Remove reveal'\)/.test(editor), 'the element context menu carries the three verbs')
const panels = read('slides/src/editor/panels.ts')
const animate = read('slides/src/editor/inspector/animate.ts')
ok(/revealRow\(this, els\)/.test(panels.slice(panels.indexOf('buildMultiPanel(els: '), panels.indexOf('buildElementPanel(el: '))), 'a multi-selection panel offers the verbs')
ok(/revealRow\(p, \[el\]\)/.test(animate.slice(animate.indexOf('export function buildPresentingProps'))), 'the Presenting section offers them for one element')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

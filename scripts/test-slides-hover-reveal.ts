#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Hover reveals the validator can see.
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-hover-reveal.ts --bundle --platform=node --format=esm --outfile=/tmp/t.mjs
//   node /tmp/t.mjs
//
// (bundled because it pulls in starterdeck.ts, whose imports are extensionless)
//
// WHAT THIS PROVES. A hover reveal needs three settings that must agree: the
// target's `showOnHover`, a trigger whose `group` has that value, and the
// slide's `hover` set to 'reveal'. Miss one and the show does nothing while the
// JSON looks fine — the trap people and agents both fell into. The validator
// names the two ways it fails, and stays quiet on a reveal that works:
//
//   1. correct     — group, showOnHover and hover:'reveal' agree: no finding.
//   2. unmatched   — a showOnHover no element's group carries (a layer name
//                    typed where a group belongs): `hover-set-unreachable`.
//   3. hover off   — showOnHover and group agree but the slide's hover is
//                    absent, or 'focus-group': `hover-off`, once per slide.
//   4. a trigger the pointer can never be on does not count: the element
//      itself, a hidden one (or one in a hidden frame), one that waits on any
//      hover set — the resting one included, which would flicker.
//   5. the set named by hover.default shows at rest, so it needs no trigger.
//   6. the starter deck and a slide with no reveal at all stay quiet.

import { starterDoc } from '../slides/src/starterdeck.ts'
import { validateDoc } from '../slides/src/validate.ts'
import type { BentoDoc, Slide, SlideElement } from '../slides/src/model.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

const rect = (id: string, extra: Partial<SlideElement> = {}): SlideElement => ({
  id, type: 'shape', shape: 'rect', x: 120, y: 200, w: 300, h: 200, rotation: 0, opacity: 1,
  fill: '#4b8cf5', stroke: 'transparent', strokeWidth: 0, radius: 0, ...extra,
} as SlideElement)
const text = (id: string, extra: Partial<SlideElement> = {}): SlideElement => ({
  id, type: 'text', html: 'Detail card', x: 700, y: 200, w: 400, h: 80, rotation: 0, opacity: 1,
  fontSize: 32, fontFamily: 'Helvetica, sans-serif', fontWeight: 600, color: '#111111', align: 'left', valign: 'top', lineHeight: 1.2, ...extra,
} as SlideElement)
const deck = (slide: Partial<Slide>): BentoDoc => {
  const base = starterDoc()
  return { ...base, assets: base.assets, slides: [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: [], ...slide } as Slide] }
}
const run = (d: BentoDoc) => validateDoc(d, { measure: false }).findings
const hover = (d: BentoDoc) => run(d).filter((f) => f.code.startsWith('hover-'))
const codes = (d: BentoDoc) => hover(d).map((f) => `${f.code}@${f.element ?? f.slide}`).sort().join(' ')

// 1. correct ---------------------------------------------------------------
const correct = deck({ hover: { type: 'reveal' }, elements: [rect('trig', { group: 'Rectangle' }), text('card', { showOnHover: 'Rectangle' })] })
ok(hover(correct).length === 0, `a reveal whose three settings agree reports no hover finding (${codes(correct) || 'none'})`)
ok(run(correct).length === 0, `…and nothing at all (${run(correct).map((f) => f.code).join(', ') || 'none'})`)

// 2. unmatched ---------------------------------------------------------------
const unmatched = deck({ hover: { type: 'reveal' }, elements: [rect('trig'), text('card', { showOnHover: 'Rectangle' })] })
ok(codes(unmatched) === 'hover-set-unreachable@card', `a showOnHover no group carries is hover-set-unreachable on the target (${codes(unmatched) || 'none'})`)
{
  const f = hover(unmatched)[0]
  ok(!!f && f.severity === 'warning' && f.slide === 's1' && f.path === 'showOnHover' && f.message.includes('"Rectangle"'),
    `…a warning with slide, path and the set's name in the message (${f ? `${f.severity} ${f.path}: ${f.message}` : 'none'})`)
}
// a group on ANOTHER slide does not reach: the show matches within the slide
const elsewhere = deck({ hover: { type: 'reveal' }, elements: [text('card', { showOnHover: 'Rectangle' })] })
elsewhere.slides.push({ id: 's2', background: '#ffffff', transition: 'none', notes: '', elements: [rect('trig', { group: 'Rectangle' })] } as Slide)
ok(codes(elsewhere) === 'hover-set-unreachable@card', `a group carried only on another slide does not reach (${codes(elsewhere) || 'none'})`)

// 3. hover off ---------------------------------------------------------------
const off = deck({ elements: [rect('trig', { group: 'Rectangle' }), text('card', { showOnHover: 'Rectangle' }), text('card2', { y: 320, showOnHover: 'Rectangle' })] })
ok(codes(off) === 'hover-off@s1', `showOnHover on a slide with no hover is hover-off, once for the slide (${codes(off) || 'none'})`)
{
  const f = hover(off)[0]
  ok(!!f && f.severity === 'warning' && f.path === 'hover' && !f.element, `…a warning on the slide's hover key (${f ? `${f.severity} ${f.path}` : 'none'})`)
}
const dim = deck({ hover: { type: 'focus-group' }, elements: [rect('trig', { group: 'Rectangle' }), text('card', { showOnHover: 'Rectangle' })] })
ok(codes(dim) === 'hover-off@s1', `…and on a slide whose hover dims other groups (${codes(dim) || 'none'})`)
const both = deck({ elements: [rect('trig'), text('card', { showOnHover: 'Rectangle' })] })
ok(codes(both) === 'hover-off@s1 hover-set-unreachable@card', `the audit's first attempt (a layer name typed, nothing else) reports both (${codes(both) || 'none'})`)

// 3b. a trigger the pointer can never be on ------------------------------------
// an element is never its own trigger: hidden at rest, it takes no pointer
const self = deck({ hover: { type: 'reveal' }, elements: [rect('other'), text('card', { showOnHover: 'x', group: 'x' })] })
ok(codes(self) === 'hover-set-unreachable@card', `an element carrying its own set's group is not its own trigger (${codes(self) || 'none'})`)
const hiddenTrig = deck({ hover: { type: 'reveal' }, elements: [rect('trig', { group: 'g', hidden: true }), text('card', { showOnHover: 'g' })] })
ok(codes(hiddenTrig) === 'hover-set-unreachable@card', `a hidden trigger cannot be pointed at (${codes(hiddenTrig) || 'none'})`)
{
  const f = hover(hiddenTrig)[0]
  ok(!!f && f.message.includes('"trig"') && /hidden/.test(f.message), `…and the message names it and says why (${f?.message ?? 'none'})`)
}
const inHiddenFrame = deck({ hover: { type: 'reveal' }, elements: [rect('frame', { hidden: true, layout: { dir: 'col', gap: 0, pad: [0, 0, 0, 0] } } as Partial<SlideElement>), rect('trig', { group: 'g', parentId: 'frame' } as Partial<SlideElement>), text('card', { showOnHover: 'g' })] })
ok(codes(inHiddenFrame) === 'hover-set-unreachable@card', `nor one inside a hidden frame (${codes(inHiddenFrame) || 'none'})`)
const inSet = deck({ hover: { type: 'reveal' }, elements: [rect('trig', { group: 'g', showOnHover: 'other' }), text('card', { showOnHover: 'g' }), rect('t2', { x: 500, group: 'other' })] })
ok(codes(inSet) === 'hover-set-unreachable@card', `nor one that itself waits on another hover set (${codes(inSet) || 'none'})`)
const inRest = deck({ hover: { type: 'reveal', default: 'intro' }, elements: [rect('trig', { group: 'g', showOnHover: 'intro' }), text('card', { showOnHover: 'g' })] })
ok(codes(inRest) === 'hover-set-unreachable@card', `nor one in the resting set: pointed at, it shows its group's set, which hides it, and the two flicker (${codes(inRest) || 'none'})`)
const twoMembers = deck({ hover: { type: 'reveal' }, elements: [text('a', { showOnHover: 'x', group: 'x' }), text('b', { y: 320, showOnHover: 'x' })] })
ok(codes(twoMembers) === 'hover-set-unreachable@a hover-set-unreachable@b', `a set member carrying the group reveals neither itself nor the others (${codes(twoMembers) || 'none'})`)

// 4. the resting set -----------------------------------------------------------
const rest = deck({ hover: { type: 'reveal', default: 'intro' }, elements: [rect('trig', { group: 'Rectangle' }), text('card', { showOnHover: 'Rectangle' }), text('hello', { y: 320, showOnHover: 'intro' })] })
ok(hover(rest).length === 0, `the hover.default set shows at rest and needs no trigger (${codes(rest) || 'none'})`)

// 5. quiet where nothing is set -------------------------------------------------
const groupsOnly = deck({ hover: { type: 'focus-group' }, elements: [rect('trig', { group: 'a' }), text('card', { group: 'b' })] })
ok(hover(groupsOnly).length === 0, `a focus-group slide with no reveal sets reports nothing (${codes(groupsOnly) || 'none'})`)
const plain = deck({ elements: [rect('trig'), text('card')] })
ok(hover(plain).length === 0, 'a slide with no hover settings at all reports nothing')
const starter = run(starterDoc()).filter((f) => f.code.startsWith('hover-'))
ok(starter.length === 0, `the starter deck reports no hover finding (${starter.map((f) => f.code).join(', ') || 'none'})`)

// read-only, like every check
const before = JSON.stringify(both)
run(both)
ok(JSON.stringify(both) === before, 'validating never changes the document')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

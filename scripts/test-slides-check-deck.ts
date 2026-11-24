// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Check deck: every finding validate() can emit has words a person can read.
//
//   node scripts/test-slides-check-deck.ts
//
// The Check deck panel (slides/src/editor/checkdeck.ts) shows validate()'s
// findings to people, each as a short sentence from FINDING_LABELS
// (slides/src/findinglabels.ts) translated through t(). The labels reach t()
// through a variable, so the literal-key gate (test-slides-i18n-literals.mjs)
// cannot see them; this rig is their gate.
//
// WHAT THIS PROVES:
//   1. every code validate.ts and visualchecks.ts emit (`code: '…'`) has a
//      label, and no label names a code nothing emits any more;
//   2. every label is in all 8 core catalogs, translated (not the English);
//   3. the panel reads its words from FINDING_LABELS, and falls back to the
//      raw message for a code without one.
// The browser half (chip, rows, jump, fixes, keyboard, no run while closed)
// is scripts/test-slides-check-deck-browser.mjs.

import { readFileSync, readdirSync } from 'node:fs'
import { FINDING_LABELS } from '../slides/src/findinglabels.ts'

let checks = 0
let failures = 0
function ok(cond: unknown, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const src = (p: string) => readFileSync(new URL(`../slides/src/${p}`, import.meta.url), 'utf8')

// 1. codes ------------------------------------------------------------------
const emitted = new Set<string>()
for (const f of ['validate.ts', 'visualchecks.ts']) {
  for (const m of src(f).matchAll(/\bcode:\s*'([a-z][a-z-]*)'/g)) emitted.add(m[1])
}
// a code built at run time would hide from the scan above: there must be none
for (const f of ['validate.ts', 'visualchecks.ts']) {
  // (the Finding interface's own `code: string` is the one other `code:`)
  ok(!/\bcode:\s*(?!string\b)[`"a-zA-Z(]/.test(src(f).replace(/\bcode:\s*'[a-z-]*'/g, '')), `${f}: every finding code is a string literal the scan can read`)
}
ok(emitted.size >= 34, `the scan finds the validator's codes (${emitted.size})`)
const missing = [...emitted].filter((c) => !Object.hasOwn(FINDING_LABELS, c))
ok(!missing.length, `every emitted code has a human sentence${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`)
const stale = Object.keys(FINDING_LABELS).filter((c) => !emitted.has(c))
ok(!stale.length, `no label names a code nothing emits${stale.length ? ` — stale: ${stale.join(', ')}` : ''}`)

// 2. catalogs ---------------------------------------------------------------
// the locale list is derived from the generated table, never restated
const packed = src('i18n/packed.ts')
const locales = JSON.parse(/PACKED_LOCALES[^=]*=\s*(\[[^\]]*\])/.exec(packed)![1].replace(/'/g, '"')) as string[]
const core = readdirSync(new URL('../slides/src/i18n/', import.meta.url)).filter((f) => /^[a-zA-Z-]+\.ts$/.test(f) && f !== 'packed.ts')
ok(locales.length === 8 && core.length === locales.length, `8 core catalogs (${locales.join(' ')})`)
for (const loc of locales) {
  const mod = await import(`../slides/src/i18n/${loc}.ts`)
  const cat = Object.values(mod)[0] as Record<string, string>
  const absent = Object.values(FINDING_LABELS).filter((l) => typeof cat[l] !== 'string' || !cat[l].trim())
  const english = Object.values(FINDING_LABELS).filter((l) => cat[l] === l && !/^[A-Z][a-z]*$/.test(l))
  ok(!absent.length, `${loc}: every finding sentence is translated${absent.length ? ` — missing: ${absent.slice(0, 3).join(' | ')}` : ''}`)
  ok(!english.length, `${loc}: no finding sentence is left in English${english.length ? ` — ${english.slice(0, 3).join(' | ')}` : ''}`)
}

// 3. the panel reads them ---------------------------------------------------
const panel = src('editor/checkdeck.ts')
ok(/FINDING_LABELS\[f\.code\]/.test(panel), 'the panel looks a finding up by its code in FINDING_LABELS')
ok(/label \? t\(label\) : f\.message/.test(panel), 'an unknown code falls back to the raw message; a known one goes through t()')

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)

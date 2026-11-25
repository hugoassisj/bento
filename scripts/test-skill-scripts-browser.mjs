// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The skill's browser script, run as an agent runs it.
//
// references/app.md in the bento-slides skill carries drive.cjs: one call that
// opens a deck with the app's network off, loads a document, prints the load
// report and findings, writes a picture per slide and saves the deck. This rig
// extracts that script verbatim and runs it against the built shell:
//
//   - `--help` prints the usage;
//   - deck + pictures, no document (arguments go by kind, so none is empty):
//     one picture per slide in the show, the deck left byte for byte;
//   - a compact document built from the skill's own examples, the arguments
//     in another order: nothing dropped, no error finding, the deck saved,
//     and the saved deck reopens with the same findings.
//
// drive.cjs itself aborts every http(s) request, closes every socket and turns
// the app's offline switch on; the rig adds no network of its own.
//
// Run: (cd slides && npm run build:single) && node scripts/test-skill-scripts-browser.mjs
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REFS = join(root, 'plugins/bento-slides/skills/bento-slides/references')
const shell = join(root, 'slides/dist-single/Bento_Slides.bento.html')
const fence = (file, lang) => [...readFileSync(join(REFS, file), 'utf8').matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1])
const drive = fence('app.md', 'js').find((c) => c.startsWith('// node drive.cjs'))
ok(!!drive, 'app.md carries drive.cjs')

// drive.cjs requires playwright by name; CI installs it outside the repo
const pw = process.env.PLAYWRIGHT_MODULE
const nodePath = [pw ? pw.replace(/[\\/]playwright[\\/][^\\/]+$/, '') : '', process.env.NODE_PATH ?? ''].filter(Boolean).join(':')
const dir = mkdtempSync(join(tmpdir(), 'skill-scripts-'))
const run = (...args) => spawnSync(process.execPath, [join(dir, 'drive.cjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_PATH: nodePath }, timeout: 120000 })
const report = (r) => { try { return JSON.parse(r.stdout) } catch { return null } }
try {
  writeFileSync(join(dir, 'drive.cjs'), drive)
  const help = run('--help')
  ok(help.status === 0 && /drive\.cjs deck\.bento\.html \[doc\.json\] \[shots-dir\]/.test(help.stdout), '--help prints the usage')

  console.log('\na deck and a pictures folder, no document\n')
  const deck = join(dir, 'deck.bento.html')
  copyFileSync(shell, deck)
  const look = run(deck, 'shots')
  const r1 = report(look)
  ok(look.status === 0 && !!r1, `runs with no document argument${look.stderr ? ` (${look.stderr.trim().slice(0, 200)})` : ''}`)
  const pngs = (d) => { try { return readdirSync(join(dir, d)).filter((f) => f.endsWith('.png')) } catch { return [] } }
  ok(pngs('shots').length >= 10, `one picture per slide in the show (${pngs('shots').length}, ${r1?.shots})`)
  ok(r1 && (r1.shots === 'editor view' || r1.shots === 'slides'), 'the report says which kind of picture it wrote')
  ok(readFileSync(deck).equals(readFileSync(shell)), 'without a document the deck is left byte for byte')
  ok(r1 && !('load' in r1) && typeof r1.counts?.error === 'number', 'the report has findings and no load section')

  console.log('\na compact document from the skill\'s own examples, arguments reordered\n')
  const motion = JSON.parse(fence('motion.md', 'json')[0])
  const [chart, table] = fence('data.md', 'json').map((j) => JSON.parse(j))
  const doc = { ...motion, title: 'Skill examples', slides: [...motion.slides, { id: 's3', elements: [chart] }, { id: 's4', elements: [table] }] }
  writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
  const load = run('shots2', 'doc.json', deck)
  const r2 = report(load)
  ok(load.status === 0 && !!r2, `loads the document${load.stderr ? ` (${load.stderr.trim().slice(0, 200)})` : ''}`)
  ok(r2 && Array.isArray(r2.load?.dropped) && r2.load.dropped.length === 0, `nothing dropped (${JSON.stringify(r2?.load?.dropped)})`)
  ok(r2 && r2.counts.error === 0 && r2.counts.warning === 0, `no error or warning finding (${JSON.stringify(r2?.counts)}: ${(r2?.findings ?? []).join('; ').slice(0, 300)})`)
  ok(pngs('shots2').length === 4, `four pictures for four slides (${pngs('shots2').length})`)
  const saved = readFileSync(deck, 'utf8')
  const block = /<script[^>]*\bid="bento-doc"[^>]*>([\s\S]*?)<\/script>/.exec(saved)?.[1] ?? ''
  let back = null
  try { back = JSON.parse(block) } catch { /* reported below */ }
  ok(back?.title === 'Skill examples' && back.slides.length === 4 && !('compact' in back), 'the deck is saved with the full document')
  ok(!block.includes('<'), 'the saved block escapes every <')
  const again = report(run(deck))
  ok(again && JSON.stringify(again.counts) === JSON.stringify(r2?.counts), 'the saved deck reopens with the same findings')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

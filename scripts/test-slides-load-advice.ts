// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Every piece of load-report advice is true when followed alone (node).
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-load-advice.ts --bundle --platform=node --format=esm --outfile=/tmp/test-slides-load-advice.mjs
//   node /tmp/test-slides-load-advice.mjs        (from the repo root)
//
// The load report (slides/src/derivelosses.ts) ends each entry in what to
// write. scripts/lib/load-advice.mjs follows each piece of advice ALONE on the
// JSON that was sent, loads the result and checks that nothing was lost, the
// advised binding holds, the entry is gone and nothing unannounced appeared.
// Here it runs through compactload.ts without a DOM (no text fitting); the
// browser rig runs the same decks through window.bento.loadDoc.
import fs from 'node:fs'
import path from 'node:path'
import { parseDocInputReport } from '../slides/src/compactload.ts'
import { ADVICE_DECKS, followAll } from './lib/load-advice.mjs'

const fixtures = path.resolve('scripts/fixtures/agent-decks')
if (!fs.existsSync(fixtures)) throw new Error('run from the repo root — scripts/fixtures/agent-decks not found')
const decks: Record<string, unknown> = {}
for (const f of fs.readdirSync(fixtures).filter((n) => n.endsWith('.json')).sort()) decks[f] = fs.readFileSync(path.join(fixtures, f), 'utf8')
Object.assign(decks, ADVICE_DECKS)

const { lines, followed, problems } = await followAll((json: string) => parseDocInputReport(json, { fit: false }), decks)
if (process.env.VERBOSE) console.log(lines.join('\n'))
for (const p of problems) console.log(`  FAIL  ${p}`)
const total = Object.keys(decks).length
console.log(`\n${total} decks, ${followed} pieces of advice followed alone, ${problems.length} problems`)
const ok = followed >= 60 && problems.length === 0
if (followed < 60) console.log('  FAIL  fewer pieces of advice than the decks are written to produce — the report went quiet')
console.log(ok ? `${total}/${total} decks clean` : 'FAILED')
process.exit(ok ? 0 : 1)

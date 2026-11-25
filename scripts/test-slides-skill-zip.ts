#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The skill zip carries the whole skill folder; the references are published.
//
//     node scripts/test-slides-skill-zip.ts
//
// A slides release used to zip `bento-slides/SKILL.md` alone, so whoever
// uploaded it through a hosted assistant's skill upload got no
// references, no scripts and no app to work offline with. release.mjs now
// packages through scripts/skill-package.mjs; this rig builds the zip into a
// temp directory, offline, and reads its listing back with `unzip`.
//
// Rows: a fixture folder (references, scripts, nested and top-level evals/,
// a dot-file, a stale bundled asset) zips to exactly the expected listing,
// with the shell and schema bundled byte for byte; the refusals; the REAL
// skill folder zips every tracked file outside evals/ plus the two assets
// (listing and size printed); references are published as .md only, and a
// skill without references publishes nothing; release.mjs is wired to the
// module with the staged shell, and still publishes the raw SKILL.md at both
// URLs the one-liners fetch.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPS } from './apps.mjs'
import { SKILL_DIR, SKILL_NAME, REFERENCES_SITE_DIR, buildSkillZip, publishReferences, skillFiles } from './skill-package.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let checks = 0
let failures = 0
function ok(cond: unknown, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const listing = (zip: string) => execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
const member = (zip: string, entry: string) => {
  try { return execFileSync('unzip', ['-p', zip, entry], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return Buffer.alloc(0) }
}
const put = (dir: string, rel: string, body: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body) }

const work = mkdtempSync(join(tmpdir(), 'bento-skill-zip-rig-'))
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* temp */ } })

const shellName = APPS.slides.shell
const schema = join(root, 'schema/slides.json')
// The built shell when there is one (CI builds it before this step), else a
// stand-in: the zip only copies it, so its bytes are what is checked.
const builtShell = join(root, `slides/dist-single/${shellName}`)
const shell = existsSync(builtShell) ? builtShell : join(work, shellName)
if (shell !== builtShell) writeFileSync(shell, '<!doctype html><title>stand-in shell</title>')

// ---- 1. a fixture folder ----------------------------------------------------
console.log('fixture skill folder')
const fx = join(work, 'fixture')
put(fx, 'SKILL.md', '---\nname: bento-slides\n---\n# fixture\n')
put(fx, 'references/design-system.md', '# design system\n')
put(fx, 'references/motion.md', '# motion\n')
put(fx, 'references/notes.txt', 'not a reference page\n')
put(fx, 'scripts/bento.mjs', 'console.log(1)\n')
put(fx, 'scripts/lib/deck.mjs', 'export {}\n')
put(fx, 'scripts/evals/nested.json', '{}\n')
put(fx, 'evals/cases.json', '[]\n')
put(fx, 'evals/graders/g.mjs', 'export {}\n')
put(fx, '.DS_Store', 'junk')
put(fx, 'references/.draft.md', '# draft\n')
put(fx, 'assets/README.md', '# assets\n')
put(fx, 'assets/slides.json', '{"stale":true}\n')

const fxZip = join(work, 'out/fixture.zip')
mkdirSync(dirname(fxZip), { recursive: true })
const entries = buildSkillZip({ skillDir: fx, shell, schema, zipPath: fxZip })
const expected = [
  'SKILL.md', `assets/${shellName}`, 'assets/README.md', 'assets/slides.json',
  'references/design-system.md', 'references/motion.md', 'references/notes.txt',
  'scripts/bento.mjs', 'scripts/lib/deck.mjs',
].map((f) => `${SKILL_NAME}/${f}`).sort()
const fxList = listing(fxZip)
ok(JSON.stringify([...fxList].sort()) === JSON.stringify(expected), `the zip lists exactly the folder minus evals/ and dot-entries, plus the two assets (${fxList.length} entries)`)
if (JSON.stringify([...fxList].sort()) !== JSON.stringify(expected)) console.log(`        got: ${fxList.join(', ')}`)
ok(JSON.stringify(entries) === JSON.stringify(fxList), 'buildSkillZip returns the entries in the order the zip holds them')
ok(fxList.every((e) => e.startsWith(`${SKILL_NAME}/`)), `every entry sits inside ${SKILL_NAME}/ (skill hosts want folder-inside-zip)`)
ok(!fxList.some((e) => e.endsWith('/')), 'no directory entries (the shape the one-file zip had)')
ok(!fxList.some((e) => e.split('/').includes('evals')), 'no evals/ folder at any depth')
ok(!fxList.some((e) => e.split('/').some((s) => s.startsWith('.'))), 'no dot-files')
ok(sha(member(fxZip, `${SKILL_NAME}/assets/${shellName}`)) === sha(readFileSync(shell)), `assets/${shellName} is the shell, byte for byte`)
ok(sha(member(fxZip, `${SKILL_NAME}/assets/slides.json`)) === sha(readFileSync(schema)), 'assets/slides.json is schema/slides.json, byte for byte (a stale copy in the folder is replaced)')
ok(member(fxZip, `${SKILL_NAME}/references/motion.md`).toString() === '# motion\n', 'a folder file arrives unchanged')
ok(existsSync(join(fx, 'assets/slides.json')) && readFileSync(join(fx, 'assets/slides.json'), 'utf8') === '{"stale":true}\n', 'the source folder is not written to')
{
  // Built twice, the listing is the same: the order does not come from readdir.
  const again = buildSkillZip({ skillDir: fx, shell, schema, zipPath: fxZip })
  ok(JSON.stringify(again) === JSON.stringify(entries) && JSON.stringify(listing(fxZip)) === JSON.stringify(fxList), 'rebuilding over an existing zip gives the same listing (no stale entries kept)')
}

console.log('refusals')
const refuses = (fn: () => unknown, re: RegExp, msg: string) => {
  let err: Error | null = null
  try { fn() } catch (e) { err = e as Error }
  ok(err && re.test(err.message), `${msg} (got: ${err ? err.message.slice(0, 70) : 'NO ERROR'})`)
}
{
  const empty = join(work, 'empty-skill'); mkdirSync(empty)
  refuses(() => buildSkillZip({ skillDir: empty, shell, schema, zipPath: join(work, 'x.zip') }), /no SKILL\.md/, 'a folder without SKILL.md is refused')
  refuses(() => buildSkillZip({ skillDir: fx, shell: join(work, 'missing.html'), schema, zipPath: join(work, 'x.zip') }), /shell to bundle is missing/, 'a missing shell is refused')
  refuses(() => buildSkillZip({ skillDir: fx, shell, schema: join(work, 'missing.json'), zipPath: join(work, 'x.zip') }), /schema to bundle is missing/, 'a missing schema is refused')
  ok(!existsSync(join(work, 'x.zip')), 'a refusal writes no zip')
}

// ---- 2. the real skill folder -----------------------------------------------
console.log('the real skill folder')
const realDir = join(root, SKILL_DIR)
const realZip = join(work, 'out/bento-slides.zip')
const realEntries = buildSkillZip({ skillDir: realDir, shell, schema, zipPath: realZip })
const realList = listing(realZip)
// An expectation independent of the walk: what git tracks in the folder.
const tracked = execFileSync('git', ['ls-files', '--', SKILL_DIR], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean).map((f) => f.slice(SKILL_DIR.length + 1))
  .filter((f) => !f.split('/').includes('evals') && !f.split('/').some((s) => s.startsWith('.')))
ok(tracked.includes('SKILL.md'), 'git tracks SKILL.md in the skill folder')
for (const f of tracked) ok(realList.includes(`${SKILL_NAME}/${f}`), `the zip carries ${f}`)
for (const f of ['SKILL.md', `assets/${shellName}`, 'assets/slides.json']) ok(realList.includes(`${SKILL_NAME}/${f}`), `the zip carries ${f} (required)`)
const realExpected = [...new Set([...skillFiles(realDir), `assets/${shellName}`, 'assets/slides.json'])].map((f) => `${SKILL_NAME}/${f}`).sort()
ok(JSON.stringify([...realList].sort()) === JSON.stringify(realExpected), 'and nothing else')
ok(!realList.some((e) => e.split('/').includes('evals')), 'no evals/ in the real zip')
ok(JSON.stringify(realEntries) === JSON.stringify(realList), 'returned entries match the listing')
const size = statSync(realZip).size
console.log(`\n  bento-slides.zip  ${size} bytes  (shell: ${shell === builtShell ? 'the built one' : 'a stand-in'})`)
console.log(execFileSync('unzip', ['-l', realZip], { encoding: 'utf8' }).replace(/^/gm, '    '))

// ---- 3. the references, published ------------------------------------------
console.log('published references')
{
  const site = join(work, 'site')
  const names = publishReferences({ skillDir: fx, outDir: join(site, REFERENCES_SITE_DIR) })
  ok(JSON.stringify(names) === JSON.stringify(['design-system.md', 'motion.md']), `references/*.md are published, nothing else (${names.join(', ')})`)
  ok(names.every((n) => sha(readFileSync(join(site, REFERENCES_SITE_DIR, n))) === sha(readFileSync(join(fx, 'references', n)))), `each lands at /${REFERENCES_SITE_DIR}/<topic>.md byte for byte`)
  ok(!existsSync(join(site, REFERENCES_SITE_DIR, 'notes.txt')), 'a non-.md file in references/ is not published')
  ok(REFERENCES_SITE_DIR === 'slides/agents', 'the published folder sits beside /slides/agents.md')
  const bare = join(work, 'bare-skill'); put(bare, 'SKILL.md', '# bare\n')
  const site2 = join(work, 'site2')
  ok(publishReferences({ skillDir: bare, outDir: join(site2, REFERENCES_SITE_DIR) }).length === 0 && !existsSync(join(site2, REFERENCES_SITE_DIR)),
    'a skill without references publishes nothing and creates no folder (the site is unchanged)')
  const txtOnly = join(work, 'txt-skill'); put(txtOnly, 'SKILL.md', '# txt\n'); put(txtOnly, 'references/notes.txt', 'x\n')
  const site4 = join(work, 'site4')
  ok(publishReferences({ skillDir: txtOnly, outDir: join(site4, REFERENCES_SITE_DIR) }).length === 0 && !existsSync(join(site4, REFERENCES_SITE_DIR)),
    'a references/ folder with no .md publishes nothing and creates no folder')
  const realNames = publishReferences({ skillDir: realDir, outDir: join(work, 'site3', REFERENCES_SITE_DIR) })
  const realRefs = tracked.filter((f) => /^references\/[^/]+\.md$/.test(f)).map((f) => f.slice('references/'.length)).sort()
  ok(JSON.stringify(realNames) === JSON.stringify(realRefs), `the real folder publishes every tracked references/*.md (${realNames.length})`)
}

// ---- 4. release.mjs is wired to it -----------------------------------------
// A slides release cannot run here (it signs, and derives pins in a browser),
// so the wiring is read from the source.
console.log('release.mjs wiring')
{
  const rel = readFileSync(join(root, 'scripts/release.mjs'), 'utf8')
  ok(/import \{[^}]*\bbuildSkillZip\b[^}]*\bpublishReferences\b[^}]*\} from '\.\/skill-package\.mjs'/.test(rel), 'release.mjs imports buildSkillZip and publishReferences from skill-package.mjs')
  ok(/buildSkillZip\(\{[^)]*shell: stagedShell[^)]*schema: join\(root, 'schema\/slides\.json'\)[^)]*zipPath: join\(site, 'skills\/bento-slides\.zip'\)/s.test(rel),
    'the zip bundles the staged (signed) shell and schema/slides.json, at /skills/bento-slides.zip')
  ok(/publishReferences\(\{[^)]*outDir: join\(site, REFERENCES_SITE_DIR\)/s.test(rel), 'the references are published to REFERENCES_SITE_DIR')
  ok(!/'bento-slides\/SKILL\.md'\]/.test(rel), 'the one-file zip call is gone')
  ok(/cpSync\(skillSrc, join\(site, 'skills\/bento-slides\/SKILL\.md'\)\)/.test(rel) && /cpSync\(skillSrc, join\(site, 'skills\/bento-deck\/SKILL\.md'\)\)/.test(rel),
    'the raw SKILL.md is still published at both one-liner URLs')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

#!/usr/bin/env node
// Turn the Markdown issue drafts in this folder into GitHub issues with the gh CLI.
//
//   node issues/create-issues.mjs --dry-run          # parse everything, print the plan, create nothing
//   node issues/create-issues.mjs [--repo owner/name] # create them (needs `gh auth login` and Issues enabled)
//
// UNTESTED against GitHub: only --dry-run was exercised when this was written.
// Two passes: create every issue, then rewrite ID references (F-07, AI-12…) in
// each body to "#<number>" and post a "Depends on" line. Labels that do not
// exist are created by GitHub on first use. Re-running creates duplicates:
// the id → number map is saved to issues/.created.json; delete nothing by hand.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const repoArg = args.includes('--repo') ? ['--repo', args[args.indexOf('--repo') + 1]] : []

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!m) return null
  const meta = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    // a trailing "# comment" is stripped only outside quotes and brackets (titles may contain "#532")
    if (v.startsWith('"')) v = v.slice(1, v.lastIndexOf('"'))
    else if (v.startsWith('[')) v = v.slice(1, v.lastIndexOf(']')).split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
    else v = v.replace(/\s+#.*$/, '').trim()
    meta[kv[1]] = v
  }
  return { file, meta, body: m[2].trim() }
}

const files = []
for (const dir of readdirSync(root).sort()) {
  const p = join(root, dir)
  if (!statSync(p).isDirectory()) continue
  for (const f of readdirSync(p).sort()) if (f.endsWith('.md')) files.push(join(p, f))
}
const issues = files.map(parse).filter((x) => x && x.meta.id && x.meta.title)
const ids = new Set(issues.map((i) => i.meta.id))
let bad = 0
for (const i of issues) for (const d of [].concat(i.meta.depends_on || [])) if (!ids.has(d)) { console.error(`${i.meta.id}: depends_on unknown id ${d}`); bad++ }
console.log(`${issues.length} issue files, ${bad} bad references`)
if (dry) {
  for (const i of issues) console.log(`${i.meta.id.padEnd(6)} ${String(i.meta.priority || '').padEnd(3)} ${String(i.meta.size || '').padEnd(2)} ${i.meta.title}  [${[].concat(i.meta.labels || []).join(', ')}]`)
  process.exit(bad ? 1 : 0)
}

const mapFile = join(root, '.created.json')
const created = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {}
const gh = (a, input) => { const r = spawnSync('gh', a, { input, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || `gh ${a.join(' ')} failed`); return r.stdout.trim() }
for (const i of issues) {
  if (created[i.meta.id]) continue
  const labels = [].concat(i.meta.labels || []).flatMap((l) => ['--label', l])
  const url = gh(['issue', 'create', ...repoArg, '--title', `${i.meta.id} · ${i.meta.title}`, '--body-file', '-', ...labels], i.body)
  created[i.meta.id] = Number(url.split('/').pop())
  writeFileSync(mapFile, JSON.stringify(created, null, 1))
  console.log(`${i.meta.id} → #${created[i.meta.id]}`)
}
for (const i of issues) {
  const deps = [].concat(i.meta.depends_on || []).map((d) => `#${created[d]}`)
  const body = i.body.replace(/\b([A-Z]{1,2}-\d{2})\b/g, (s) => (created[s] && s !== i.meta.id ? `${s} (#${created[s]})` : s)) + (deps.length ? `\n\n**Depends on:** ${deps.join(', ')}` : '')
  gh(['issue', 'edit', String(created[i.meta.id]), ...repoArg, '--body-file', '-'], body)
}
console.log('done')

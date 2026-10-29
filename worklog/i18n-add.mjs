// Appends strings to the slides catalogs. Usage: node i18n-add.mjs <slides/src/i18n dir> <table.json>
// table.json: { "English key": { "de": "...", "ja": "...", ... }, ... } — every bundled locale required.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUNDLED = ['de', 'es', 'fr', 'it', 'pt', 'ja', 'zh-Hans', 'zh-Hant']
const [dir, tableFile] = process.argv.slice(2)
const table = JSON.parse(readFileSync(tableFile, 'utf8'))
const byLocale = {}
for (const [key, tr] of Object.entries(table)) {
  for (const loc of BUNDLED) if (!tr[loc]) throw new Error(`"${key}" has no ${loc}`)
  for (const [loc, v] of Object.entries(tr)) (byLocale[loc] ??= []).push([key, v])
}
let n = 0
for (const [loc, rows] of Object.entries(byLocale)) {
  const file = join(dir, BUNDLED.includes(loc) ? `${loc}.ts` : `packs/${loc}.ts`)
  const src = readFileSync(file, 'utf8')
  const end = src.lastIndexOf('\n}')
  if (end < 0) throw new Error(`no closing brace in ${file}`)
  const fresh = rows.filter(([k]) => !src.includes(JSON.stringify(k) + ':'))
  if (!fresh.length) continue
  writeFileSync(file, src.slice(0, end) + '\n' + fresh.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n') + src.slice(end))
  n++
}
console.log(`updated ${n} catalogs`)

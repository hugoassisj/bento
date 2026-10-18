#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Build bento.page/id/privacy and bento.page/id/delete — the bento/id privacy
// notice and the web account-deletion page (an app-store requirement: a person
// must be able to ask for deletion without the app).
//
//   node scripts/build-id-pages.mjs --facts <facts.json> [--out site] [--api https://id.bento.page]
//   node scripts/build-id-pages.mjs --preview <dir>      (placeholders left visible; never into site/)
//
// facts.json supplies what only the maintainer can state — the controller, the
// contact address, the effective date, the legal basis, rights wording and
// the tombstone retention. Every one is a __PLACEHOLDER__ in the source, and a
// normal build REFUSES to write a page that still contains one: a privacy
// notice that says "__CONTROLLER__" must never be published.
//
// The deletion page gets a Content-Security-Policy built from the SHA-256 of
// its exact inline script and style, with connect-src limited to the directory
// — the same discipline as the import page (scripts/build-import-page.mjs):
// replacer functions, never replacement strings, and a read-back check.
//
// Publishing is the maintainer's, when the directory is live.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FACT_KEYS = ['CONTROLLER', 'CONTACT_EMAIL', 'EFFECTIVE_DATE', 'LEGAL_BASIS', 'RIGHTS_JURISDICTION', 'CHILDREN', 'TOMBSTONE_RETENTION']
const PLACEHOLDER = /__[A-Z0-9_]+__/
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function build({ facts = {}, api = 'https://id.bento.page', preview = false } = {}) {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(api) && !(preview && /^http:\/\/localhost(:\d+)?$/.test(api))) {
    throw new Error(`--api must be an https origin (got ${api})`)
  }
  let privacy = readFileSync(join(root, 'site-src/id-privacy.html'), 'utf8')
  let del = readFileSync(join(root, 'site-src/id-delete.html'), 'utf8')
  for (const k of FACT_KEYS) {
    const v = facts[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || !v.trim() || PLACEHOLDER.test(v)) throw new Error(`fact ${k} must be non-empty text`)
    privacy = privacy.split(`__${k}__`).join(esc(v))
  }
  del = del.replace('__ID_API__', () => api)
  // the CSP covers the exact inline script and style
  const script = /<script>([\s\S]*?)<\/script>/.exec(del)?.[1]
  const style = /<style>([\s\S]*?)<\/style>/.exec(del)?.[1]
  if (script === undefined || style === undefined) throw new Error('id-delete.html lost its inline script or style')
  const csp = [
    "default-src 'none'", `script-src ${sha(script)}`, `style-src ${sha(style)}`,
    `connect-src ${api}`, "img-src 'self' data:", "base-uri 'none'", "form-action 'none'",
  ].join('; ')
  del = del.replace('<!--ID_DELETE_CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  if (del.split('http-equiv="Content-Security-Policy"').length !== 2) throw new Error('deletion page must carry exactly one CSP')
  if (/<script>([\s\S]*?)<\/script>/.exec(del)?.[1] !== script) throw new Error('inline script does not read back as the hashed one')
  if (/\bsrc=/.test(del) || /\bsrc=/.test(privacy)) throw new Error('no external resources on these pages')
  if (!preview) {
    for (const [name, html] of [['privacy', privacy], ['delete', del]]) {
      const left = html.match(PLACEHOLDER)
      if (left) throw new Error(`${name} page still contains ${left[0]} — refusing to build it for publishing`)
    }
  }
  return { privacy, delete: del, csp }
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const previewDir = arg('--preview')
  const out = previewDir ?? arg('--out') ?? join(root, 'site')
  if (previewDir && /(^|\/)site\/?$/.test(previewDir)) throw new Error('--preview never writes into site/')
  const facts = arg('--facts') ? JSON.parse(readFileSync(arg('--facts'), 'utf8')) : {}
  const pages = build({ facts, api: arg('--api') ?? 'https://id.bento.page', preview: !!previewDir })
  for (const [name, html] of [['privacy', pages.privacy], ['delete', pages.delete]]) {
    mkdirSync(join(out, 'id', name), { recursive: true })
    writeFileSync(join(out, 'id', name, 'index.html'), html)
  }
  console.log(`bento/id pages → ${join(out, 'id')}${previewDir ? ' (PREVIEW: placeholders visible)' : ''}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)) } catch (e) { console.error(String(e.message || e)); process.exit(1) }
}

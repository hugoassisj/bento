#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Fill bento.page's two association files and write them into the site.
//
//   node scripts/well-known.mjs [--apple-team TEAMID] [--play-sha256 AA:BB:…] [--out site]
//
// They let passkeys created for the relying party bento.page be used by the
// bento/home apps: Apple reads /.well-known/apple-app-site-association
// (`webcredentials`), Android reads /.well-known/assetlinks.json
// (`get_login_creds`). The templates in site-src/well-known/ carry
// PLACEHOLDERS — the Apple developer team id and the Play app-signing
// certificate fingerprint exist only once those accounts do.
//
// A placeholder must never be published: a wrong association file is worse
// than none, because the platform caches it. So this script writes ONLY the
// files whose value was given, validates the value's shape, and refuses any
// output that still contains a placeholder. Run with neither flag to check the
// templates and write nothing.
//
// Publishing is the maintainer's: this writes into the local `site/` staging
// directory, and scripts/publish-site.mjs is what goes live.
//
// Serving notes for whoever publishes:
//   · both files must be served over HTTPS at exactly these paths, with no
//     redirect; site/ already carries .nojekyll, so GitHub Pages serves the
//     dot-directory.
//   · apple-app-site-association has no extension, so GitHub Pages serves it
//     as application/octet-stream. Apple's CDN fetches it for the devices;
//     confirm it has picked the file up at
//     https://app-site-association.cdn-apple.com/a/v1/bento.page before
//     relying on it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATES = join(root, 'site-src/well-known')

export const FILES = {
  apple: { name: 'apple-app-site-association', placeholder: '__APPLE_TEAM_ID__', valid: /^[A-Z0-9]{10}$/ },
  play: { name: 'assetlinks.json', placeholder: '__PLAY_APP_SIGNING_SHA256__', valid: /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/ },
}
const ANY_PLACEHOLDER = /__[A-Z0-9_]+__/

/** Fill one template. Returns the text, or throws with a reason. */
export function fill(kind, value) {
  const f = FILES[kind]
  const tpl = readFileSync(join(TEMPLATES, f.name), 'utf8')
  JSON.parse(tpl) // the template itself must be valid JSON
  if (!tpl.includes(f.placeholder)) throw new Error(`${f.name}: template has no ${f.placeholder}`)
  if (!f.valid.test(value)) throw new Error(`${f.name}: "${value}" is not a valid ${kind === 'apple' ? 'Apple team id (10 characters, A–Z 0–9)' : 'SHA-256 fingerprint (32 uppercase hex bytes, colon-separated)'}`)
  const out = tpl.split(f.placeholder).join(value)
  if (ANY_PLACEHOLDER.test(out)) throw new Error(`${f.name}: a placeholder is still present after filling — refusing`)
  JSON.parse(out)
  return out
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const out = arg('--out') ?? join(root, 'site')
  const given = { apple: arg('--apple-team'), play: arg('--play-sha256')?.toUpperCase() }
  // always check every template, so a broken one is caught even when unused
  for (const f of Object.values(FILES)) {
    const tpl = readFileSync(join(TEMPLATES, f.name), 'utf8')
    JSON.parse(tpl)
    if (!tpl.includes(f.placeholder)) throw new Error(`${f.name}: template has no ${f.placeholder}`)
  }
  const wrote = []
  for (const kind of Object.keys(FILES)) {
    if (given[kind] === undefined) continue
    const text = fill(kind, given[kind])
    const dir = join(out, '.well-known')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, FILES[kind].name), text)
    wrote.push(FILES[kind].name)
  }
  console.log(wrote.length ? `wrote ${wrote.join(', ')} into ${join(out, '.well-known')}` : 'templates OK; nothing written (no values given)')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2)) } catch (e) { console.error(String(e.message || e)); process.exit(1) }
}

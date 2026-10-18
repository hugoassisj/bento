#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// An encrypted file must not reveal its contents in plaintext — not the body
// (that is the envelope's whole job), and not the TITLE either. The <title>
// written into the saved HTML, and the suggested download filename, both derive
// from doc.title, so a file whose body is ciphertext still announced its subject
// to anything that lists it (a file manager, a backup index, a mail client's
// attachment name). This rig pins that an encrypted save writes a GENERIC title
// (the app name) and a neutral filename, and that neither the title nor the body
// appears anywhere in the file outside the envelope.
//
// TWO LAYERS, because a DOM is not always present:
//   1. SOURCE GATE (always runs, including CI): serializeBody neutralises the
//      <title> under the same veto as the preview (previewAllowed(body)), and
//      suggestedFileName neutralises the filename under isBodySealed().
//      This is the regression guard CI enforces and the mutation target.
//   2. FILE SCAN (only where jsdom is installed — locally and in a browser, not
//      CI, matching scripts/test-type-preview.ts): actually serialize an
//      encrypted doc and scan the whole file for the title and body markers.
//
// Run: node scripts/test-enc-title.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let checks = 0, bad = 0
const ok = (cond: boolean, msg: string) => {
  checks++
  if (cond) console.log(`  ok    ${msg}`)
  else { bad++; console.log(`  FAIL  ${msg}`) }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ───────────────────────────────────────────── 1. SOURCE GATE (always runs)

console.log('\n— source gate: the encrypted-output neutralisation is in place —')
{
  const src = readFileSync(join(root, 'kernel/src/save.ts'), 'utf8')

  // The <title> write is gated on previewAllowed(body): the encrypted branch is
  // the app name, never doc.title. Reverting it (the mutation) drops the gate.
  ok(/titleEl\.textContent\s*=\s*previewAllowed\(body\)\s*\?[\s\S]{0,120}:\s*appConfig\(\)\.appName/.test(src),
     'serializeBody neutralises <title> when the output is encrypted (previewAllowed veto)')

  // The suggested filename is gated on isBodySealed(): neutral when the body is
  // sealed by a password OR the identity seal. isEncryptionActive() is only the
  // password, so gating on it named an identity-sealed file after its title.
  ok(/isBodySealed\(\)\s*\?\s*appConfig\(\)\.appName\s*:\s*doc\.title/.test(src),
     'suggestedFileName neutralises the download name when the body is sealed')
}

// ───────────────────────────────────────────── 2. FILE SCAN (needs a DOM)

const TITLE_MARK = 'ZZSECRETTITLEZZ'
const BODY_MARK = 'ZZSECRETBODYZZ'
const PREVIEW_MARK = 'ZZPREVIEWMARKERZZ'

const { JSDOM } = await (async () => {
  try { return await import('jsdom') } catch { return { JSDOM: null as never } }
})()

if (!JSDOM) {
  console.log('\n— skipped: jsdom is not installed —')
  console.log('  --    the whole-file scan below needs a DOM; the source gate above is what CI enforces,')
  console.log('  --    and the scan is verified locally and in a browser (see the PR notes).')
} else {
  const dom = new JSDOM(
    '<!doctype html><html><head><title>boot</title></head><body><div id="bento-splash"></div></body></html>',
  )
  const g = globalThis as Record<string, unknown>
  g.document = dom.window.document
  g.window = dom.window
  g.HTMLElement = dom.window.HTMLElement
  g.Node = dom.window.Node
  g.NodeFilter = dom.window.NodeFilter
  if (!g.performance) g.performance = { now: () => Date.now() }

  const save = await import('../kernel/src/save.ts')
  const { configureApp } = await import('../kernel/src/app.ts')

  // A doc carrying BOTH markers: the title (which used to reach <title>) and a
  // body field (which lives only inside #bento-doc / the envelope).
  const doc = () => ({ docId: 'ENC-RIG', title: TITLE_MARK, body: BODY_MARK }) as never

  // A preview provider that WOULD paint the body in plaintext — so we can prove
  // the encryption veto suppresses it, alongside the title fix.
  save.registerPreview(() => {
    const el = dom.window.document.createElement('div')
    el.textContent = PREVIEW_MARK
    return el as unknown as HTMLElement
  })

  // Every app runs the SAME kernel serialize path; loop the app names so the
  // neutral title is proven to be each app's own name for every app.
  for (const appName of ['bento/slides', 'bento/spaces', 'bento/type', 'bento/dash']) {
    configureApp({ appId: appName.replace('/', '-'), appName, manifestUrl: 'about:blank' })
    save.capturePristine()

    // PLAINTEXT: the real title and the body are expected in the file.
    save.setEncryptionPassword(null)
    const plain = await save.serializeAuto(doc())
    ok(plain.includes(TITLE_MARK), `[${appName}] plaintext save keeps the real title in the file`)
    ok(plain.includes(PREVIEW_MARK), `[${appName}] plaintext save carries the first-page preview (provider ran)`)
    ok(save.suggestedFileName(doc()).includes(TITLE_MARK),
       `[${appName}] plaintext filename derives from the title`)

    // ENCRYPTED: neither marker may appear anywhere outside the envelope.
    save.setEncryptionPassword('correct horse battery staple')
    const enc = await save.serializeAuto(doc())
    ok(!enc.includes(TITLE_MARK), `[${appName}] encrypted save: the title appears NOWHERE in the file`)
    ok(!enc.includes(BODY_MARK), `[${appName}] encrypted save: the body appears NOWHERE outside the envelope`)
    ok(!enc.includes(PREVIEW_MARK), `[${appName}] encrypted save: no plaintext first-page preview`)
    ok(/<title>[^<]*bento\/\w+[^<]*<\/title>/i.test(enc) || enc.includes(`<title>${appName}</title>`),
       `[${appName}] encrypted save: <title> is the generic app name`)
    ok(/"format"\s*:\s*"bento\/enc"/.test(enc), `[${appName}] encrypted save: the body is a bento/enc envelope`)
    ok(!save.suggestedFileName(doc()).toLowerCase().includes('secrettitle'),
       `[${appName}] encrypted filename does not carry the title`)

    save.setEncryptionPassword(null)
  }
}

console.log(`\n${checks - bad}/${checks} checks passed`)
process.exit(bad ? 1 : 0)

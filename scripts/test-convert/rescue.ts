// @bundle — reaches the kernel's save module and slides' model (extensionless imports)
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The rescue: a Bento file whose shell cannot boot, moved onto the latest
// signed shell of its own app, with the document block carried BYTE FOR BYTE.
// The case it exists for: a password-protected deck saved by a slides
// release whose loader cannot open encrypted files. Its owner cannot reach
// About → Update, because the file never boots.
//
// The encrypted fixture is real: the kernel's own encodeDocBody (PBKDF2 +
// AES-GCM), inside a real built slides shell. After the rescue, the rig
// decrypts the carried envelope with the original password, which proves
// nothing was re-encrypted or altered on the way.

import fs from 'node:fs'
import path from 'node:path'
import { spliceVerbatim, fileApp } from '../../convert/src/deliver.ts'
import { detect, optionsFor, CONVERSIONS, type Env } from '../../convert/src/pairs.ts'
import { setEncryptionPassword, encodeDocBody, parseEnvelope, decryptEnvelope } from '../../kernel/src/save.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

let root = process.cwd()
while (!fs.existsSync(path.join(root, 'scripts/test-convert')) && path.dirname(root) !== root) root = path.dirname(root)
const shellPath = path.join(root, 'slides/dist-single/Bento_Slides.bento.html')
const inCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS
if (!fs.existsSync(shellPath)) {
  if (inCI) { console.log('  FAIL  no built slides shell — cannot skip in CI'); process.exit(1) }
  console.log('  ⚠ SKIPPED — no built shell (cd slides && npm run build:single)'); process.exit(0)
}
const SHELL = fs.readFileSync(shellPath, 'utf8')
const OPEN = '<script type="application/bento+json" id="bento-doc">'
const CLOSE = '</' + 'script>'
const block = (html: string) => { const s = html.indexOf(OPEN) + OPEN.length; return html.slice(s, html.indexOf(CLOSE, s)) }
const withBlock = (shell: string, body: string, title = 'Board pack — Q3') => {
  const s = shell.indexOf(OPEN) + OPEN.length
  return (shell.slice(0, s) + body + shell.slice(shell.indexOf(CLOSE, s))).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
}
// "the latest shell": the same build, marked so the two are told apart
const LATEST = SHELL.replace('<head>', '<head><!-- latest -->')

const doc = { format: 'bento/slides', version: 1, title: 'Board pack — Q3', docId: 'd-rescue', size: { width: 1280, height: 720 },
  theme: { background: '#fff', color: '#111', accent: '#f60', fontFamily: 'Inter' }, slides: [{ id: 's1', background: '#fff', elements: [] }] }
setEncryptionPassword('correct horse')
const envelope = await encodeDocBody(doc as never)
setEncryptionPassword(null)
const body = '\n' + envelope + '\n'
const encrypted = withBlock(SHELL, body)

console.log('an encrypted deck, rescued')
{
  ok(parseEnvelope(envelope) !== null && !envelope.includes('Board pack'), 'the fixture is a real bento/enc envelope (the title is not in it in clear)')
  ok(fileApp(encrypted) === 'bento-slides', 'the file says which app it belongs to (its shell\'s generator)')
  const r = spliceVerbatim(LATEST, encrypted, 'bento-slides')
  ok(r.encrypted && r.html.includes('<!-- latest -->'), 'the result is the latest shell, and it knows the block is encrypted')
  ok(block(r.html) === body, 'the #bento-doc block is BYTE-IDENTICAL to the original')
  const back = await decryptEnvelope(parseEnvelope(block(r.html).trim())!, 'correct horse')
  ok(back !== null && JSON.parse(back).docId === 'd-rescue', 'the carried envelope still opens with the original password, to the same document')
  // the fixture's <title> is the deck's real name IN CLEAR, as builds before
  // 1.2.9 wrote it beside the ciphertext: it must not survive the rescue
  const shellTitle = /<title>[^<]*<\/title>/.exec(LATEST)![0]
  ok(r.html.includes(shellTitle) && !r.html.includes('Board pack'), `an encrypted file's plaintext title is NOT carried: the shell's neutral ${shellTitle} stays, and the old title is nowhere in the output`)
  ok(r.html.split(CLOSE).length === LATEST.split(CLOSE).length, 'the script-close count is the shell\'s')
}

console.log('byte for byte, even where re-serialising would change the bytes')
{
  // A Bento writer's block is usually compact JSON, which JSON.stringify
  // reproduces, so a re-serialising splice could hide behind it. These two
  // are not: a pretty-printed envelope (still a valid one), and a plain deck
  // whose text carries the \u003c escape every writer uses for '<'.
  const pretty = '\n' + JSON.stringify(JSON.parse(envelope), null, 2) + '\n'
  const r1 = spliceVerbatim(LATEST, withBlock(SHELL, pretty), 'bento-slides')
  ok(block(r1.html) === pretty, 'a pretty-printed envelope comes across exactly as written')
  const back = await decryptEnvelope(parseEnvelope(block(r1.html).trim())!, 'correct horse')
  ok(back !== null, 'and still opens with the password')
  const escaped = '\n' + JSON.stringify({ ...doc, title: 'a \u003c b' }).replace(/\\\\u003c/g, '\\u003c').replace(/</g, '\\u003c') + '\n'
  const r2 = spliceVerbatim(LATEST, withBlock(SHELL, escaped), 'bento-slides')
  ok(escaped.includes('\\u003c') && block(r2.html) === escaped, 'a plain deck\'s \\u003c escapes stay escapes (re-serialising would turn them into a raw <)')
}

console.log('refusals')
const refuses = (f: () => unknown, re: RegExp, msg: string) => {
  let m = ''
  try { f() } catch (e) { m = (e as Error).message }
  ok(re.test(m), `${msg} ("${m}")`)
}
refuses(() => spliceVerbatim(LATEST.replace('content="bento-slides"', 'content="bento-dash"'), encrypted, 'bento-slides'), /shell is bento-dash/, 'a shell of another app is refused')
refuses(() => spliceVerbatim(LATEST, encrypted.replace('content="bento-slides"', 'content="bento-dash"'), 'bento-slides'), /belongs to bento\/dash/, 'a file of another app is refused')
refuses(() => spliceVerbatim(LATEST, withBlock(SHELL, '{"format":"bento/slides","title":"<b>x</b>"}'), 'bento-slides'), /not in the form Bento writes/, 'a block with a raw < is not carried (Bento always escapes it)')
refuses(() => spliceVerbatim(LATEST, withBlock(SHELL, '\n'), 'bento-slides'), /empty document block/, 'an empty block (a fresh app) is refused')
refuses(() => spliceVerbatim(LATEST, withBlock(SHELL, '{nope'), 'bento-slides'), /not valid JSON/, 'a block that is not JSON is refused')
refuses(() => spliceVerbatim(LATEST, withBlock(SHELL, '{"format":"bento/spaces","pages":[]}'), 'bento-slides'), /document is bento\/spaces/, 'a document of another format is refused')

console.log('on the page: the conversion table')
{
  const asked: string[] = []
  const env: Env = { async shell(appId) { asked.push(appId ?? ''); return { version: '9.9.9', html: LATEST } } }
  const d = detect('Board pack.bento.html', new TextEncoder().encode(encrypted))
  const opts = optionsFor(d).filter((o) => o.ok).map((o) => o.conversion.id)
  ok(JSON.stringify(opts) === '["update-shell"]', `an encrypted file is offered exactly the rescue (${opts})`)
  const c = CONVERSIONS.find((x) => x.id === 'update-shell')!
  const r = await c.run(d, env)
  ok(asked.join() === 'bento-slides' && block(new TextDecoder().decode(r.bytes)) === body, 'it fetches the shell of the file\'s own app and carries the block byte for byte')
  ok(/still encrypted/.test(r.meta ?? '') && /no password was needed/.test(r.meta ?? ''), `it says so in words ("${r.meta}")`)
  const plain = detect('deck.bento.html', new TextEncoder().encode(withBlock(SHELL, '\n' + JSON.stringify(doc) + '\n')))
  ok(optionsFor(plain).filter((o) => o.ok).map((o) => o.conversion.id).includes('update-shell'), 'a plain deck is offered it too, beside PowerPoint')
  const old: Env = { async shell() { return { version: '1.2.8', html: LATEST } } }
  let mo = ''
  try { await c.run(d, old) } catch (e) { mo = (e as Error).message }
  ok(/1\.2\.8, which can’t open password-protected files/.test(mo), `an encrypted deck is NOT moved onto a release that can't open it ("${mo}")`)
  const r9 = await c.run(d, { async shell() { return { version: '1.2.9', html: LATEST } } })
  ok(block(new TextDecoder().decode(r9.bytes)) === body, 'onto 1.2.9 it is')
  const rp = await c.run(plain, old)
  ok(/<title>Board pack — Q3<\/title>/.test(new TextDecoder().decode(rp.bytes)), 'a plain deck\'s own title does come along')
  ok(rp.bytes.length > 0, 'a plain deck may still move onto 1.2.8 (only opening encrypted files was broken)')
  const nope: Env = { async shell() { throw new Error('could not reach the release server (404)') } }
  const sp = detect('notes.bento.html', new TextEncoder().encode(withBlock(SHELL.replace('content="bento-slides"', 'content="bento-spaces"'), '{"format":"bento/spaces","pages":[]}')))
  let m = ''
  try { await c.run(sp, nope) } catch (e) { m = (e as Error).message }
  ok(/no published release of bento\/spaces yet/.test(m), `an app with no published release says so plainly ("${m}")`)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)

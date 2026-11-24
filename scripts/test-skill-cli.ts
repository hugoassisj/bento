#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The skill's `bento` CLI (plugins/bento-slides/skills/bento-slides/scripts/bento.mjs),
// driven the way an agent drives it (AI-04).
//
//   node scripts/test-skill-cli.ts
//
// WHAT THIS PROVES. The skill folder is copied alone into an empty directory,
// with the app file and the schema in its assets/ as a release packs them, and
// every verb runs from there under a preload that makes any connection to a
// host other than loopback throw — no repo, no install, no network:
//   - new copies the bundled app file and refuses to overwrite;
//   - extract writes the document without assets or collab and never prints a
//     collab value; apply after extract reproduces the file byte for byte;
//     apply restores collab and docId, escapes <, keeps assets last on their
//     own line, refuses another docId, and fills a fresh app file;
//   - inspect reports the starter deck's 18 tokens, 7 palette slots and 3
//     components, and a brand deck's per-mode token values;
//   - lint flags an unknown element type, an invalid colour, a dangling
//     parentId, cream text on a cream slide, a token-bound literal that
//     differs from its token and a component copy without sig, and is silent
//     on the clean decks; lint --base reports nothing for a content-only edit
//     and the token for a token edit;
//   - render (a browser section: it needs Chrome and FAILS, not skips, in CI)
//     writes one PNG per shown slide and contact.png, honours --slides, and
//     with no Chrome exits 3 naming where it looked;
//   - every error message ends with the next action;
//   - scripts/bento-check.mjs is a thin wrapper over the skill's render.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { register } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
register('./lib/ts-resolve-hooks.mjs', import.meta.url)
const { starterDoc } = await import('../slides/src/starterdeck.ts')
const skillSrc = path.join(root, 'plugins/bento-slides/skills/bento-slides')
const shell = path.join(root, 'slides/dist-single/Bento_Slides.bento.html')
const inCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

if (!fs.existsSync(shell)) {
  const why = `no built shell at ${shell} (cd slides && npm run build:single)`
  if (inCI) { console.log(`  FAIL  ${why}`); process.exit(1) }
  console.log(`  ⚠ SKIPPED — ${why}`)
  process.exit(0)
}

// ---- an empty directory with only the skill folder ---------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bento-skill-cli-'))
const skill = path.join(tmp, 'skill', 'bento-slides')
fs.cpSync(skillSrc, skill, { recursive: true })
fs.mkdirSync(path.join(skill, 'assets'), { recursive: true })
fs.copyFileSync(shell, path.join(skill, 'assets/Bento_Slides.bento.html'))
fs.copyFileSync(path.join(root, 'schema/slides.json'), path.join(skill, 'assets/slides.json'))
const work = path.join(tmp, 'work')
fs.mkdirSync(work)
const cli = path.join(skill, 'scripts/bento.mjs')
// any connection that is not loopback throws, so "no network" is measured
const noNet = path.join(tmp, 'no-network.mjs')
fs.writeFileSync(noNet, [
  `import net from 'node:net'; import dns from 'node:dns'`,
  `const loop = (h) => !h || h === '127.0.0.1' || h === 'localhost' || h === '::1'`,
  `const connect = net.Socket.prototype.connect`,
  `net.Socket.prototype.connect = function (...a) { const o = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] }; if (!o.path && !loop(o.host)) throw new Error('NETWORK: ' + o.host); return connect.apply(this, a) }`,
  `const lookup = dns.lookup`,
  `dns.lookup = function (h, ...a) { if (!loop(h)) throw new Error('NETWORK: dns ' + h); return lookup.call(this, h, ...a) }`,
].join('\n'))

const run = (args: string[], env: Record<string, string | undefined> = {}) => {
  const r = spawnSync(process.execPath, ['--import', 'file://' + noNet, cli, ...args], { cwd: work, encoding: 'utf8', timeout: 180_000, env: { ...process.env, ...env } })
  const res = { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
  if (/NETWORK:/.test(res.out + res.err)) ok(false, `no network: ${args.join(' ')} tried to connect`)
  return res
}
const j = (s: string) => { try { return JSON.parse(s) } catch { return null } }
const errors: Array<{ args: string; text: string }> = []
const expectFail = (args: string[], env: Record<string, string | undefined> = {}) => {
  const r = run(args, env)
  errors.push({ args: args.join(' '), text: (r.err || r.out).trim() })
  return r
}

// the decks
const blockOf = (html: string) => { const at = html.indexOf(' id="bento-doc"'); const s = html.indexOf('>', at) + 1; return html.slice(s, html.indexOf('</' + 'script>', s)) }
const SECRETS = ['wROOM-SECRET-1', 'KEY-SECRET-2', 'PRIV-SECRET-3']
const starter: any = starterDoc()
{
  const { assets, ...rest } = starter
  const doc = { ...rest, collab: { v: 2, room: SECRETS[0], key: SECRETS[1], writerPriv: { kty: 'EC', d: SECRETS[2] }, on: false }, assets }
  const html = fs.readFileSync(shell, 'utf8')
  const at = html.indexOf(' id="bento-doc"'), s = html.indexOf('>', at) + 1, e = html.indexOf('</' + 'script>', s)
  const { assets: a2, ...head } = doc
  const text = JSON.stringify(head).slice(0, -1) + ',\n"assets":' + JSON.stringify(a2) + '}'
  fs.writeFileSync(path.join(work, 'starter.bento.html'), html.slice(0, s) + '\n' + text.replace(/</g, '\\u003c') + '\n' + html.slice(e))
}
const brandPath = path.join(root, 'scripts/fixtures/skill-cli/brand-deck.json')
const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'))
fs.copyFileSync(brandPath, path.join(work, 'brand.json'))
const writeDoc = (name: string, doc: unknown) => { fs.writeFileSync(path.join(work, name), JSON.stringify(doc)); return name }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

console.log('help\n')
{
  const h = run(['--help'])
  ok(h.code === 0 && ['new', 'extract', 'inspect', 'lint', 'render', 'apply'].every((v) => h.out.includes(v)), 'bento --help lists the six verbs')
  ok(['new', 'extract', 'inspect', 'lint', 'render', 'apply'].every((v) => { const r = run([v, '--help']); return r.code === 0 && r.out.startsWith(`bento ${v}`) }), 'every verb has --help')
}

console.log('\nnew\n')
{
  const r = run(['new', 'fresh.bento.html', '--json'])
  const o = j(r.out)
  ok(r.code === 0 && o?.ok === true, `new writes a deck (exit ${r.code})`)
  ok(fs.readFileSync(path.join(work, 'fresh.bento.html')).equals(fs.readFileSync(shell)), 'it is the bundled app file, byte for byte')
  const again = expectFail(['new', 'fresh.bento.html'])
  ok(again.code === 2 && /already exists/.test(again.err), 'it refuses to overwrite an existing file')
}

console.log('\nextract\n')
let extracted: any = null
{
  const r = run(['extract', 'starter.bento.html', '-o', 'doc.json'])
  ok(r.code === 0, `extract exits 0 (${r.code})`)
  ok(SECRETS.every((k) => !r.out.includes(k) && !r.err.includes(k)), 'its output never carries a collab value (regex over stdout and stderr for the fixture\'s key strings)')
  ok(/collab: v, room, key, writerPriv, on/.test(r.out), `it names the collab keys (${/collab: [^\n]*/.exec(r.out)?.[0]})`)
  ok(/assets \(7\): dots-ink \d+ B/.test(r.out), 'it names the assets with their sizes')
  const text = fs.readFileSync(path.join(work, 'doc.json'), 'utf8')
  extracted = JSON.parse(text)
  ok(!('collab' in extracted) && !('assets' in extracted) && SECRETS.every((k) => !text.includes(k)), 'the JSON has neither collab nor assets')
  ok(extracted.slides.length === 19 && extracted.docId === starter.docId, 'it is the whole document otherwise (19 slides, the docId)')
  const rj = run(['extract', 'starter.bento.html', '-o', 'doc2.json', '--json'])
  const o = j(rj.out)
  ok(o?.collab?.keys?.length === 5 && o.assets.length === 7 && SECRETS.every((k) => !rj.out.includes(k)), '--json carries key names and asset sizes, no values')
}

console.log('\napply\n')
{
  const before = fs.readFileSync(path.join(work, 'starter.bento.html'))
  const r = run(['apply', 'starter.bento.html', 'doc.json'])
  ok(r.code === 0 && fs.readFileSync(path.join(work, 'starter.bento.html')).equals(before), `apply after extract with no edit reproduces the file byte for byte (exit ${r.code})`)
  // the same through a real splice: a pretty-printed copy forces a rewrite
  const edited = clone(extracted)
  edited.title = 'Edited <deck> & more'
  edited.slides[0].notes = 'a < b'
  writeDoc('edited.json', edited)
  const r2 = run(['apply', 'starter.bento.html', 'edited.json', '-o', 'edited.bento.html', '--json'])
  const o2 = j(r2.out)
  const html = fs.readFileSync(path.join(work, 'edited.bento.html'), 'utf8')
  const block = blockOf(html)
  ok(r2.code === 0 && o2?.changed === true, `an edit is written (exit ${r2.code})`)
  ok(!block.includes('<') && block.includes('Edited \\u003cdeck>'), 'every < in the block is escaped')
  const doc = JSON.parse(block)
  ok(doc.collab?.key === SECRETS[1] && doc.collab?.writerPriv?.d === SECRETS[2] && doc.docId === starter.docId, 'collab and docId are restored from the file')
  ok(/,\n"assets":\{[^\n]*\}\}\s*$/.test(block) && Object.keys(doc).pop() === 'assets' && Object.keys(doc.assets).length === 7, 'assets are back, last, on a line of their own')
  const was = before.toString('utf8'), wasBlock = blockOf(was)
  ok(html.slice(0, html.indexOf(block)) === was.slice(0, was.indexOf(wasBlock)) && html.slice(html.indexOf(block) + block.length) === was.slice(was.indexOf(wasBlock) + wasBlock.length), 'nothing outside the block changed')
  const bad = clone(extracted)
  bad.docId = 'someone-else'
  writeDoc('otherid.json', bad)
  const r3 = expectFail(['apply', 'starter.bento.html', 'otherid.json'])
  ok(r3.code === 1 && /docId/.test(r3.err) && fs.readFileSync(path.join(work, 'starter.bento.html')).equals(before), `a different docId is refused and the file left alone (exit ${r3.code})`)
  const r4 = run(['apply', 'fresh.bento.html', 'brand.json'])
  const fresh = JSON.parse(blockOf(fs.readFileSync(path.join(work, 'fresh.bento.html'), 'utf8')))
  ok(r4.code === 0 && fresh.title === brand.title && !fresh.collab, `a fresh app file takes a full document (exit ${r4.code})`)
  // a compact document needs the deck's runtime: without Chrome, a clear refusal
  writeDoc('compact.json', { compact: true, slides: [{ elements: [{ type: 'text', x: 96, y: 80, w: 600, h: 80, html: 'Hi' }] }] })
  const r5 = expectFail(['apply', 'starter.bento.html', 'compact.json'], { BENTO_CHROME: 'none' })
  ok(r5.code === 3 && /compact/.test(r5.err) && /Chrome/.test(r5.err) && fs.readFileSync(path.join(work, 'starter.bento.html')).equals(before), `a compact document without Chrome is refused, exit 3, file untouched (${r5.code})`)
}

console.log('\ninspect\n')
{
  const r = run(['inspect', 'starter.bento.html', '--json'])
  const o = j(r.out)
  ok(r.code === 0 && o?.tokens?.count === 18, `the starter deck has 18 tokens (${o?.tokens?.count})`)
  ok(o?.theme?.slots?.map((s: any) => s.slot).join(',') === 'bg1,tx1,bg2,tx2,accent1,accent2,accent3', `…its 7 palette slots (${o?.theme?.slots?.map((s: any) => s.slot).join(',')})`)
  ok(o?.components?.map((c: any) => c.name).sort().join(',') === 'Button,Feature card,Key hint' && o.components.every((c: any) => c.copies > 0), `…its 3 components with their copies (${o?.components?.map((c: any) => `${c.name}×${c.copies}`).join(', ')})`)
  ok(o?.binding?.bound > 0 && o.binding.share > 0.5, `…and that most of its style values are bound (${o?.binding?.bound} of ${o?.binding?.styleValues})`)
  ok(o?.slides?.length === 19 && o.slides.filter((s: any) => s.stateOf).length === 4, 'the slide list marks the 4 state slides')
  ok(o?.fonts?.builtin?.length === 2 && o.fonts.missing.length === 0, 'fonts: the two built-in faces, none missing')
  const b = j(run(['inspect', 'brand.json', '--json']).out)
  const surface = b?.tokens?.byType?.color?.find((t: any) => t.name === 'color.surface')
  ok(b?.tokens?.modes?.join(',') === 'light,dark' && surface?.values?.dark === '#26303D', 'a brand deck\'s tokens carry their value per mode')
  ok(b?.layouts?.length === 1 && b.layouts[0].roles.join(',') === 'title,body', 'and its own layouts with their roles')
  const human = run(['inspect', 'starter.bento.html'])
  ok(human.out.split('\n').length < 80 && /tokens \(18\)/.test(human.out), `the human summary is bounded (${human.out.split('\n').length} lines)`)
}

console.log('\nlint\n')
{
  const clean = run(['lint', 'brand.json', '--json'])
  ok(clean.code === 0 && j(clean.out)?.findings?.length === 0, `the brand deck lints clean (${j(clean.out)?.findings?.map((f: any) => f.code).join(',')})`)
  const st = j(run(['lint', 'doc.json', '--json']).out)
  ok(st?.counts?.error === 0, `the starter deck has no lint errors (${st?.findings?.filter((f: any) => f.severity === 'error').map((f: any) => f.code).join(',')})`)
  // the starter is a fixed point of the app's derive pass: every palette and
  // token literal equals what its reference resolves to there, so a stale
  // finding here would mean lint's palette maths differ from the app's
  ok(!st?.findings?.some((f: any) => f.code === 'theme-ref-stale' || f.code === 'token-stale'), 'lint resolves the starter\'s palette and token references as the app does: no stale finding')
  const cases: Array<[string, (d: any) => void, string]> = [
    ['unknown element type', (d) => { d.slides[0].elements.push({ ...d.slides[0].elements[0], id: 'odd', type: 'sticker' }) }, 'unknown-element-type'],
    ['invalid colour', (d) => { d.slides[1].elements[2].fill = 'reddish' }, 'invalid-colour'],
    ['dangling parentId', (d) => { d.slides[0].elements[0].parentId = 'no-such-frame' }, 'dangling-parent'],
    ['cream text on a cream slide', (d) => { const t = d.slides[0].elements[0]; t.color = '#F3EEDF'; delete t.themeRefs }, 'low-contrast'],
    ['a token-bound literal that differs from its token', (d) => { d.slides[0].elements[1].fill = '#EEEEEE' }, 'token-stale'],
    ['a copy without sig', (d) => { delete d.slides[1].elements[0].component.sig }, 'copy-without-sig'],
  ]
  for (const [what, mutate, code] of cases) {
    const d = clone(brand)
    mutate(d)
    const name = writeDoc(`lint-${code}.json`, d)
    const r = run(['lint', name, '--json'])
    const o = j(r.out)
    const hit = o?.findings?.filter((f: any) => f.code === code) ?? []
    ok(hit.length > 0 && hit.every((f: any) => f.slide && f.message), `lint flags ${what} (${code}: ${hit[0]?.message?.slice(0, 70)}…)`)
  }
  const ut = j(run(['lint', 'lint-unknown-element-type.json', '--json']).out)
  ok(run(['lint', 'lint-unknown-element-type.json']).code === 1 && ut?.findings?.find((f: any) => f.code === 'unknown-element-type')?.element === 'odd', 'an error exits 1 and names the element')
  const dup = clone(brand)
  dup.slides[0].elements[2].id = 'title'
  dup.slides[0].elements[2].foo = 1
  const dj = j(run(['lint', writeDoc('lint-dup.json', dup), '--json']).out)
  const dupF = dj?.findings?.find((f: any) => f.code === 'duplicate-id')
  const unk = dj?.findings?.find((f: any) => f.code === 'unknown-key')
  ok(dupF?.message === 'Two elements on this slide share the id "title" — selection, morph and comment anchors all key off it.', 'duplicate-id carries the app\'s own message')
  ok(unk?.message === '"foo" is not a property of a text element — it is ignored, so whatever it was meant to do will not happen.', 'unknown-key carries the app\'s own message')

  console.log('\nlint --base\n')
  const content = clone(brand)
  content.slides[0].elements[0].html = 'Quarterly review, revised'
  content.slides[1].elements[1].html = 'Churn down 4%'
  const rc = run(['lint', writeDoc('content.json', content), '--base', 'brand.json', '--json'])
  const oc = j(rc.out)
  ok(rc.code === 0 && oc?.designSystem?.changes?.length === 0 && oc.designSystem.introducedLiterals === 0, `a content-only edit: empty design-system diff, exit 0 (${JSON.stringify(oc?.designSystem?.changes)})`)
  const tok = clone(brand)
  tok.theme.tokens.set['color.surface'].values.light = '#FAFAFA'
  const rt = run(['lint', writeDoc('token.json', tok), '--base', 'brand.json', '--json'])
  const ot = j(rt.out)
  ok(rt.code === 1 && ot?.designSystem?.changes?.some((c: any) => c.area === 'tokens' && c.name === 'color.surface' && c.change === 'changed'), `a token value change: reported, exit 1 (${JSON.stringify(ot?.designSystem?.changes)})`)
  ok(run(['lint', 'token.json', '--base', 'brand.json', '--allow-design-change']).code === 0, '--allow-design-change accepts an asked-for change')
  const lit = clone(brand)
  lit.slides[1].elements.push({ ...lit.slides[1].elements[2], id: 'new-bar', y: 640, fill: '#123456', themeRefs: undefined })
  const ol = j(run(['lint', writeDoc('literal.json', lit), '--base', 'brand.json', '--json']).out)
  ok(ol?.designSystem?.introduced?.some((v: any) => v.element === 'new-bar' && v.key === 'fill' && v.value === '#123456'), 'an unbound literal the edit introduced is listed')
  const comp = clone(brand)
  comp.slides[0].elements[1].radius = 4
  comp.slides[0].elements[1].themeRefs = { fill: '$color.surface' }
  ok(j(run(['lint', writeDoc('comp.json', comp), '--base', 'brand.json', '--json']).out)?.designSystem?.changes?.some((c: any) => c.area === 'components' && c.name === 'cmp-stat'), 'a change to a component main is a design change')
}

console.log('\nerrors end with the next action\n')
{
  expectFail(['extract', 'nope.bento.html'])
  expectFail(['inspect', 'missing.json'])
  fs.writeFileSync(path.join(work, 'broken.json'), '{ "slides": [ ')
  expectFail(['lint', 'broken.json'])
  expectFail(['frobnicate'])
  expectFail(['render', 'starter.bento.html', '--slides', 'x'])
  expectFail(['apply', 'starter.bento.html', 'starter.bento.html'])
  fs.writeFileSync(path.join(work, 'plain.html'), '<html><body>hi</body></html>')
  expectFail(['inspect', 'plain.html'])
  expectFail(['render', 'starter.bento.html'], { BENTO_CHROME: 'none' })
  for (const e of errors) {
    const last = e.text.split('\n').filter(Boolean).pop() ?? ''
    ok(/Next: \S.*[.)`]$/.test(last), `${e.args} → ${JSON.stringify(last.slice(-90))}`)
  }
}

console.log('\nrender (browser)\n')
{
  const none = run(['render', 'starter.bento.html', '--png', 'none-png'], { BENTO_CHROME: 'none' })
  ok(none.code === 3 && none.err.includes('/usr/bin/google-chrome') && none.err.includes('ms-playwright') && none.err.includes('/opt/pw-browsers'), `with no Chrome: exit 3, naming where it looks (exit ${none.code})`)
  const chromeFound = run(['render', 'starter.bento.html', '--json', '--slides', '1', '--png', 'probe-png'])
  const haveChrome = chromeFound.code !== 3
  if (!haveChrome) {
    if (inCI) ok(false, 'Chrome is needed for the render section, and a browser rig cannot skip in CI')
    else console.log('  ⚠ SKIPPED the render section — no Chrome (set BENTO_CHROME)')
  } else {
    const r = run(['render', 'starter.bento.html', '--png', 'png', '--json'])
    const o = j(r.out)
    const pngs = fs.existsSync(path.join(work, 'png')) ? fs.readdirSync(path.join(work, 'png')).filter((f) => /^page-\d\d\.png$/.test(f)) : []
    ok(r.code === 0 && o?.shown === 15 && pngs.length === 15, `render writes one PNG per shown slide (${pngs.length} of ${o?.shown}, exit ${r.code})`)
    ok(fs.existsSync(path.join(work, 'png/contact.png')), 'and contact.png')
    const dims = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
    const p1 = fs.readFileSync(path.join(work, 'png/page-01.png'))
    ok(dims(p1).w === 1280 && dims(p1).h === 720 && p1.length > 20_000, `page-01.png is 1280×720 and not blank (${p1.length} bytes)`)
    ok(o?.renderer === 'window.bento.render' && Array.isArray(o?.findings) && o.counts?.error === 0, 'pixels from the deck\'s own window.bento.render(); validate() findings relayed')
    const rs = run(['render', 'starter.bento.html', '--png', 'some', '--slides', '2,4-5'])
    const some = fs.readdirSync(path.join(work, 'some')).sort()
    ok(rs.code === 0 && some.join(',') === 'contact.png,page-02.png,page-04.png,page-05.png', `--slides 2,4-5 writes those pages (${some.join(',')})`)
    const rb = run(['render', 'brand.json', '--json'])
    ok(rb.code === 0 && j(rb.out)?.slides === 3, 'a document JSON renders in the bundled app file')
    // a compact document through the deck's runtime
    const ra = run(['apply', 'starter.bento.html', 'compact.json', '-o', 'from-compact.bento.html', '--json'])
    const oa = j(ra.out)
    const fc = JSON.parse(blockOf(fs.readFileSync(path.join(work, 'from-compact.bento.html'), 'utf8')))
    ok(ra.code === 0 && oa?.expanded > 0 && fc.slides.length === 1 && fc.slides[0].elements[0].fontFamily && fc.docId === starter.docId && fc.collab?.key === SECRETS[1],
      `apply expands a compact document through the deck's own runtime and keeps the file's identity (${oa?.expanded} fields filled)`)
  }
}

console.log('\nbento check is a thin wrapper\n')
{
  const src = fs.readFileSync(path.join(root, 'scripts/bento-check.mjs'), 'utf8')
  ok(/from '\.\.\/plugins\/bento-slides\/skills\/bento-slides\/scripts\/lib\/render\.mjs'/.test(src) && !src.includes('createServer') && !src.includes('spawn(chrome'),
    'scripts/bento-check.mjs runs the skill\'s render: no server or Chrome launch of its own')
  const own = fs.readdirSync(path.join(skillSrc, 'scripts'), { recursive: true }) as string[]
  const imports = own.filter((f) => f.endsWith('.mjs')).flatMap((f) => [...fs.readFileSync(path.join(skillSrc, 'scripts', f), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]))
  ok(imports.every((m) => m.startsWith('node:') || m.startsWith('./')), `the skill's scripts import only node: and their own files (${[...new Set(imports.filter((m) => !m.startsWith('node:')))].join(', ')})`)
  ok(!fs.existsSync(path.join(root, 'plugins/bento-slides/bin')), 'no bin/ directory in the plugin')
}

fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

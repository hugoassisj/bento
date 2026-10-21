// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// GATE 1: is this file's runtime a genuine Bento release? (bento/connect K5,
// security §13–§18, §36, and the 2026-10-21 grammar ruling.) ONE shared
// implementation for every JavaScript host (the extension, the hosted runtime,
// release tooling). Native hosts (Swift, Kotlin, Rust) port it and must agree
// with it on every row of the conformance corpus in home/fixtures/gate1/.
//
// Two paths, by what the host can do:
//   - verifyServed(): for a host that SERVES the bytes it verified (iOS,
//     Android, desktop, the hosted runtime). It checks the file against the
//     signed release history: ONE release must match EVERY code block, under
//     the grammar below. It answers with the CSP to serve the file under. This
//     is the PRIMARY path, immune to serializer drift (security §17).
//   - verifyStrict(): the file:// fallback, where no CSP can be set. An exact
//     string check against a release's saved skeleton (vault's strict verifier,
//     signed off in security §15). It can only ever hold a RESULT: identity is
//     never exposed in a bare file:// tab (security §16).
//
// "Unknown" is never "tampered": it means "not provably one of ours", and the
// host shows the document without identity, or offers an update. It never
// borrows a pinned CSP for a file it couldn't match.
//
// Pure: no DOM, and WebCrypto for hashing, so it runs in a page, a worker, an
// extension and node alike.

/** A release's pins, as signed into its manifest and its history entry. */
export interface Pins {
  v: 1
  /** sha256 HEX of each code block's text; remover null for releases before the preview */
  blocks: { 'bento-rt': string; 'bento-rt-css': string; loader: string; remover: string | null }
  /** CSP form: 'sha256-' + BASE64 of the loader, then the remover */
  scriptSrc: string[]
}
export interface HistoryEntry { version: string; sha256: string; at: string; pins: Pins }
export interface History { app: string; v: 1; releases: HistoryEntry[] }

// --- the scanner ---------------------------------------------------------------

export interface Block {
  tag: 'script' | 'style'
  attrs: string
  /** the raw text, which ends at the first `</script` / `</style` in any case, as the HTML tokenizer ends it */
  text: string
  /** offset of the text's first character in the file */
  start: number
  type: string | null
  id: string | null
  src: string | null
  preview: boolean
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?(?=\\s|$)`, 'i').exec(attrs)
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? ''
}

/** Every <script> and <style> element in the file, with its raw text. */
export function scanBlocks(html: string): Block[] {
  const out: Block[] = []
  const lower = html.toLowerCase()
  const open = /<(script|style)\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = open.exec(html))) {
    const tag = m[1].toLowerCase() as 'script' | 'style'
    const start = m.index + m[0].length
    const close = lower.indexOf(`</${tag}`, start)
    if (close < 0) throw new Error(`gate1: unterminated <${tag}> at ${m.index}`)
    const attrs = m[2]
    out.push({
      tag, attrs, text: html.slice(start, close), start,
      type: attr(attrs, 'type'), id: attr(attrs, 'id'), src: attr(attrs, 'src'),
      preview: attr(attrs, 'data-bento-preview') !== null,
    })
    open.lastIndex = close
  }
  return out
}

// --- the grammar (security, 2026-10-21) ------------------------------------------

/**
 * A <script> is inert ONLY if its type is exactly one of the data types Bento
 * writes. Everything else is executable: no type, a JavaScript type, "module",
 * an unknown type, a differently cased data type, and ANY src=. An executable
 * script must be exactly the pinned loader or remover by hash, or the file is
 * UNKNOWN. An allowlist, so a type browsers start running tomorrow can't pass as
 * data.
 */
export const DATA_TYPES: ReadonlySet<string> = new Set(['application/bento+json', 'application/bento+lang', 'bento/deflate-b64', 'bento/deflate-b86'])
export const isDataScript = (b: Block): boolean => b.tag === 'script' && b.src === null && b.type !== null && DATA_TYPES.has(b.type)

/** Every script that isn't one of Bento's data blocks: each must be the pinned loader or remover. */
export const executableScripts = (blocks: Block[]): Block[] => blocks.filter((b) => b.tag === 'script' && !isDataScript(b))

/**
 * Markup a genuine Bento file never carries, anywhere outside a script or style
 * element's own text:
 * - <iframe>, <object>, <embed> or <base>;
 * - a <meta> refresh or CSP;
 * - any on*= attribute;
 * - a comment or <style> holding a <script>;
 * - a data block containing "<".
 * Bento's data never contains "<": the JSON and language packs escape it, and
 * the b64/b86 alphabets exclude it. That also closes the "<!--<script"
 * double-escape state, where a later close tag doesn't end the element.
 * Returns the problems; [] = none.
 */
export function markupProblems(html: string): string[] {
  const problems: string[] = []
  const lower = html.toLowerCase()
  let i = 0
  while ((i = html.indexOf('<', i)) !== -1) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4)
      const body = lower.slice(i + 4, end < 0 ? html.length : end)
      if (body.includes('<script')) problems.push('a comment holds a <script>')
      if (end < 0) { problems.push('an unterminated comment'); break }
      i = end + 3; continue
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, i + 64))
    if (!m) { i++; continue }
    const name = m[1].toLowerCase()
    // the tag's attributes, quote-aware, up to its closing '>'
    let j = i + m[0].length, q: string | null = null
    for (; j < html.length; j++) {
      const c = html[j]
      if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c; else if (c === '>') break
    }
    const attrs = html.slice(i + m[0].length, j)
    if (['iframe', 'object', 'embed', 'base'].includes(name)) problems.push(`a <${name}>`)
    if (name === 'meta' && /http-equiv\s*=\s*["']?\s*(refresh|content-security-policy)/i.test(attrs)) problems.push('a <meta> refresh or CSP')
    if (/(^|[\s"'/])on[a-z0-9_-]*\s*=/i.test(attrs)) problems.push(`an on*= attribute on <${name}>`)
    if (name === 'script' || name === 'style') {
      const close = lower.indexOf(`</${name}`, j)
      if (close < 0) { problems.push(`an unterminated <${name}>`); break }
      // inert to a browser, but a scanner that doesn't special-case <style>
      // would count it: refuse, so every host's scanner reaches the same verdict
      if (name === 'style' && lower.slice(j, close).includes('<script')) problems.push('a <style> holds a <script>')
      i = close + 2; continue
    }
    i = j + 1
  }
  for (const b of scanBlocks(html)) if (isDataScript(b) && b.text.includes('<')) problems.push(`the ${b.type} block contains "<"`)
  return problems
}

// --- hashing ---------------------------------------------------------------------

const enc = new TextEncoder()
async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s) as BufferSource))
}
/** sha256 HEX of a string's UTF-8 bytes: the encoding of every `blocks` pin. */
export async function sha256hex(s: string): Promise<string> {
  return Array.from(await digest(s), (b) => b.toString(16).padStart(2, '0')).join('')
}
/** 'sha256-' + BASE64: the CSP encoding of every `scriptSrc` pin. Never compare it to a hex pin. */
export async function cspHash(s: string): Promise<string> {
  let bin = ''
  for (const b of await digest(s)) bin += String.fromCharCode(b)
  return `sha256-${btoa(bin)}`
}

const CODE_IDS = ['bento-rt', 'bento-rt-css'] as const

/**
 * Check a file against ONE release's pins: no foreign markup, exactly one block
 * per code id with a matching hash, and every executable script exactly the
 * pinned loader or remover. Returns the problems; [] = this release's file.
 */
export async function checkAgainstPins(html: string, pins: Pins): Promise<string[]> {
  const problems = [...markupProblems(html)]
  const blocks = scanBlocks(html)
  for (const id of CODE_IDS) {
    const found = blocks.filter((b) => b.id === id)
    if (found.length !== 1) problems.push(`${found.length} #${id} blocks (exactly one expected)`)
    else if ((await sha256hex(found[0].text)) !== pins.blocks[id]) problems.push(`#${id} does not match`)
  }
  const exec = executableScripts(blocks)
  const hashes = await Promise.all(exec.map((s) => sha256hex(s.text)))
  const allowed = new Set([pins.blocks.loader, pins.blocks.remover].filter(Boolean))
  exec.forEach((s, k) => {
    if (s.src !== null || !allowed.has(hashes[k])) problems.push(`an executable script that is neither the pinned loader nor the remover (${s.src !== null ? 'src=' + s.src : s.text.length + 'B'})`)
  })
  const n = (h: string | null) => hashes.filter((x) => x === h).length
  if (n(pins.blocks.loader) === 0) problems.push('no pinned loader')
  if (n(pins.blocks.loader) > 1) problems.push('more than one loader')
  if (pins.blocks.remover && n(pins.blocks.remover) > 1) problems.push('more than one remover')
  return problems
}

// --- the release history --------------------------------------------------------

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
export function cmpVersion(a: string, b: string): number {
  const x = SEMVER.exec(a), y = SEMVER.exec(b)
  if (!x || !y) throw new Error(`gate1: not a version: ${!x ? a : b}`)
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d }
  return 0
}
const entryOk = (e: HistoryEntry | undefined): e is HistoryEntry => !!e && typeof e.version === 'string' && SEMVER.test(e.version) &&
  /^[0-9a-f]{64}$/.test(e.sha256 ?? '') && typeof e.at === 'string' && e.pins?.v === 1 && typeof e.pins.blocks === 'object'

/** A history payload's shape problems; [] = well-formed (versions unique, newest first). */
export function historyProblems(h: History | null | undefined): string[] {
  const p: string[] = []
  if (!h || h.v !== 1) p.push(`version ${h?.v} (expected 1)`)
  if (typeof h?.app !== 'string' || !h.app) p.push('no app')
  if (!Array.isArray(h?.releases)) { p.push('no releases'); return p }
  const seen = new Set<string>()
  h.releases.forEach((e, i) => {
    if (!entryOk(e)) { p.push(`entry ${i} is malformed`); return }
    if (seen.has(e.version)) p.push(`version ${e.version} appears twice`)
    seen.add(e.version)
    const prev = h.releases[i - 1]
    if (i > 0 && entryOk(prev) && cmpVersion(prev.version, e.version) <= 0) p.push(`entries are not newest-first at ${e.version}`)
  })
  return p
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A HOST's acceptance of an incoming, already signature-verified history, given
 * the newest it holds: ANTI-ROLLBACK. It refuses one that lacks a held entry,
 * changes one, or rolls the newest version back. (With a well-formed history
 * the last is implied by the first, and is kept as defence in depth.)
 */
export function acceptHistory(held: History | null, incoming: History, app: string): { ok: true } | { ok: false; reason: string } {
  const problems = historyProblems(incoming)
  if (problems.length) return { ok: false, reason: `malformed: ${problems[0]}` }
  if (incoming.app !== app) return { ok: false, reason: `for ${incoming.app}, not ${app}` }
  if (!held) return { ok: true }
  if (!incoming.releases.length || (held.releases.length && cmpVersion(incoming.releases[0].version, held.releases[0].version) < 0)) {
    return { ok: false, reason: 'rollback: its newest release is older than the newest already held' }
  }
  for (const e of held.releases) {
    const there = incoming.releases.find((x) => x.version === e.version)
    if (!there) return { ok: false, reason: `rollback: it lacks ${e.version}, which is already held` }
    if (!same(there, e)) return { ok: false, reason: `${e.version} changed: a history never changes an entry` }
  }
  return { ok: true }
}

/** The ONE entry matching every block of the file, or null (none, or more than one: UNKNOWN). */
export async function matchRelease(history: History, html: string): Promise<HistoryEntry | null> {
  const rt = scanBlocks(html).filter((b) => b.id === 'bento-rt')
  if (rt.length !== 1) return null
  const rtHash = await sha256hex(rt[0].text)
  const full: HistoryEntry[] = []
  for (const e of history.releases.filter((x) => x.pins.blocks['bento-rt'] === rtHash)) {
    if ((await checkAgainstPins(html, e.pins)).length === 0) full.push(e)
  }
  return full.length === 1 ? full[0] : null
}

// --- the served path ----------------------------------------------------------------

/**
 * The CSP a host serves a verified document under (security §17/§18, §36a):
 * scripts hash-pinned to the release's loader and remover, plus blob: for the
 * runtime the loader imports; styles 'unsafe-inline' (the sanitizer is the style
 * control); everything else closed. `frameAncestors` is the host's own value.
 */
export function hostPolicy(pins: Pins, frameAncestors = "'none'"): string {
  return [
    "default-src 'none'",
    `script-src ${pins.scriptSrc.map((h) => `'${h}'`).join(' ')} blob:`,
    "style-src 'unsafe-inline'",
    'img-src data: blob: https:',
    'media-src data: blob: https:',
    'font-src data: blob:',
    'connect-src https://bento.page https://sync.bento.page wss://sync.bento.page',
    'frame-src https:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ')
}

export type ServedVerdict =
  | { verdict: 'genuine'; release: HistoryEntry; csp: string }
  | { verdict: 'unknown'; reason: string }

/**
 * THE served-path gate: is this file one genuine release's? The history must
 * already have passed the release-key signature check and acceptHistory().
 */
export async function verifyServed(html: string, history: History, opts: { frameAncestors?: string } = {}): Promise<ServedVerdict> {
  const problems = historyProblems(history)
  if (problems.length) return { verdict: 'unknown', reason: `the history is malformed: ${problems[0]}` }
  const release = await matchRelease(history, html)
  if (!release) {
    const markup = markupProblems(html)
    return { verdict: 'unknown', reason: markup.length ? markup[0] : 'no single release matches every block' }
  }
  return { verdict: 'genuine', release, csp: hostPolicy(release.pins, opts.frameAncestors) }
}

// --- the strict file:// fallback (vault's strict verifier; security §15) ------------

const CLOSE = '</' + 'script>'
const DOC_ANCHOR = ' id="bento-doc"'
const DOC_OPEN = '<script type="application/bento+json" id="bento-doc">'

/** What the strict check compares against, taken from a GENUINE saved file of a release. */
export interface StrictExpected {
  /** the saved file with its variable spans collapsed to placeholders */
  skeleton: string
  /** the exact preview remover that release writes (with its tags), or null before previews */
  remover: string | null
}

function collapse(h: string, remover: string | null): string | { refuse: string } {
  const count = (n: string) => h.split(n).length - 1
  if (count(DOC_ANCHOR) !== 1) return { refuse: `doc anchor count ${count(DOC_ANCHOR)}` }
  const di = h.indexOf(DOC_ANCHOR), dOpen = h.lastIndexOf('<', di), dTagEnd = h.indexOf('>', di) + 1, dEnd = h.indexOf(CLOSE, di) + CLOSE.length
  if (h.slice(dOpen, dTagEnd) !== DOC_OPEN) return { refuse: 'doc block opening tag altered' }
  if (dEnd < CLOSE.length || h.slice(dTagEnd, dEnd - CLOSE.length).includes('<')) return { refuse: '"<" inside the doc block' }
  h = h.slice(0, dOpen) + '<!--DOC-->' + h.slice(dEnd)
  if (count('data-bento-preview') > 0) {
    if (!remover || count('<script data-bento-preview') !== 1 || count(remover) !== 1) return { refuse: 'remover missing, altered or repeated' }
    const pOpen = h.lastIndexOf('<', h.indexOf('data-bento-preview')), rem = h.indexOf(remover), body = h.slice(pOpen, rem)
    if (/<script/i.test(body)) return { refuse: 'script inside the preview markup' }
    if (/\son[a-z]+\s*=/i.test(body) || /javascript:/i.test(body)) return { refuse: 'handler or javascript: in the preview markup' }
    h = h.slice(0, pOpen) + '<!--PREVIEW-->' + h.slice(rem + remover.length)
  }
  return h.replace(/<title>[^<]*<\/title>/, '<title><!--TITLE--></title>')
}

/** The strict expectation from a GENUINE saved file of a release. */
export function strictExpectedFrom(genuineSave: string): StrictExpected {
  const at = genuineSave.indexOf('<script data-bento-preview')
  const remover = at < 0 ? null : genuineSave.slice(at, genuineSave.indexOf(CLOSE, at) + CLOSE.length)
  const skeleton = collapse(genuineSave, remover)
  if (typeof skeleton !== 'string') throw new Error(`gate1: the genuine save fails its own strict check: ${skeleton.refuse}`)
  return { skeleton, remover }
}

/**
 * The strict check: each variable span (the doc block, the preview, the title)
 * is type-checked to its exact allowed form and collapsed. Then EVERYTHING else
 * must equal the release's saved skeleton, byte for byte, over the WHOLE string,
 * bound at both ends. That final compare is what's load-bearing: it caught every
 * one of security's adversarial rows (§15). The span guards are defence in
 * depth that let the variable spans legitimately vary.
 */
export function verifyStrict(html: string, expected: StrictExpected): { ok: true } | { ok: false; reason: string } {
  const c = collapse(html, expected.remover)
  if (typeof c !== 'string') return { ok: false, reason: c.refuse }
  return c === expected.skeleton ? { ok: true } : { ok: false, reason: 'skeleton differs from the release\'s saved form' }
}

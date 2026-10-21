// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// RELEASE PINS (K4, security §18 / §36): what a host needs to know a file's
// runtime is a genuine release's, derived from that release's own bytes.
//
// A host that SERVES a document (iOS, Android, desktop, the hosted runtime)
// checks the CODE blocks, which survive every save byte-identical because they
// are textContent, not markup:
//   bento-rt, bento-rt-css   the deflated runtime and stylesheet (data blocks
//                            the loader imports as blob: code, so the CSP cannot
//                            stop a swapped one, only this hash can)
//   loader                   the one executable inline script in the shell
//   remover                  the preview remover every save writes (constant)
// and serves the page with script-src pinned to the loader and the remover.
// A file matches a release only if ONE release matches EVERY block, with
// exactly one block per id; anything less is UNKNOWN (security §36).
//
// Pure string work, no DOM: this runs at release time on the built shell and a
// real saved file, and in CI on every PR's build.

import { createHash } from 'node:crypto'

const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const cspHash = (s) => `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}`

// THE GRAMMAR (security, 2026-10-21): a <script> is inert ONLY if its type is
// one of the exact data types Bento writes. Everything else is executable: no
// type, a JavaScript MIME type, "module", an unknown type, a differently cased
// data type, and ANY src=. An executable script must then be exactly the pinned
// loader or remover by hash, or the file is UNKNOWN. An allowlist, not a list of
// JavaScript types: a script type a browser treats as runnable tomorrow can't
// slip through as "data".
export const DATA_TYPES = new Set(['application/bento+json', 'application/bento+lang', 'bento/deflate-b64', 'bento/deflate-b86'])
export const isDataScript = (b) => b.tag === 'script' && b.src === null && b.type !== null && DATA_TYPES.has(b.type)

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?(?=\\s|$)`, 'i').exec(attrs)
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? ''
}

/**
 * Every <script> and <style> element, with its raw text: a script's text ends at
 * the first `</script` (any case), which is how the HTML tokenizer ends it too.
 */
export function scanBlocks(html) {
  const out = []
  const open = /<(script|style)\b([^>]*)>/gi
  let m
  while ((m = open.exec(html))) {
    const tag = m[1].toLowerCase()
    const start = m.index + m[0].length
    const close = html.toLowerCase().indexOf(`</${tag}`, start)
    if (close < 0) throw new Error(`release-pins: unterminated <${tag}> at ${m.index}`)
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

/** Every script that is not one of Bento's data blocks: each must be the pinned loader or remover. */
export const executableScripts = (blocks) => blocks.filter((b) => b.tag === 'script' && !isDataScript(b))

/**
 * Markup a genuine Bento file never carries (security, 2026-10-21), anywhere
 * outside a script or style element's own text: <iframe>, <object>, <embed>,
 * <base>, a <meta> refresh or CSP, any on*= attribute, and a comment holding a
 * <script>. A data block containing "<" is refused too: Bento's never do (the
 * document JSON and language packs escape it, the b64/b86 alphabets exclude
 * it), and a "<!--<script" inside script text would put the browser's
 * tokenizer in a state where a later close tag doesn't end the element. Returns
 * the problems; [] = none.
 */
export function markupProblems(html) {
  const problems = []
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
    let j = i + m[0].length, q = null
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

const CODE_IDS = ['bento-rt', 'bento-rt-css']

/**
 * The pins for a release, from its BUILT shell and a REAL file that release
 * saved (the remover only exists in saved files). Throws, never guesses: the
 * shell has exactly one executable inline script (the loader); the saved file's
 * executable inline scripts are exactly that loader, byte for byte, plus one
 * preview remover; every code block appears once in each, identical in both.
 */
export function derivePins(shellHtml, savedHtml, { historic = false } = {}) {
  const shell = scanBlocks(shellHtml), saved = scanBlocks(savedHtml)
  const fail = (msg) => { throw new Error(`release-pins: ${msg}`) }
  for (const [what, html] of [['built shell', shellHtml], ['saved file', savedHtml]]) {
    const bad = markupProblems(html)
    if (bad.length) fail(`the ${what} carries markup a genuine file never does: ${bad.join('; ')}`)
  }

  const shellExec = executableScripts(shell)
  if (shellExec.length !== 1) fail(`the built shell has ${shellExec.length} executable inline scripts; exactly one (the loader) expected`)
  const loader = shellExec[0].text

  const savedExec = executableScripts(saved)
  const removers = savedExec.filter((b) => b.preview)
  const loaders = savedExec.filter((b) => !b.preview)
  if (loaders.length !== 1 || loaders[0].text !== loader) fail('the saved file does not carry exactly the shell\'s loader, byte for byte')
  // A release from before the first-page preview (slides < 1.0.18) saves no
  // remover. Only a HISTORIC release may lack one: a new release that saves
  // none has a broken preview, and signing it would pin the breakage.
  if (removers.length > 1 || (removers.length === 0 && !historic)) {
    fail(`the saved file has ${removers.length} preview removers; exactly one expected (save a document that gets a preview)`)
  }
  const remover = removers[0]?.text ?? null

  const blocks = { loader: sha256hex(loader), remover: remover === null ? null : sha256hex(remover) }
  for (const id of CODE_IDS) {
    const inShell = shell.filter((b) => b.id === id), inSaved = saved.filter((b) => b.id === id)
    if (inShell.length !== 1) fail(`the built shell has ${inShell.length} #${id} blocks; exactly one expected`)
    if (inSaved.length !== 1) fail(`the saved file has ${inSaved.length} #${id} blocks; exactly one expected`)
    if (inSaved[0].text !== inShell[0].text) fail(`#${id} changed between the shell and a saved file: code blocks must survive a save byte for byte`)
    blocks[id] = sha256hex(inShell[0].text)
  }
  return { v: 1, blocks, scriptSrc: remover === null ? [cspHash(loader)] : [cspHash(loader), cspHash(remover)] }
}

/**
 * Check a file against one release's pins, the way a host must (security §36):
 * exactly one block per code id, each hash equal, and the executable inline
 * scripts exactly the pinned loader and remover. Returns the problems; [] = match.
 */
export function checkAgainstPins(html, pins) {
  const problems = [...markupProblems(html)]
  const blocks = scanBlocks(html)
  for (const id of CODE_IDS) {
    const found = blocks.filter((b) => b.id === id)
    if (found.length !== 1) problems.push(`${found.length} #${id} blocks (exactly one expected)`)
    else if (sha256hex(found[0].text) !== pins.blocks[id]) problems.push(`#${id} does not match`)
  }
  const exec = executableScripts(blocks)
  const allowed = new Set([pins.blocks.loader, pins.blocks.remover].filter(Boolean))
  for (const s of exec) if (s.src !== null || !allowed.has(sha256hex(s.text))) problems.push(`an executable script that is neither the pinned loader nor the remover (${s.src !== null ? 'src=' + s.src : s.text.length + 'B'})`)
  if (!exec.some((s) => sha256hex(s.text) === pins.blocks.loader)) problems.push('no pinned loader')
  if (exec.filter((s) => sha256hex(s.text) === pins.blocks.loader).length > 1) problems.push('more than one loader')
  if (pins.blocks.remover && exec.filter((s) => sha256hex(s.text) === pins.blocks.remover).length > 1) problems.push('more than one remover')
  return problems
}

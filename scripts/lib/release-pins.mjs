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

// A <script> is executable unless its type names something else. HTML runs a
// script with no type, an empty type, a JavaScript MIME type or "module".
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'application/ecmascript',
  'text/ecmascript', 'application/x-javascript', 'text/x-javascript', 'text/jscript', 'text/livescript'])
export const isExecutableType = (type) => type === null || JS_TYPES.has(type.trim().toLowerCase())

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
      tag, attrs, text: html.slice(start, close),
      type: attr(attrs, 'type'), id: attr(attrs, 'id'),
      preview: attr(attrs, 'data-bento-preview') !== null,
    })
    open.lastIndex = close
  }
  return out
}

/** The executable inline scripts (src-less, runnable type). */
export const executableScripts = (blocks) =>
  blocks.filter((b) => b.tag === 'script' && attr(b.attrs, 'src') === null && isExecutableType(b.type))

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
  const problems = []
  const blocks = scanBlocks(html)
  for (const id of CODE_IDS) {
    const found = blocks.filter((b) => b.id === id)
    if (found.length !== 1) problems.push(`${found.length} #${id} blocks (exactly one expected)`)
    else if (sha256hex(found[0].text) !== pins.blocks[id]) problems.push(`#${id} does not match`)
  }
  const exec = executableScripts(blocks)
  const allowed = new Set([pins.blocks.loader, pins.blocks.remover].filter(Boolean))
  for (const s of exec) if (!allowed.has(sha256hex(s.text))) problems.push(`an executable inline script that is neither the pinned loader nor the remover (${s.text.length}B)`)
  if (!exec.some((s) => sha256hex(s.text) === pins.blocks.loader)) problems.push('no pinned loader')
  if (exec.filter((s) => sha256hex(s.text) === pins.blocks.loader).length > 1) problems.push('more than one loader')
  if (pins.blocks.remover && exec.filter((s) => sha256hex(s.text) === pins.blocks.remover).length > 1) problems.push('more than one remover')
  return problems
}

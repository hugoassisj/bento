// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The file side of a .bento.html: find the #bento-doc block, read the
// document out of it, write one back in. Plain Node, no dependency.
//
// The block is the splice contract (docs/PLATFORM.md §2): a plaintext
// <script type="application/bento+json" id="bento-doc"> whose body is JSON with
// every `<` escaped as <, so it can never close itself. A plain save
// writes the JSON on one line with `"assets":` last on a line of its own
// (kernel save.ts docText); this module writes exactly that.

import fs from 'node:fs'

const ID_ATTR = ' id="bento-doc"'
const CLOSE = '</' + 'script>'

export class DeckError extends Error {
  /** @param {string} what  @param {string} next  the action that fixes it */
  constructor(what, next, code = 2) { super(what); this.next = next; this.code = code }
}

/** Where the block's body starts and ends in `html`, or null when there is none. */
export function findBlock(html) {
  const at = html.indexOf(ID_ATTR)
  if (at < 0) return null
  const open = html.lastIndexOf('<script', at)
  const start = html.indexOf('>', at + ID_ATTR.length)
  if (open < 0 || start < 0) return null
  const end = html.indexOf(CLOSE, start + 1)
  if (end < 0) return null
  return { start: start + 1, end }
}

/** The document text as the app writes it: one line, assets last on their own. */
export function docText(doc) {
  const { assets, ...rest } = doc
  const head = JSON.stringify(rest)
  if (assets === undefined) return head
  return `${head.slice(0, -1)}${head === '{}' ? '' : ','}\n"assets":${JSON.stringify(assets)}}`
}

/** Escape for the block: `<` never appears literally, so neither can a close tag. */
export const escapeBlock = (text) => (text.includes('<') ? text.replace(/</g, '\\u003c') : text)

/**
 * Read a deck. Returns { html, block, body, doc } where body is the trimmed
 * block text and doc the parsed document (null for an empty block — a fresh
 * app file). Throws DeckError with the next action for anything else.
 */
export function readDeck(file) {
  if (!fs.existsSync(file)) throw new DeckError(`no such file: ${file}`, 'Check the path, or create a deck with `bento new <out.bento.html>`.')
  const html = fs.readFileSync(file, 'utf8')
  const block = findBlock(html)
  if (!block) throw new DeckError(`${file} has no #bento-doc block, so it is not a bento file`, 'Pass a .bento.html saved by bento/slides, or start one with `bento new`.')
  const body = html.slice(block.start, block.end).trim()
  if (!body) return { html, block, body, doc: null }
  let doc
  try { doc = JSON.parse(body) } catch (e) {
    throw new DeckError(`the #bento-doc block of ${file} is not JSON (${e.message})`, 'Restore the file from a backup, or open it in a browser and save it again.')
  }
  if (doc && doc.format === 'bento/enc') {
    throw new DeckError(`${file} is password-protected: its document is encrypted`, 'Open it in a browser, remove the password (Save ▾ → Save without password), and run this again.')
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new DeckError(`the #bento-doc block of ${file} does not hold a document`, 'Pass a .bento.html saved by bento/slides.')
  if (doc.format && doc.format !== 'bento/slides') {
    throw new DeckError(`${file} is a ${doc.format} document; these tools read bento/slides`, 'Use the tools of that app instead.')
  }
  return { html, block, body, doc }
}

/** A document from a .json file or from a deck (its #bento-doc). */
export function readDocInput(file) {
  if (/\.html?$/i.test(file)) {
    const d = readDeck(file)
    if (!d.doc) throw new DeckError(`${file} holds no document yet (a fresh app file)`, 'Write one into it with `bento apply <deck> <doc.json>`.')
    return { doc: d.doc, from: 'deck' }
  }
  if (!fs.existsSync(file)) throw new DeckError(`no such file: ${file}`, 'Check the path; `bento extract <deck>` writes a document JSON from a deck.')
  let doc
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    throw new DeckError(`${file} is not JSON (${e.message})`, 'Fix the syntax at the position named, then run this again.')
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new DeckError(`${file} is not a document (expected a JSON object)`, 'Write a bento/slides document: { "format": "bento/slides", "slides": [...] }.')
  return { doc, from: 'json' }
}

/** The file with `doc` spliced into its block, keeping the whitespace around the JSON. */
export function spliceDoc(html, block, doc) {
  const raw = html.slice(block.start, block.end)
  const lead = /^\s*/.exec(raw)[0]
  const trail = /\s*$/.exec(raw)[0]
  const body = escapeBlock(docText(doc))
  return html.slice(0, block.start) + (raw.trim() ? lead + body + trail : '\n' + body + '\n') + html.slice(block.end)
}

/** Deep equality on JSON values; key order ignored. */
export function same(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => same(v, b[i]))
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
}

/**
 * The document to write back: the edited one, with the file's own envelope.
 * Keys keep the file's order (so an unedited round trip is byte for byte);
 * `collab` is always the file's (an extracted document never carries it);
 * `docId` is the file's, and an edit that names another one is refused;
 * `assets` are the file's, plus any the edit adds.
 */
export function mergeEnvelope(original, edited) {
  if (original?.docId && edited.docId && edited.docId !== original.docId) {
    throw new DeckError(`the document's docId (${edited.docId}) is not the file's (${original.docId}); a deck's identity never changes`,
      'Remove "docId" from the JSON (the file\'s is kept), or write to a new file with `bento new` if this is meant to be another deck.', 1)
  }
  const out = {}
  const orig = original ?? {}
  for (const k of Object.keys(orig)) {
    if (k === 'collab') out.collab = orig.collab
    else if (k === 'docId') out.docId = orig.docId
    else if (k === 'assets') continue
    else if (Object.hasOwn(edited, k)) out[k] = edited[k]
  }
  for (const k of Object.keys(edited)) {
    if (k === 'collab' || k === 'assets' || Object.hasOwn(out, k)) continue
    if (k === 'docId' && orig.docId) continue
    out[k] = edited[k]
  }
  if (orig.assets || edited.assets) out.assets = { ...(orig.assets ?? {}), ...(edited.assets ?? {}) }
  return out
}

/** Bytes of a JSON value as the file stores it. */
export const sizeOf = (v) => Buffer.byteLength(JSON.stringify(v) ?? '')

/** Keep a 1-based number list like "1,3-5" as a sorted set; null when malformed. */
export function parseRanges(spec) {
  const out = new Set()
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part)
    if (!m) return null
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
    if (a < 1 || b < a) return null
    for (let i = a; i <= b; i++) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}

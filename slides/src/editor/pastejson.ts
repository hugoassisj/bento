// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// What "Replace from JSON…" does with the text BEFORE the document gate sees
// it, and what it tells the person about the result. Pure (no DOM, no imports
// at run time) so scripts/test-slides-pastejson.ts runs it under plain node.
//
// The text comes back from a chatbot. Chat tools wrap code in a Markdown fence,
// put a sentence before it, leave a trailing comma, or stop mid-reply at their
// length limit. Two repairs cover the first three, and both only REMOVE
// characters a person did not mean as data: the fence and the prose around the
// JSON, and a comma directly before `}` or `]`. Nothing is ever added, so a
// reply that was cut off is refused (with that reason), never closed up — a
// closed-up reply would apply a deck with its tail silently missing. Every
// repair is named, so the dialog can say what it did.
//
// The scan below is a JSON syntax checker, not a parser: it walks the text the
// person pasted, in that text's own offsets, so a syntax error is reported at
// the line and column they can find in the textarea (engine messages differ:
// Safari's carry no position at all). The cleaned text then goes through
// parseDocInputReport and the untrusted shape gate exactly as before.

export type Repair = 'fence' | 'prose' | 'commas'

export type Rejection =
  | { code: 'empty' }
  | { code: 'no-json' }
  | { code: 'cut-off' }
  | { code: 'syntax'; line: number; col: number }
  | { code: 'not-document' }
  | { code: 'no-slides' }

export interface Cleaned {
  /** the JSON to hand to the document parser ('' when `error` is set) */
  json: string
  /** what was removed to get there, in the order it was done */
  repaired: Repair[]
  /** how many trailing commas were removed */
  commas: number
  error?: Rejection
}

const WS = /[ \t\n\r]/
const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const ESC = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y

interface Scan { end: number; commas: number[]; err?: number; eof?: boolean }

/** Walk one JSON object starting at `s[i] === '{'`, allowing a trailing comma
 *  before a closer (recorded, to be removed). Stops at the matching `}`. */
function scan(s: string, i: number, stop: number): Scan {
  const commas: number[] = []
  const closers: string[] = []
  // 0: a value is due, 1: a value just ended, 2: an object key is due
  let want = 0
  // the token before: 'o' an opener, 'c' a comma, '' anything else
  let prev = ''
  let comma = -1
  const fail = (at: number, eof = at >= stop): Scan => ({ end: at, commas, err: at, eof })
  for (;;) {
    while (i < stop && WS.test(s[i])) i++
    if (i >= stop) return fail(i)
    const c = s[i]
    const top = closers[closers.length - 1]
    if (c === top && (want === 1 || prev === 'o' || prev === 'c')) {
      if (want !== 1 && prev === 'c') commas.push(comma)
      closers.pop(); i++; want = 1; prev = ''
      if (!closers.length) return { end: i, commas }
      continue
    }
    if (want === 1) {
      if (c !== ',') return fail(i)
      comma = i++; prev = 'c'; want = top === '}' ? 2 : 0
      continue
    }
    if (want === 2 && c !== '"') return fail(i)
    prev = ''
    if (c === '{' || c === '[') { closers.push(c === '{' ? '}' : ']'); i++; want = c === '{' ? 2 : 0; prev = 'o'; continue }
    if (c === '"') {
      i++
      for (;;) {
        if (i >= stop) return fail(i)
        const d = s[i]
        if (d === '"') { i++; break }
        if (d === '\\') {
          if (i + 6 > stop && /^\\(u[0-9a-fA-F]{0,3})?$/.test(s.slice(i, stop))) return fail(stop)
          ESC.lastIndex = i
          if (!ESC.test(s)) return fail(i)
          i = ESC.lastIndex
          continue
        }
        if (d < ' ') return fail(i, false)
        i++
      }
      if (want === 2) {
        while (i < stop && WS.test(s[i])) i++
        if (i >= stop) return fail(i)
        if (s[i] !== ':') return fail(i)
        i++; want = 0
      } else want = 1
      continue
    }
    NUM.lastIndex = i
    if (NUM.test(s)) {
      i = NUM.lastIndex; want = 1
      // `1.` or `2e+` at the very end: a number the reply stopped inside
      if (/^(\.|[eE][+-]?)$/.test(s.slice(i, stop))) return fail(stop)
      continue
    }
    const lit = ['true', 'false', 'null'].find((w) => s.startsWith(w, i))
    if (lit) { i += lit.length; want = 1; continue }
    // a literal or a sign cut off at the very end is truncation, not a typo
    const rest = s.slice(i, stop)
    if (['true', 'false', 'null', '-'].some((w) => w.startsWith(rest))) return fail(stop)
    return fail(i, false)
  }
}

/** 1-based line and column of an offset in `s`. */
export function lineCol(s: string, at: number): { line: number; col: number } {
  const before = s.slice(0, at)
  const line = before.split('\n').length
  return { line, col: at - before.lastIndexOf('\n') }
}

/**
 * Find the document JSON in pasted text and make it parseable, or say why it
 * cannot be. Takes the first fenced block whose content is an object, else
 * the whole text; inside that, the object that starts at the first `{`
 * followed by a key (or `}`), up to its matching `}`.
 */
export function cleanPastedJson(text: string): Cleaned {
  const out: Cleaned = { json: '', repaired: [], commas: 0 }
  if (!text.trim()) return { ...out, error: { code: 'empty' } }
  let from = 0, to = text.length
  const fence = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n/g
  for (let m; (m = fence.exec(text));) {
    const a = m.index + m[0].length
    const close = text.indexOf('\n' + m[2], a - 1)
    const b = close < 0 ? text.length : close
    if (text.slice(a, b).trim().startsWith('{')) {
      from = a; to = b
      out.repaired.push('fence')
      break
    }
    if (close < 0) break
    fence.lastIndex = close + 1
  }
  let start = -1
  for (let i = text.indexOf('{', from); i >= 0 && i < to; i = text.indexOf('{', i + 1)) {
    if (/^\{\s*["}]/.test(text.slice(i, i + 64))) { start = i; break }
    if (start < 0) start = i
  }
  if (start < 0 || start >= to) return { ...out, error: { code: 'no-json' } }
  // a fence the reply never closed: the scan runs to the end of the text
  const r = scan(text, start, to)
  if (r.err !== undefined) {
    return { ...out, error: r.eof ? { code: 'cut-off' } : { code: 'syntax', ...lineCol(text, r.err) } }
  }
  if (text.slice(0, start).replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*(?=\n)/, '').trim() ||
      text.slice(r.end).replace(/^\s*(`{3,}|~{3,})/, '').trim()) out.repaired.push('prose')
  let json = ''
  let at = start
  for (const c of r.commas) { json += text.slice(at, c); at = c + 1 }
  json += text.slice(at, r.end)
  if (r.commas.length) out.repaired.push('commas')
  return { ...out, json, commas: r.commas.length }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Why the document parser refused JSON that parses: it is not a bento/slides
 * document (neither the format nor compact), or it carries no slide the gate
 * kept. Only called after a refusal; the parser's `null` keeps its meaning.
 */
export function docRejection(json: string): Rejection {
  let v: unknown
  try { v = JSON.parse(json) } catch { return { code: 'syntax', line: 1, col: 1 } }
  if (!isObj(v) || (v.compact !== true && v.format !== 'bento/slides')) return { code: 'not-document' }
  return { code: 'no-slides' }
}

interface HasId { id: string }
interface DocLike { slides: (HasId & { elements?: HasId[] })[] }

/**
 * Deep equality that ignores key order (the gate rebuilds objects). A
 * component copy's `component.sig` is skipped: it is a hash the derive pass
 * keeps of its main's JSON in key order (components.ts mainSig), so the
 * gate's rebuild changes it while nothing the person wrote has changed.
 */
export function same(a: unknown, b: unknown, comp = false): boolean {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (!isObj(a) || !isObj(b)) return false
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined && !(comp && k === 'sig'))
  const ka = keys(a)
  return ka.length === keys(b).length && ka.every((k) => k in b && same(a[k], b[k], k === 'component'))
}

export interface ReplaceSummary {
  before: number
  after: number
  added: string[]
  removed: string[]
  changed: string[]
  /** elements added, removed or edited on the slides both decks have */
  elements: number
}

/** What replacing `live` with `next` does, by slide id. Ids and counts only. */
export function summarizeReplace(live: DocLike, next: DocLike): ReplaceSummary {
  const was = new Map(live.slides.map((s) => [s.id, s]))
  const now = new Set(next.slides.map((s) => s.id))
  const sum: ReplaceSummary = { before: live.slides.length, after: next.slides.length, added: [], removed: [], changed: [], elements: 0 }
  for (const s of live.slides) if (!now.has(s.id)) sum.removed.push(s.id)
  for (const s of next.slides) {
    const old = was.get(s.id)
    if (!old) { sum.added.push(s.id); continue }
    if (same(old, s)) continue
    sum.changed.push(s.id)
    const els = new Map((old.elements ?? []).map((e) => [e.id, e]))
    for (const e of s.elements ?? []) {
      const o = els.get(e.id)
      if (!o || !same(o, e)) sum.elements++
      els.delete(e.id)
    }
    sum.elements += els.size
  }
  return sum
}

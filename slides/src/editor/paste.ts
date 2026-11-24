// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * What a paste into a text box or table cell inserts (discussion #503).
 *
 * The clipboard carries the selection twice: as `text/html` — the browser's
 * own serialisation of what was copied, formatting and all — and as
 * `text/plain`. Until now only the plain flavour was read, so copying bold,
 * italic or bullets from one box and pasting into another lost everything.
 * The html flavour is preferred now, through the ONE sanitizer (render.ts
 * sanitizeHtml: an allowlist of tags, every attribute dropped, an anchor's
 * href kept only when it is a web URL, nested markup walked before it is
 * lifted). Plain text stays the fallback and keeps its markdown conversion.
 *
 * Browser clipboards are not tidy. Chrome writes `<meta charset>` first, wraps
 * the selection in `<span style="…">` soup with the computed font, and marks
 * a NOT-bold run inside a bold context as `<b style="font-weight:normal">` —
 * a `<b>` that means "not bold". The sanitizer drops attributes, which would
 * turn that into a real bold. So the quirks are handled before it runs: meta
 * and style elements removed, a `<b>`/`<strong>` whose inline style says
 * `font-weight: normal` (or ≤ 400) unwrapped. Spans survive the sanitizer as
 * bare `<span>`s, which render as nothing — so a span whose style says bold,
 * italic, underline or strike (all Google Docs writes) gets the tag first.
 * Lists come in three shapes and leave as one: a real list (Google Docs adds
 * a `<p>` inside each item, unwrapped), Word's `mso-list` paragraphs, and
 * paragraphs that start with a bullet glyph.
 *
 * Everything above happens in a document of its own, made by DOMParser and
 * never attached to the page: untrusted nodes are parsed, tidied and
 * serialised there, and only the resulting STRING reaches sanitizeHtml. A
 * node adopted into the live document starts loading what it names (img,
 * source, poster, input type=image) and fires its load and error handlers
 * before any sanitizer has run — measured — so nothing here is ever created
 * in or appended to `document`.
 */

import { sanitizeHtml } from '../render'
import { keepSpaces } from './markdown'

/** Past this much html the clipboard is not read as html at all: the
 *  plain-text path, with its own cap, takes it. */
const MAX_HTML = 500_000

/** The html to insert for this clipboard, or '' when the plain-text path
 *  should run instead (no html flavour, or nothing left after cleaning).
 *  `maxText` cuts the text after that many characters, as the slide's
 *  plain-text paste does. */
export function clipboardToHtml(dt: DataTransfer | null | undefined, maxText = Infinity): string {
  const html = dt?.getData('text/html')
  if (!html || html.length > MAX_HTML || typeof DOMParser === 'undefined') return ''
  // an inert document: no loads, no scripts, no handlers ever fire in it
  const inert = new DOMParser().parseFromString(html, 'text/html')
  const body = inert.body
  // (and the line break Chrome appends when a copy ends on a block)
  for (const junk of Array.from(body.querySelectorAll('meta, style, script, title, link, head, br.Apple-interchange-newline'))) junk.remove()
  for (const b of Array.from(body.querySelectorAll('b, strong'))) {
    const w = (b as HTMLElement).style.fontWeight.trim().toLowerCase()
    const light = w === 'normal' || w === 'lighter' || (/^\d+$/.test(w) && Number(w) <= 400)
    if (light) {
      const parent = b.parentNode
      if (!parent) continue
      while (b.firstChild) parent.insertBefore(b.firstChild, b)
      b.remove()
    }
  }
  styleToTags(inert, body)
  wordLists(inert, body)
  glyphLists(inert, body)
  paragraphsInItems(inert, body)
  keepPreformatted(inert, body)
  if (maxText < Infinity) clipText(inert, body, maxText)
  const clean = sanitizeHtml(body.innerHTML)
  // nothing but whitespace/empty tags → let the plain path decide. Checked
  // in an inert document too: the cleaned string is parsed back there.
  const check = new DOMParser().parseFromString(clean, 'text/html').body
  return check.textContent?.trim() || check.querySelector('br, li') ? clean : ''
}

/** Bold, italic, underline and strike written as an inline style — every
 *  run Google Docs copies is a `<span style="font-weight:700">` or the like
 *  — become the tags the sanitizer keeps, since it drops the style with
 *  every other attribute. A link's own underline is the link's, not a <u>. */
function styleToTags(doc: Document, body: HTMLElement) {
  for (const el of Array.from(body.querySelectorAll<HTMLElement>('span[style]'))) {
    const st = el.style
    const w = st.fontWeight.trim().toLowerCase()
    const deco = `${st.textDecorationLine} ${st.textDecoration}`
    const tags: string[] = []
    if (w === 'bold' || w === 'bolder' || (/^\d+$/.test(w) && Number(w) >= 600)) tags.push('b')
    if (/italic|oblique/.test(st.fontStyle)) tags.push('i')
    if (/underline/.test(deco) && !el.closest('a')) tags.push('u')
    if (/line-through/.test(deco)) tags.push('s')
    let inner: HTMLElement = el
    for (const tag of tags) {
      const wrap = doc.createElement(tag)
      while (inner.firstChild) wrap.append(inner.firstChild)
      inner.append(wrap)
      inner = wrap
    }
  }
}

/** Wrap each run of consecutive sibling `items` (as `group` splits them)
 *  into one list; `strip` takes an item's marker off before it moves. */
function toLists(doc: Document, items: HTMLElement[], group: (a: HTMLElement, b: HTMLElement) => boolean,
  ordered: (first: HTMLElement) => boolean, strip: (p: HTMLElement) => void) {
  let i = 0
  while (i < items.length) {
    const run = [items[i]]
    while (i + run.length < items.length) {
      const next = items[i + run.length]
      const last = run[run.length - 1]
      if (last.nextElementSibling !== next || !group(last, next)) break
      run.push(next)
    }
    const list = doc.createElement(ordered(run[0]) ? 'ol' : 'ul')
    run[0].before(list)
    for (const p of run) {
      strip(p)
      const li = doc.createElement('li')
      while (p.firstChild) li.append(p.firstChild)
      list.append(li)
      p.remove()
    }
    i += run.length
  }
}

/** Word writes a list as paragraphs styled `mso-list:l0 level1 lfo1`, each
 *  with its bullet or number as text in a `mso-list:Ignore` span. A run of
 *  them with the same list id becomes a real list; the marker goes, and a
 *  number or letter marker makes it an ordered one. (Every level is one
 *  list here: nesting is left flat.) */
function wordLists(doc: Document, body: HTMLElement) {
  const id = (p: HTMLElement) => /mso-list:\s*(l\d+)/i.exec(p.getAttribute('style') ?? '')?.[1]
  const items = Array.from(body.querySelectorAll<HTMLElement>('p')).filter((p) => id(p))
  const marker = (p: HTMLElement) => Array.from(p.querySelectorAll<HTMLElement>('span[style]'))
    .find((s) => /mso-list:\s*ignore/i.test(s.getAttribute('style') ?? ''))
  toLists(doc, items, (a, b) => id(a) === id(b),
    (first) => /^\s*(?:\d+|[a-z]|[ivxlcdm]+)[.)]/i.test(marker(first)?.textContent ?? ''),
    (p) => marker(p)?.remove())
}

const GLYPH = /^[\s\u00a0]*[\u2022\u00b7\u25e6\u25aa\u25cf\u2023][\s\u00a0]+/

/** Paragraphs that start with a bullet glyph (`<p>• item</p>`, what many
 *  apps and pages copy instead of a list) become one real list per run. */
function glyphLists(doc: Document, body: HTMLElement) {
  const items = Array.from(body.querySelectorAll<HTMLElement>('p')).filter((p) => GLYPH.test(p.textContent ?? ''))
  toLists(doc, items, () => true, () => false, (p) => {
    // the glyph is in the first text there is; take it off there
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text
      if (!t.data.trim()) continue
      t.data = t.data.replace(GLYPH, '')
      break
    }
  })
}

/** Google Docs puts a `<p>` in every list item. A paragraph's margins inside
 *  an item only spread the list out, so it is unwrapped (a line break between
 *  two in one item). */
function paragraphsInItems(doc: Document, body: HTMLElement) {
  for (const li of Array.from(body.querySelectorAll('li'))) {
    const ps = Array.from(li.children).filter((c) => c.tagName === 'P')
    ps.forEach((p, k) => {
      if (k) p.before(doc.createElement('br'))
      p.replaceWith(...Array.from(p.childNodes))
    })
  }
}

/** Keep the first `max` characters of text and drop everything after them. */
function clipText(doc: Document, body: HTMLElement, max: number) {
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let left = max
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (t.data.length <= left) { left -= t.data.length; continue }
    t.data = t.data.slice(0, left)
    for (let cur: Node | null = t; cur && cur !== body; cur = cur.parentNode) {
      while (cur.nextSibling) cur.nextSibling.remove()
    }
    return
  }
}

/** A clipboard whose html flavour is a table — what a spreadsheet copies. It
 *  is a grid, not formatted text, so a paste onto the slide leaves it to the
 *  plain-text path (a table paste of its own is separate work). Read as a
 *  string only: nothing is parsed. */
export function clipboardIsGrid(dt: DataTransfer | null | undefined): boolean {
  return /<table[\s>]/i.test(dt?.getData('text/html') ?? '')
}

/** Text the source painted as preformatted — a `<pre>`, or an ancestor whose
 *  inline style says `white-space: pre…` (what a terminal, an editor or a web
 *  page's code block copies as) — keeps its spaces and line breaks. The
 *  sanitizer drops every attribute, so the instruction would otherwise go
 *  with it and the text would collapse to single spaces (#750). */
function keepPreformatted(doc: Document, body: HTMLElement) {
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let e = n.parentElement; e && e !== body; e = e.parentElement) {
      const ws = e.style?.whiteSpace
      if (ws) { if (ws.startsWith('pre')) hits.push(n as Text); break }
      if (e.tagName === 'PRE') { hits.push(n as Text); break }
    }
  }
  for (const node of hits) {
    const lines = node.data.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    const frag = doc.createDocumentFragment()
    lines.forEach((line, i) => {
      if (i) frag.append(doc.createElement('br'))
      if (line) frag.append(doc.createTextNode(keepSpaces(line)))
    })
    node.replaceWith(frag)
  }
}

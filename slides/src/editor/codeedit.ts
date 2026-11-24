// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Tab, Shift+Tab and Enter inside a Code element being edited, as in every
// code editor: Tab indents (two spaces at a caret; every line a selection
// touches, as a block), Shift+Tab outdents, Enter carries the line's
// indentation to the next. Tab never leaves the block — Esc does — because a
// Tab the browser handled moved focus, which committed the edit and sent the
// next letters to the editor's shortcuts (typing `return x` armed the Shape
// tool). canvas.ts calls these from the shared text-edit keydown.
//
// The line rules are plain text in, plain text out (the rig drives them in
// node). The DOM half reads the edited <pre> as text — Chrome keeps a code
// block as text and <br>s — and writes changes back with insertText, so the
// browser's own ⌘Z undoes each one.

/** One level of indentation: what the starter deck's code uses. */
export const CODE_INDENT = '  '

/** Text with a selection, in character offsets. */
export type CodeEdit = { text: string; start: number; end: number }

/** The first and last line a selection touches. A selection that ends at the
 *  very start of a line does not touch that line. */
function lineSpan(text: string, start: number, end: number) {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end
  const nl = text.indexOf('\n', last)
  return { from, to: nl < 0 ? text.length : nl }
}

/** Indent every line the selection touches by one level (empty lines get no
 *  trailing spaces); the indented lines come back selected. */
export function indentLines(text: string, start: number, end: number): CodeEdit {
  const { from, to } = lineSpan(text, start, end)
  const block = text.slice(from, to).split('\n').map((l) => (l ? CODE_INDENT + l : l)).join('\n')
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length }
}

/** Outdent every line the selection touches by one level (a tab, or up to
 *  two spaces). With a caret, the caret moves with its text; with a
 *  selection, the lines come back selected. Nothing to remove → unchanged. */
export function outdentLines(text: string, start: number, end: number): CodeEdit {
  const { from, to } = lineSpan(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const cut = lines.map((l) => (l.startsWith('\t') ? 1 : (l.match(/^ {1,2}/)?.[0].length ?? 0)))
  if (cut.every((n) => !n)) return { text, start, end }
  const block = lines.map((l, i) => l.slice(cut[i])).join('\n')
  const out = text.slice(0, from) + block + text.slice(to)
  if (start === end) {
    const at = Math.max(from, start - cut[0])
    return { text: out, start: at, end: at }
  }
  return { text: out, start: from, end: from + block.length }
}

/** The indentation Enter carries to a new line: the leading spaces and tabs
 *  of the caret's line, up to the caret. */
export function lineIndent(text: string, caret: number): string {
  const from = text.lastIndexOf('\n', caret - 1) + 1
  return text.slice(from, caret).match(/^[ \t]*/)?.[0] ?? ''
}

// --- the DOM half ------------------------------------------------------------

const BLOCK = /^(DIV|P|LI|PRE)$/

/** A node's text as the block shows it: <br> and block boundaries are line
 *  breaks. */
function plain(root: Node): string {
  let out = ''
  let pending = false
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        if (pending && out && !out.endsWith('\n')) out += '\n'
        pending = false
        out += (c as Text).data
      } else if (c.nodeName === 'BR') {
        pending = false
        out += '\n'
      } else if (c instanceof Element) {
        const block = BLOCK.test(c.tagName)
        if (block && out && !out.endsWith('\n')) out += '\n'
        walk(c)
        if (block) pending = true
      }
    }
  }
  walk(root)
  return out
}

/** The edited block's text and selection, or null when the selection is not
 *  in it. A <br> that ends the block only holds its last line open. */
function readCode(root: HTMLElement): CodeEdit | null {
  const sel = document.getSelection()
  if (!sel?.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null
  let text = plain(root)
  if (root.lastChild?.nodeName === 'BR' && text.endsWith('\n')) text = text.slice(0, -1)
  const upTo = (node: Node, offset: number) => {
    const p = document.createRange()
    p.setStart(root, 0)
    p.setEnd(node, offset)
    return Math.min(plain(p.cloneContents()).length, text.length)
  }
  return { text, start: upTo(r.startContainer, r.startOffset), end: upTo(r.endContainer, r.endOffset) }
}

/** The DOM position of a text offset in a block of text nodes and <br>s. */
function pointAt(root: HTMLElement, offset: number): [Node, number] {
  let pos = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n as Text).data.length
      if (offset <= pos + len) return [n, offset - pos]
      pos += len
    } else if (n.nodeName === 'BR') {
      if (offset <= pos) return [n.parentNode!, Array.prototype.indexOf.call(n.parentNode!.childNodes, n)]
      pos += 1
    }
  }
  return [root, root.childNodes.length]
}

/** Replace the block's text in one undoable step and select [start, end]. */
function writeCode(root: HTMLElement, next: CodeEdit) {
  const sel = document.getSelection()
  if (!sel) return
  sel.selectAllChildren(root)
  if (next.text) document.execCommand('insertText', false, next.text)
  else document.execCommand('delete')
  const range = document.createRange()
  range.setStart(...pointAt(root, next.start))
  range.setEnd(...pointAt(root, next.end))
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Tab (dir 1) or Shift+Tab (dir -1) in the edited code block `root`. */
export function indentCode(root: HTMLElement, dir: 1 | -1) {
  const cur = readCode(root)
  if (!cur) return
  if (dir > 0 && cur.start === cur.end) { document.execCommand('insertText', false, CODE_INDENT); return }
  const next = dir > 0 ? indentLines(cur.text, cur.start, cur.end) : outdentLines(cur.text, cur.start, cur.end)
  if (next.text !== cur.text) writeCode(root, next)
}

/** Enter in the edited code block `root`: a new line at the same indent. */
export function newlineInCode(root: HTMLElement) {
  const cur = readCode(root)
  if (!cur) return
  document.execCommand('insertText', false, '\n' + lineIndent(cur.text, cur.start))
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Code pasted onto the canvas becomes a Code element, not a text box
// (DT-10). Copying a function from an editor and pasting it on a slide gave a
// centred text box in the deck's font with the indentation flattened; only
// text wrapped in ``` fences became code. Two signals now say "this is code":
//
// - the clipboard's html flavour, when ALL of its text is painted as code — in
//   <pre>/<code>/<kbd>/<samp>, or under an inline monospace font-family (what
//   VS Code and most editors write). White-space alone is not enough: a text
//   box copied from a slide is pre-wrap too.
// - the plain text, when it has two or more lines and either most lines after
//   the first are indented and something in it is code punctuation, or most
//   lines end (or start) with a brace or a semicolon. A list is never code.
//
// The guess at the language is a handful of high-signal patterns per built-in
// grammar, scored; only a clear winner counts, otherwise the element keeps the
// Language menu's default. textLooksLikeCode and guessLanguage are DOM-free
// (scripts/test-slides-code-paste.ts holds their table of cases); the html
// check parses in an inert DOMParser document, as editor/paste.ts does, and
// only a boolean leaves it.

/** A list item: a bullet glyph, - * + or a number, then a space. */
const LIST_ITEM = /^\s*(?:[-*+•◦▪‣]|\d+[.)])\s/
/** Something only code tends to have. */
const CODE_MARK = /[{}()[\];=<>]|:\s*$/
/** A line a C-family statement or block ends or starts. */
const CODE_EDGE = /[{};]\s*$|^\s*[}\])]/

/** Whether pasted plain text reads as code (see the header for the rules). */
export function textLooksLikeCode(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
  if (lines.length < 2) return false
  if (lines.filter((l) => LIST_ITEM.test(l)).length * 2 >= lines.length) return false
  const rest = lines.slice(1)
  const indented = rest.filter((l) => /^(?: {2,}|\t)/.test(l)).length
  if (indented * 2 >= rest.length && lines.some((l) => CODE_MARK.test(l))) return true
  return lines.filter((l) => CODE_EDGE.test(l)).length >= lines.length * 0.6
}

const MONOSPACE = /mono|menlo|monaco|consolas|courier|cascadia|inconsolata|\bcode\b/i
const CODE_TAG = /^(?:PRE|CODE|KBD|SAMP|TT)$/

/** Whether every piece of text in a clipboard's html flavour is painted as
 *  code. Parsed in a document of its own, never attached to the page. */
export function htmlLooksLikeCode(html: string | undefined | null): boolean {
  if (!html || typeof DOMParser === 'undefined') return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  for (const junk of Array.from(body.querySelectorAll('meta, style, script, title, link'))) junk.remove()
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  let any = false
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n as Text).data.trim()) continue
    any = true
    let code = false
    for (let e = n.parentElement; e && e !== body; e = e.parentElement) {
      if (CODE_TAG.test(e.tagName) || MONOSPACE.test(e.style?.fontFamily ?? '')) { code = true; break }
    }
    if (!code) return false
  }
  return any
}

/** [pattern, weight]: a `g` pattern scores per match (at most three). */
type Rule = [RegExp, number]

const RULES: Record<string, Rule[]> = {
  py: [[/^\s*def \w+\s*\(.*\)\s*(?:->.*)?:\s*$/m, 4], [/^\s*class \w+(?:\(.*\))?:\s*$/m, 4], [/^\s*(?:from [\w.]+ )?import [\w.]+(?:, [\w.]+)*\s*$/m, 2],
    [/^\s*(?:elif|except|finally|with)\b.*:\s*$/m, 3], [/^\s*(?:if|for|while) .*:\s*$/m, 2], [/\bself\b/, 1], [/\b(?:None|True|False)\b/, 1]],
  js: [[/\b(?:const|let|var) [\w$]+\s*(?::[^=\n]+)?=/, 2], [/=>/, 1], [/\bfunction\b\s*[\w$]*\s*\(/, 2], [/\bconsole\.\w+\(/, 3], [/\brequire\(['"]/, 2],
    [/\bmodule\.exports\b/, 3], [/^\s*import .+ from ['"]/m, 2], [/^\s*export (?:default |const |function )/m, 2], [/[!=]==/, 2], [/\b(?:document|window)\.\w/, 2]],
  sh: [[/^#!.*\b(?:ba|z|k)?sh\b/m, 6], [/^\s*(?:sudo |apt(?:-get)? |brew |npm |npx |yarn |pnpm |pip3? |git |cd |ls\b|echo |export \w+=|curl |wget |docker |mkdir |rm |chmod |source )/gm, 2],
    [/\b(?:fi|done|esac)\s*$/m, 3], [/^\s*for \w+ in .*; do\b/m, 3], [/\$\{?\w+\}?/, 1], [/^\s*\$ \w/m, 2]],
  sql: [[/\bselect\b[\s\S]+?\bfrom\b/i, 4], [/\b(?:insert\s+into|delete\s+from|create\s+table|alter\s+table)\b/i, 4], [/\bupdate\s+\w+\s+set\b/i, 4],
    [/\bwhere\b/i, 1], [/\b(?:order|group)\s+by\b/i, 2], [/\bjoin\b.*\bon\b/i, 2]],
  html: [[/<!doctype html/i, 6], [/<\/?(?:html|head|body|div|span|p|a|ul|ol|li|table|tr|td|script|style|section|h[1-6])\b[^>]*>/gi, 2], [/<\/\w+>/, 1]],
  xml: [[/^\s*<\?xml\b/, 6]],
  css: [[/^\s*[.#][\w-]+[^{}\n]*\{\s*$/m, 3], [/@(?:media|import|keyframes|font-face)\b/, 3], [/^\s*[a-z-]+\s*:\s*[^;{}\n]+;\s*$/gm, 2], [/:\s*[\d.]+(?:px|em|rem|%|vh|vw)\b/, 2]],
  go: [[/^\s*package \w+\s*$/m, 4], [/\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/, 4], [/:=/, 2], [/\bfmt\.\w+\(/, 4], [/^\s*import \(/m, 2]],
  rust: [[/\bfn\s+\w+\s*(?:<[^>]*>)?\s*\(/, 4], [/\blet\s+mut\b/, 4], [/\b(?:println|format|vec|panic|macro_rules)!/, 4], [/\bimpl\b/, 2], [/\bpub fn\b/, 2], [/::\w/, 1]],
  java: [[/\bpublic\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum|void)\b/, 4], [/\bSystem\.(?:out|err)\.print/, 5], [/@Override\b/, 3], [/\bString\[\]/, 2],
    [/\b(?:private|protected)\s+(?:static\s+)?\w+(?:<[^>]*>)?\s+\w+\s*[;=]/, 2]],
  csharp: [[/^\s*using System(?:\.\w+)*;/m, 5], [/\bnamespace\s+[\w.]+/, 2], [/\bConsole\.Write(?:Line)?\(/, 5], [/\{\s*get;\s*(?:set;\s*)?\}/, 4], [/\bstatic void Main\(/, 3]],
  c: [[/^\s*#include\s*[<"]/m, 4], [/\bprintf\s*\(/, 2], [/\bint\s+main\s*\(/, 2], [/\b(?:malloc|free|sizeof)\s*\(/, 2]],
  ruby: [[/^\s*def \w+[?!]?(?:\s*\(.*\))?\s*$/m, 3], [/^\s*end\s*$/m, 3], [/\bputs\b/, 2], [/\bdo\s*\|[\w, ]+\|/, 3], [/^\s*require ['"]/m, 2], [/#\{\w+\}/, 2],
    [/\battr_(?:reader|accessor|writer)\b/, 3]],
  php: [[/<\?php/, 8], [/\$\w+\s*=/, 2], [/\$this->/, 3], [/\becho\b/, 1], [/\bfunction\s+\w+\s*\(\s*\$/, 3]],
  diff: [[/^(?:---|\+\+\+) \S/gm, 3], [/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m, 5]],
  dockerfile: [[/^\s*FROM\s+\S+/m, 3], [/^\s*(?:RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|EXPOSE|ENV|ARG)\s/gm, 2]],
}
/** Patterns that only ever ADD to a base language: TypeScript is JavaScript
 *  plus these, C++ is C plus these. Without one of them it is the base. */
const ON_TOP: Record<string, [string, Rule[]]> = {
  ts: ['js', [[/:\s*(?:string|number|boolean|void|any|unknown|never)\b/, 3], [/^\s*(?:export )?interface \w+/m, 3], [/^\s*(?:export )?type \w+\s*=/m, 2], [/\bas const\b/, 2]]],
  cpp: ['c', [[/\bstd::/, 4], [/\b(?:cout|cin|cerr)\s*<</, 3], [/\btemplate\s*</, 3], [/^\s*#include\s*<(?:iostream|vector|string|map|memory|algorithm)>/m, 3]]],
}

function score(text: string, rules: Rule[]): number {
  let s = 0
  for (const [re, w] of rules) s += w * (re.global ? Math.min(3, text.match(re)?.length ?? 0) : re.test(text) ? 1 : 0)
  return s
}

/** JSON is the one language a parser can confirm. */
function isJson(text: string): boolean {
  const t = text.trim()
  if (!/^[[{]/.test(t)) return false
  try { JSON.parse(t); return true } catch { return false }
}

/** YAML: most lines are `key: value` (or `- key: value`), none ends like a
 *  C-family statement. */
function yamlScore(text: string): number {
  const lines = text.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l))
  if (lines.length < 2 || lines.some((l) => /[;{}]\s*$/.test(l))) return 0
  const kv = lines.filter((l) => /^\s*(?:- )?[\w.-]+:(?:\s|$)/.test(l)).length
  return kv >= lines.length * 0.6 ? 4 + (/^---\s*$/m.test(text) ? 2 : 0) : 0
}

/**
 * The built-in grammar a piece of code is written in, or undefined when the
 * evidence is thin (best score under 3) or split (the runner-up within 2).
 * Ids are the Language menu's (the tokenizer's LANGS keys, plus diff).
 */
export function guessLanguage(code: string): string | undefined {
  const text = code.replace(/\r\n?/g, '\n').slice(0, 20000)
  if (!text.trim()) return undefined
  const scores: Record<string, number> = {}
  for (const [lang, rules] of Object.entries(RULES)) scores[lang] = score(text, rules)
  for (const [lang, [base, rules]] of Object.entries(ON_TOP)) {
    const extra = score(text, rules)
    scores[lang] = extra ? scores[base] + extra : 0
  }
  if (isJson(text)) scores.json = 8
  scores.yaml = yamlScore(text)
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [best, second] = ranked
  return best[1] >= 3 && best[1] - (second?.[1] ?? 0) >= 2 ? best[0] : undefined
}

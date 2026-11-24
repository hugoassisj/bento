// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Code pasted onto the canvas becomes a Code element, not a text box
// (DT-10). Copying a function from an editor and pasting it on a slide gave a
// centred text box in the deck's font with the indentation flattened; only
// text wrapped in ``` fences became code. Two signals now say "this is code":
//
// - the clipboard's html flavour, when ALL of its text is painted as code — in
//   <pre>/<code>/<kbd>/<samp>/<tt>, or under an inline monospace font-family
//   (what VS Code and most editors write) — and it is not a table and not
//   mostly prose. White-space alone is not enough: a text box copied from a
//   slide is pre-wrap too.
// - the plain text, when at least half of its lines carry code (a brace, a
//   call, an assignment, a statement keyword …) and it is not a list, a
//   tab-separated table or mostly prose. When unsure it stays text.
//
// The guess at the language is a handful of high-signal patterns per built-in
// grammar, scored, with a few negative ones; only a clear winner backed by two
// independent signals counts, otherwise the element keeps the Language menu's
// default. textLooksLikeCode and guessLanguage are DOM-free
// (scripts/test-slides-code-paste.ts holds their table of cases); the html
// check parses in an inert DOMParser document, as editor/paste.ts does, and
// only a boolean leaves it.

/** A list item: a bullet glyph, - * + or a number, then a space. */
const LIST_ITEM = /^\s*(?:[-*+•◦▪‣]|\d+[.)])\s/
/**
 * A line with code in it: a brace or bracket, a call `name(` (no space —
 * prose writes "Salt (to taste)"), an assignment or a code operator, a quoted
 * JSON key, a CSS declaration, or a statement keyword starting the line. Not
 * prose punctuation: `( ) ; :` on their own say nothing.
 */
const CODE_LINE = new RegExp([
  /[{}[\]]/.source,
  /[\w$\]]\(/.source,
  /[\w\])]\s*[-+*/%|&]?=\s*[^=\s]/.source,
  /==|!=|=>|->|::|&&|\|\|/.source,
  /^\s*"[^"\n]+"\s*:/.source,
  /^\s*[a-z-]+\s*:\s*[^;:\n]+;\s*$/.source,
  /^\s*(?:def|class|function|return|import|export|const|let|var|elif|fn|func|package|public|private|protected|static|#include|#!)\b/.source,
  /^\s*(?:if|for|while|switch|catch)\s*\(/.source,
  /^\s*(?:SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|ALTER|JOIN|ORDER BY|GROUP BY)\b/.source,
].join('|'))
/** A line of prose: four or more words, mostly plain words, ending the way a
 *  phrase or sentence ends. */
function proseLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/)
  const words = tokens.filter((w) => /^["“'(]?\p{L}[\p{L}'’-]*[.,;:!?"”’)]*$/u.test(w)).length
  return words >= 4 && words >= tokens.length * 0.6 && /[.,;:!?"”’)]$/.test(line.trim())
}
/** A spreadsheet's tab-separated cells: a tab after text, or two tabs. */
const TABLE_ROW = /\S\t|\t.*\t/

const nonEmpty = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())

/** Whether most lines of the text are prose: what the html check defers to,
 *  so a web page or a slide set in a monospace font is not taken for code. */
export function looksLikeProse(text: string): boolean {
  const lines = nonEmpty(text)
  return lines.length > 0 && lines.filter(proseLine).length * 2 >= lines.length
}

/**
 * Whether pasted plain text reads as code. Conservative on purpose — text is
 * the safe default, and a fence or the Code button is always there: two or
 * more lines, not a list, not a tab-separated table, not mostly prose, and at
 * least half of the lines (two at the least) carrying code (CODE_LINE).
 */
export function textLooksLikeCode(text: string): boolean {
  const lines = nonEmpty(text)
  if (lines.length < 2) return false
  const half = (n: number) => n * 2 >= lines.length
  if (half(lines.filter((l) => LIST_ITEM.test(l)).length)) return false
  if (half(lines.filter((l) => TABLE_ROW.test(l)).length)) return false
  if (looksLikeProse(text)) return false
  const code = lines.filter((l) => CODE_LINE.test(l)).length
  return code >= 2 && half(code)
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
  if (body.querySelector('table')) return false // a spreadsheet's cells, even in a monospace font
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

/**
 * [pattern, weight, signals]: what a match adds to a language's score, and
 * how many independent signals it counts as (default 1; 0 for a negative
 * weight, which is evidence AGAINST). A `g` pattern scores — and counts —
 * per match, at most three: three shell commands are three signals.
 */
type Rule = [RegExp, number, number?]

const RULES: Record<string, Rule[]> = {
  // `def f(x):` WITH an indented body is Python's shape on its own: two signals
  py: [[/^\s*def \w+\s*\(.*\)\s*(?:->.*)?:[ \t]*\n[ \t]+\S/m, 4, 2], [/^\s*class \w+(?:\(.*\))?:[ \t]*\n[ \t]+\S/m, 4, 2],
    [/^\s*(?:from [\w.]+ )?import [\w.]+(?:, [\w.]+)*\s*$/m, 2], [/^\s*(?:elif|except|finally|with)\b.*:\s*$/m, 3], [/^\s*(?:if|for|while) .*:\s*$/m, 2],
    [/\bself\b/, 1], [/\b(?:None|True|False)\b/, 1]],
  js: [[/\b(?:const|let|var) [\w$]+\s*(?::[^=\n]+)?=/, 2], [/=>/, 1], [/\bfunction\b\s*[\w$]*\s*\(/, 2], [/\bconsole\.\w+\(/, 3], [/\brequire\(['"]/, 2],
    [/\bmodule\.exports\b/, 3], [/^\s*import .+ from ['"]/m, 2], [/^\s*export (?:default |const |function )/m, 2], [/[!=]==/, 2], [/\b(?:document|window)\.\w/, 2]],
  sh: [[/^#!.*\b(?:ba|z|k)?sh\b/m, 6], [/^\s*(?:sudo |apt(?:-get)? |brew |npm |npx |yarn |pnpm |pip3? |git |cd |ls\b|echo |export \w+=|curl |wget |docker |mkdir |rm |chmod |source )/gm, 2],
    [/\b(?:fi|done|esac)\s*$/m, 3], [/^\s*for \w+ in .*; do\b/m, 3], [/\$\{?\w+\}?/, 1], [/^\s*\$ \w/m, 2]],
  // statement shapes at the start of a line, never the words: "Select the
  // slides from the panel" and "# select the first from the list" are not SQL
  sql: [[/^\s*select\s+(?:distinct\s+)?(?:\*|\w+(?:\.\w+)*(?:\s+as\s+\w+)?)(?:\s*,\s*(?:\*|\w+(?:\.\w+)*(?:\s+as\s+\w+)?))*\s+from\s+(?!(?:the|a|an|this|that|these|those|my|your|our|their|his|her|its)\b)\w+/im, 4],
    [/^\s*(?:insert\s+into\s+\w+|delete\s+from\s+\w+|create\s+table\s+\w+|alter\s+table\s+\w+|update\s+\w+\s+set\s+\w+\s*=)/im, 4],
    [/^\s*where\s+\w+(?:\.\w+)*\s*(?:[=<>!]|in\b|like\b|is\b|between\b)/im, 2], [/^\s*(?:order|group)\s+by\s+\w+(?:\.\w+)*(?:\s*,\s*\w+(?:\.\w+)*)*(?:\s+(?:asc|desc))?\s*;?\s*$/im, 2],
    [/^\s*(?:inner\s+|left\s+|right\s+)?join\s+\w+.*\bon\b/im, 2]],
  html: [[/<!doctype html/i, 6], [/<\/?(?:html|head|body|div|span|p|a|ul|ol|li|table|tr|td|script|style|section|h[1-6])\b[^>]*>/gi, 2], [/<\/\w+>/, 1]],
  xml: [[/^\s*<\?xml\b/, 6]],
  css: [[/^\s*[.#][\w-]+[^{}\n]*\{\s*$/m, 3], [/@(?:media|import|keyframes|font-face)\b/, 3], [/^\s*[a-z-]+\s*:\s*[^;{}\n]+;\s*$/gm, 2], [/:\s*[\d.]+(?:px|em|rem|%|vh|vw)\b/, 2]],
  // Swift and Kotlin share `func`: an arrow, a `let` or a `name: Type`
  // parameter says it is not Go
  go: [[/^\s*package \w+\s*$/m, 4], [/\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/, 4], [/:=/, 2], [/\bfmt\.\w+\(/, 4], [/^\s*import \(/m, 2],
    [/->/, -4, 0], [/\blet\s/, -4, 0], [/\(\s*\w+\s*:\s*[A-Z]/, -4, 0]],
  rust: [[/\bfn\s+\w+\s*(?:<[^>]*>)?\s*\(/, 4], [/\blet\s+mut\b/, 4], [/\b(?:println|format|vec|panic|macro_rules)!/, 4], [/\bimpl\b/, 2], [/\bpub fn\b/, 2], [/::\w/, 1]],
  java: [[/\bpublic\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum|void)\b/, 4], [/\bSystem\.(?:out|err)\.print/, 5], [/@Override\b/, 3], [/\bString\[\]/, 2],
    [/\b(?:private|protected)\s+(?:static\s+)?\w+(?:<[^>]*>)?\s+\w+\s*[;=]/, 2]],
  csharp: [[/^\s*using System(?:\.\w+)*;/m, 5], [/\bnamespace\s+[\w.]+/, 2], [/\bConsole\.Write(?:Line)?\(/, 5], [/\{\s*get;\s*(?:set;\s*)?\}/, 4], [/\bstatic void Main\(/, 3]],
  c: [[/^\s*#include\s*[<"]/m, 4], [/\bprintf\s*\(/, 2], [/\bint\s+main\s*\(/, 2], [/\b(?:malloc|free|sizeof)\s*\(/, 2]],
  ruby: [[/^\s*def \w+[?!]?(?:\s*\(.*\))?\s*$/m, 3], [/^\s*end\s*$/m, 3], [/\bputs\b/, 2], [/\bdo\s*\|[\w, ]+\|/, 3], [/^\s*require ['"]/m, 2], [/#\{\w+\}/, 2],
    [/\battr_(?:reader|accessor|writer)\b/, 3], [/\bdefmodule\b|\|>/, -6, 0]],
  elixir: [[/\bdefmodule\s+[A-Z]/, 5], [/^\s*defp? \w+.*\bdo\s*$/m, 3], [/\bIO\.\w+/, 3], [/\|>/, 2], [/\bfn\s+\w+\s*->/, 2]],
  php: [[/<\?php/, 8], [/\$\w+\s*=/, 2], [/\$this->/, 3], [/\becho\b/, 1], [/\bfunction\s+\w+\s*\(\s*\$/, 3]],
  powershell: [[/\b(?:Get|Set|New|Remove|Write|Read|Invoke|Start|Stop|Test|Import|Export|Select|Where|ForEach)-[A-Z]\w+/, 4], [/\s-(?:eq|ne|gt|lt|ge|le|like|match)\s/, 2],
    [/^\s*param\s*\(/im, 3], [/^\s*\$\w+\s*=/m, 1]],
  diff: [[/^(?:---|\+\+\+) \S/gm, 3], [/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m, 5]],
  dockerfile: [[/^\s*FROM\s+\S+/m, 3], [/^\s*(?:RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|EXPOSE|ENV|ARG)\s/gm, 2]],
}
/** Patterns that only ever ADD to a base language: TypeScript is JavaScript
 *  plus these, C++ is C plus these. Without one of them it is the base. */
const ON_TOP: Record<string, [string, Rule[]]> = {
  ts: ['js', [[/:\s*(?:string|number|boolean|void|any|unknown|never)\b/, 3], [/^\s*(?:export )?interface \w+/m, 3], [/^\s*(?:export )?type \w+\s*=/m, 2], [/\bas const\b/, 2]]],
  cpp: ['c', [[/\bstd::/, 4], [/\b(?:cout|cin|cerr)\s*<</, 3], [/\btemplate\s*</, 3], [/^\s*#include\s*<(?:iostream|vector|string|map|memory|algorithm)>/m, 3]]],
}

type Tally = { score: number; signals: number }

function tally(text: string, rules: Rule[]): Tally {
  const t = { score: 0, signals: 0 }
  for (const [re, w, signals = w > 0 ? 1 : 0] of rules) {
    const hits = re.global ? Math.min(3, text.match(re)?.length ?? 0) : re.test(text) ? 1 : 0
    t.score += w * hits
    t.signals += signals * hits
  }
  return t
}

/** JSON is the one language a parser can confirm (counted as two signals). */
function isJson(text: string): boolean {
  const t = text.trim()
  if (!/^[[{]/.test(t)) return false
  try { JSON.parse(t); return true } catch { return false }
}

/** YAML: most lines are `key: value` (or `- key: value`), none ends like a
 *  C-family statement, and at least one key is NESTED under another. Flat
 *  `Label: value` lines are what console output and forms look like. */
function yamlTally(text: string): Tally {
  const lines = text.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l))
  const none = { score: 0, signals: 0 }
  if (lines.length < 3 || lines.some((l) => /[;{}]\s*$/.test(l))) return none
  const kv = lines.filter((l) => /^\s*(?:- )?[\w.-]+:(?:\s|$)/.test(l))
  if (kv.length < lines.length * 0.6 || !kv.some((l) => /^\s+\S/.test(l)) || !/^[\w.-]+:\s*$/m.test(text)) return none
  return { score: 4 + (/^---\s*$/m.test(text) ? 2 : 0), signals: 2 }
}

/**
 * The built-in grammar a piece of code is written in, or undefined unless one
 * language clearly wins: at least two independent signals, a score of 4 or
 * more, and 2 clear of the runner-up. Ids are the Language menu's (the
 * tokenizer's LANGS keys, plus diff).
 */
export function guessLanguage(code: string): string | undefined {
  const text = code.replace(/\r\n?/g, '\n').slice(0, 20000)
  if (!text.trim()) return undefined
  const all: Record<string, Tally> = {}
  for (const [lang, rules] of Object.entries(RULES)) all[lang] = tally(text, rules)
  for (const [lang, [base, rules]] of Object.entries(ON_TOP)) {
    const extra = tally(text, rules)
    all[lang] = extra.score > 0 ? { score: all[base].score + extra.score, signals: all[base].signals + extra.signals } : { score: 0, signals: 0 }
  }
  if (isJson(text)) all.json = { score: 8, signals: 2 }
  all.yaml = yamlTally(text)
  const ranked = Object.entries(all).sort((a, b) => b[1].score - a[1].score)
  const [[lang, best], second] = ranked
  return best.signals >= 2 && best.score >= 4 && best.score - (second?.[1].score ?? 0) >= 2 ? lang : undefined
}

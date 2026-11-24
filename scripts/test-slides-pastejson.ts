#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Replace from JSON… takes a chatbot's reply: the repairs and the reasons.
//
//   node scripts/test-slides-pastejson.ts
//
// WHAT THIS PROVES (slides/src/editor/pastejson.ts):
//   1. A reply in a Markdown fence, after a sentence, or with trailing commas
//      comes out as the same document, and every repair is named.
//   2. The repairs only REMOVE characters: the cleaned JSON is a subsequence of
//      the pasted text, so no content is ever invented.
//   3. Strings are data: `}`, `,]`, fences and escaped quotes inside a string
//      are never repaired.
//   4. A reply cut off ANYWHERE — every prefix of the starter deck's JSON, bare
//      and in an unclosed fence — is refused as cut off, never as a syntax error
//      and never closed up; a real syntax error names its line and column in
//      the text as pasted; nothing, prose, a non-document and a document with
//      no slides each get their own reason.
//   5. The summary counts slides added, removed and changed by id, and edited
//      elements, ignoring key order.

import { cleanPastedJson, docRejection, summarizeReplace, same, lineCol, type Cleaned } from '../slides/src/editor/pastejson.ts'
import { starterDoc } from '../slides/src/starterdeck.ts'

let checks = 0
let failures = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const subsequence = (small: string, big: string): boolean => {
  let j = 0
  for (let i = 0; i < big.length && j < small.length; i++) if (big[i] === small[j]) j++
  return j === small.length
}
const parsesTo = (c: Cleaned, want: unknown): boolean => {
  if (c.error) return false
  try { return same(JSON.parse(c.json), want) } catch { return false }
}

const deck = starterDoc()
const full = JSON.stringify(deck)
const pretty = JSON.stringify(deck, null, 2)

console.log('\n1. Repairs a chatbot reply needs\n')
const table: [string, string, string[], unknown][] = [
  ['plain JSON', full, [], deck],
  ['pretty-printed JSON', pretty, [], deck],
  ['a ```json fence', '```json\n' + full + '\n```', ['fence'], deck],
  ['a bare ``` fence, CRLF line ends', '```\r\n' + pretty.replace(/\n/g, '\r\n') + '\r\n```\r\n', ['fence'], deck],
  ['a ~~~ fence', '~~~json\n' + pretty + '\n~~~', ['fence'], deck],
  ['a sentence, then a fence', 'Here is your updated deck:\n\n```json\n' + pretty + '\n```', ['fence', 'prose'], deck],
  ['a fence, then a sentence', '```json\n' + full + '\n```\n\nLet me know if you want more changes!', ['fence', 'prose'], deck],
  ['a shell snippet fence first, the JSON fence second', 'Run:\n```bash\nls {a,b}\n```\nThen paste:\n```json\n' + full + '\n```', ['fence', 'prose'], deck],
  ['prose around bare JSON', 'Sure! {curly} braces aside, here it is: ' + full + ' Hope this helps.', ['prose'], deck],
  ['a trailing comma before the last }', full.replace(/\}$/, ',}'), ['commas'], deck],
  ['trailing commas in arrays and objects, pretty', pretty.replace(/\n(\s*)\]/g, ',\n$1]').replace(/("title": "[^"]*")\n/, '$1,\n'), ['commas'], deck],
]
for (const [name, text, repaired, want] of table) {
  const c = cleanPastedJson(text)
  ok(parsesTo(c, want) && JSON.stringify(c.repaired) === JSON.stringify(repaired), `${name}: loads, repairs named ${JSON.stringify(c.repaired)}${c.error ? ' ERROR ' + JSON.stringify(c.error) : ''}`)
  ok(subsequence(c.json, text), `${name}: the cleaned text only removes characters`)
}
{
  const c = cleanPastedJson('{"a":[1,2,],"b":{"c":3,},}')
  ok(c.commas === 3 && c.json === '{"a":[1,2],"b":{"c":3}}', `three trailing commas removed and counted (${c.commas}: ${c.json})`)
}

console.log('\n2. Strings are data\n')
const strings: [string, string, unknown, number][] = [
  ['`}` and `,]` inside a string', '{"a":"x,]}","b":[1,],}', { a: 'x,]}', b: [1] }, 2],
  ['an escaped quote then `,}`', '{"a":"he said \\",}\\"","b":2}', { a: 'he said ",}"', b: 2 }, 0],
  ['a fence and a brace inside a string', '{"md":"```json\\n{\\"x\\":1,}\\n```"}', { md: '```json\n{"x":1,}\n```' }, 0],
  ['unicode escapes and a backslash at a string end', '{"a":"\\u00e9\\\\","b":[]}', { a: 'é\\', b: [] }, 0],
]
for (const [name, text, want, commas] of strings) {
  const c = cleanPastedJson(text)
  ok(parsesTo(c, want) && c.commas === commas, `${name}: ${c.error ? JSON.stringify(c.error) : c.json}`)
}

console.log('\n3. Cut off anywhere is "cut off"\n')
{
  const small = JSON.stringify({ format: 'bento/slides', title: 'Q3 "best" \\ year', n: -12.5e+3, t: true, f: false, z: null, u: 'é', slides: [{ id: 's1', elements: [{ id: 'e1', html: 'a,]}' }, {}] }, []] })
  const bad: string[] = []
  for (let k = 1; k < small.length; k++) {
    const e = cleanPastedJson(small.slice(0, k)).error
    if (e?.code !== 'cut-off') bad.push(`${k}:${e?.code ?? 'accepted'}`)
  }
  ok(!bad.length, `every one of ${small.length - 1} prefixes of a dense document is refused as cut off${bad.length ? ' — ' + bad.slice(0, 6).join(' ') : ''}`)
  let wrong = 0
  const step = Math.max(1, Math.floor(full.length / 3000))
  for (let k = 1; k < full.length; k += step) if (cleanPastedJson(full.slice(0, k)).error?.code !== 'cut-off') wrong++
  ok(wrong === 0, `the starter deck cut at ${Math.ceil(full.length / step)} points: all refused as cut off (${wrong} not)`)
  const at60 = cleanPastedJson('Here you go:\n```json\n' + pretty.slice(0, Math.floor(pretty.length * 0.6)))
  ok(at60.error?.code === 'cut-off' && at60.json === '', 'cut at 60% inside a fence the reply never closed: cut off, nothing to apply')
  const closedFence = cleanPastedJson('```json\n' + pretty.slice(0, Math.floor(pretty.length * 0.6)) + '\n```')
  ok(closedFence.error?.code === 'cut-off', 'cut at 60% with the fence closed after it: still cut off')
}

console.log('\n4. Reasons\n')
{
  const text = 'Here it is:\n```json\n{\n  "format": "bento/slides",\n  "title": "x"\n  "slides": []\n}\n```'
  const e = cleanPastedJson(text).error
  ok(e?.code === 'syntax' && e.line === 6 && e.col === 3, `a missing comma: syntax error at line 6, column 3 of the pasted text (${JSON.stringify(e)})`)
  const e2 = cleanPastedJson('{"a": 1, "b": tru, "c": 2}').error
  ok(e2?.code === 'syntax' && e2.line === 1 && e2.col === 15, `a misspelt literal mid-text is a syntax error, not a cut-off (${JSON.stringify(e2)})`)
  const e3 = cleanPastedJson('{"a": "line one\nline two"}').error
  ok(e3?.code === 'syntax' && e3.line === 1, `a raw line break inside a string is a syntax error (${JSON.stringify(e3)})`)
  const e4 = cleanPastedJson("{'a': 1}").error
  ok(e4?.code === 'syntax' && e4.col === 2, `single quotes: syntax error at column 2 (${JSON.stringify(e4)})`)
  ok(cleanPastedJson('').error?.code === 'empty' && cleanPastedJson(' \n\t ').error?.code === 'empty', 'nothing (or only white space): empty')
  ok(cleanPastedJson('Sorry, I cannot help with that.').error?.code === 'no-json', 'prose with no object: no JSON found')
  ok(cleanPastedJson('[1, 2, 3]').error?.code === 'no-json', 'an array: no JSON object found')
  const hello = cleanPastedJson('{"hello": "world"}')
  ok(!hello.error && docRejection(hello.json).code === 'not-document', '{"hello": "world"} parses, and is not a document')
  ok(docRejection('{"format":"bento/spaces","pages":[]}').code === 'not-document', 'another bento format: not a bento/slides document')
  ok(docRejection('{"format":"bento/slides","slides":[]}').code === 'no-slides', 'a slides document with no slides: no slides')
  ok(docRejection('{"compact":true}').code === 'no-slides', 'a compact document with no slides: no slides')
  ok(docRejection('{"format":"bento/slides","slides":[{"id":"s1","elements":[]}]}').code === 'no-slides', 'a document every slide of which the gate refused: no usable slides')
  ok(lineCol('ab\ncd', 4).line === 2 && lineCol('ab\ncd', 4).col === 2, 'lineCol is 1-based')
}

console.log('\n5. The summary\n')
{
  const live = { slides: [
    { id: 'a', elements: [{ id: 'x', v: 1 }, { id: 'y', v: 1 }] },
    { id: 'b', elements: [{ id: 'x', v: 1 }] },
    { id: 'c', elements: [] },
  ] }
  const next = { slides: [
    { elements: [{ v: 2, id: 'x' }, { id: 'z', v: 1 }], id: 'a' }, // x edited, y removed, z added
    { elements: [{ v: 1, id: 'x' }], id: 'b' }, // same, keys reordered
    { id: 'd', elements: [] },
  ] }
  const s = summarizeReplace(live, next)
  ok(s.before === 3 && s.after === 3, 'slide counts before and after')
  ok(JSON.stringify(s.added) === '["d"]' && JSON.stringify(s.removed) === '["c"]' && JSON.stringify(s.changed) === '["a"]', `added d, removed c, changed a only — key order ignored (${JSON.stringify(s)})`)
  ok(s.elements === 3, `three element changes on slide a: edited, removed, added (${s.elements})`)
  const resig = { slides: [{ id: 'a', elements: [{ id: 'x', component: { id: 'c', key: 'k0', sig: 'abc' } }] }] }
  const resigned = { slides: [{ id: 'a', elements: [{ id: 'x', component: { key: 'k0', id: 'c', sig: 'xyz' } }] }] }
  ok(!summarizeReplace(resig, resigned).changed.length, 'a component copy whose derived sig was recomputed is not a change')
  ok(summarizeReplace(resig, { slides: [{ id: 'a', elements: [{ id: 'x', component: { id: 'c', key: 'k1', sig: 'abc' } }] }] }).changed.length === 1, '…but any other change to it is')
  ok(!same({ a: 1, sig: 2 }, { a: 1, sig: 3 }), 'sig is only skipped inside a component')
  const self = summarizeReplace(deck, JSON.parse(full))
  ok(!self.added.length && !self.removed.length && !self.changed.length && self.elements === 0, 'the deck against its own JSON: no changes')
  const half = JSON.parse(full)
  half.slides = half.slides.slice(0, Math.ceil(half.slides.length / 2))
  const h = summarizeReplace(deck, half)
  ok(h.removed.length === deck.slides.length - half.slides.length && h.removed[0] === deck.slides[half.slides.length].id, `half the slides: ${h.removed.length} removed, named by id`)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)

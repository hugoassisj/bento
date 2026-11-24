#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The DOM-free rules behind code typed and pasted onto a slide
// (slides/src/editor/codepaste.ts, slides/src/editor/codeedit.ts):
//
//   node scripts/test-slides-code-paste.ts
//
// WHAT THIS PROVES. Which plain text pasted onto the canvas counts as code
// (half its lines or more carry code: braces, calls, assignments, statement
// keywords) and which stays text (a sentence, a single line, a URL, lists,
// spreadsheet tables, CSV, an indented address, poem, quote, signature,
// recipe or legal clauses, prose with arithmetic); which built-in language a
// piece of code is guessed to be, and that one signal, a tie or prose in a
// fence is no guess; that
// a fence with no language tag gets the guess while an explicit tag wins; and
// how Tab, Shift+Tab and Enter change the lines of a code block being edited.
// test-slides-code-tab-browser.mjs drives the same rules through the editor.

import { LANGS } from '../kernel/src/tokenize.ts'
import { CODE_INDENT, indentLines, lineIndent, outdentLines } from '../slides/src/editor/codeedit.ts'
import { splitFences } from '../slides/src/editor/codefence.ts'
import { guessLanguage, textLooksLikeCode } from '../slides/src/editor/codepaste.ts'

let failures = 0, checks = 0
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`) }
const show = (s: string) => JSON.stringify(s.length > 40 ? s.slice(0, 40) + '…' : s)

console.log('\ntextLooksLikeCode\n')
const cases: [string, boolean, string][] = [
  ['def area(r):\n    import math\n    return math.pi * r ** 2', true, 'the Python sample (indented lines, a colon)'],
  ['function f(a) {\n  if (a) {\n    return 1\n  }\n  return 0\n}', true, 'JavaScript, two-space indent'],
  ['func main() {\n\tfmt.Println("hi")\n}', true, 'Go, tab indent'],
  ['int a = 1;\nint b = 2;\nreturn a + b;', true, 'C statements, no indent, semicolons ending every line'],
  ['.card {\n  color: red;\n  padding: 4px;\n}', true, 'a CSS rule'],
  ['{\n  "name": "bento",\n  "private": true\n}', true, 'a JSON object'],
  ['SELECT name\n  FROM users\n  WHERE id = 1;', true, 'indented SQL'],
  ['Revenue grew in every region this quarter.', false, 'a sentence'],
  ['const x = 1;', false, 'a single line, even of code'],
  ['https://bento.page/schema/slides.json', false, 'a URL'],
  ['Revenue grew in every region.\nCosts held flat for the third quarter.', false, 'two lines of prose'],
  ['- one\n- two\n- three', false, 'a bulleted list'],
  ['- Goals:\n  - ship (on time)\n  - hire', false, 'a nested bulleted list with punctuation'],
  ['1. Plan\n2. Build\n3. Ship', false, 'a numbered list'],
  ['• Plan\n• Build', false, 'a list of bullet glyphs'],
  ['Ada Lovelace\n  12 St James Square\n  London', false, 'an indented address'],
  ['The fog comes\n    on little cat feet.\n  It sits looking', false, 'an indented poem'],
  ['Agenda:\nIntro\nQuestions', false, 'a heading with a colon over lines'],
  ['', false, 'nothing'],
  // review round 1: prose and tables that looked like code to the first rules
  ['Region\tRevenue (USD)\tQ2\n\tNorth\t10\n\tSouth\t12', false, 'a spreadsheet table with blanks in the first column'],
  ['Item\tMonthly\tYearly\n\tRent\t=B2*12\n\tPower\t=B3*12', false, 'a spreadsheet table with formulas'],
  ['I wandered lonely as a cloud\n    That floats on high o\'er vales and hills,\n  When all at once I saw a crowd,\n    A host, of golden daffodils;', false, 'indented poetry'],
  ['As the report put it:\n    "Growth will continue."\n    — Annual Report 2025', false, 'an indented quote'],
  ['Best regards,\n  Jane Doe\n  Acme Corp (London)', false, 'an indented signature'],
  ['Ingredients:\n  2 cups flour\n  1 egg\n  Salt (to taste)', false, 'a recipe'],
  ['name;age;city;\nAnn;31;Paris;\nBo;42;Oslo;', false, 'semicolon CSV'],
  ['The Licensee shall:\n  (a) pay the fees (in full);\n  (b) keep the records; and\n  (c) comply with the law.', false, 'an indented legal clause list'],
  ['Shall I compare thee to a summer\'s day;\nThou art more lovely and more temperate;\nRough winds do shake the darling buds of May;', false, 'a poem with lines ending in ;'],
  ['Let x = 5 and y = 3 in the example.\nThen x + y = 8, as the table shows.', false, 'prose with arithmetic'],
]
for (const [text, want, what] of cases) ok(textLooksLikeCode(text) === want, `${what} → ${want ? 'code' : 'text'} ${show(text)}`)

console.log('\nguessLanguage\n')
const langs: [string, string | undefined][] = [
  ['def area(r):\n    import math\n    return math.pi * r ** 2', 'py'],
  ['class Point:\n    def __init__(self, x):\n        self.x = x', 'py'],
  ['const total = items.reduce((a, b) => a + b, 0)\nconsole.log(total)', 'js'],
  ['function add(a, b) {\n  return a + b\n}\nmodule.exports = add', 'js'],
  ['interface User {\n  name: string\n  age: number\n}\nconst u: User = load()', 'ts'],
  ['#!/bin/bash\nfor f in *.txt; do\n  echo "$f"\ndone', 'sh'],
  ['npm install\ngit commit -m "first"\ncd slides', 'sh'],
  ['SELECT name, total\nFROM orders\nWHERE total > 100\nORDER BY total DESC;', 'sql'],
  ['<!doctype html>\n<html>\n  <body><p>Hi</p></body>\n</html>', 'html'],
  ['.card {\n  color: red;\n  padding: 4px;\n}', 'css'],
  ['{\n  "name": "bento",\n  "private": true\n}', 'json'],
  ['package main\n\nfunc main() {\n\tx := 1\n\tfmt.Println(x)\n}', 'go'],
  ['fn main() {\n    let mut v = vec![1, 2];\n    println!("{:?}", v);\n}', 'rust'],
  ['public class Hello {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}', 'java'],
  ['#include <stdio.h>\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}', 'c'],
  ['#include <iostream>\nint main() {\n  std::cout << "hi";\n}', 'cpp'],
  ['using System;\nclass P {\n  static void Main() { Console.WriteLine("hi"); }\n}', 'csharp'],
  ['def greet(name)\n  puts "hi #{name}"\nend', 'ruby'],
  ['<?php\n$name = "bento";\necho $name;', 'php'],
  ['--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new', 'diff'],
  ['FROM node:22\nWORKDIR /app\nRUN npm ci', 'dockerfile'],
  ['name: bento\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest', 'yaml'],
  ['Revenue grew in every region.\nCosts held flat.', undefined],
  ['x = 1', undefined],
  ['', undefined],
  // review round 1: one rule is not evidence
  ['func greet(name: String) -> String {\n    return "Hello, " + name\n}', undefined],
  ["import { select } from 'd3';", undefined],
  ['defmodule Greeter do\n  def hello(name) do\n    IO.puts("Hello #{name}")\n  end\nend', 'elixir'],
  ['$x = 5', undefined],
  ['$x = 5\nWrite-Host $x', 'powershell'],
  ['Status: ok\nTests: 12 passed\nTime: 1.2s', undefined],
  ['$ npm test\n> bento@1.3.0 test\n12 passing', undefined],
  ['Select the slides you want from the panel,\nthen press Delete where it says so.', undefined],
  ['Order by Friday.\nSelect two from the list.', undefined],
  ['def first(items):\n    # select the first from the list\n    return items[0]', 'py'],
]
for (const [text, want] of langs) ok(guessLanguage(text) === want, `${show(text)} → ${want ?? 'no guess'} (${guessLanguage(text) ?? 'no guess'})`)
const every = langs.map(([s]) => guessLanguage(s)).filter((l): l is string => !!l)
ok(every.every((l) => l in LANGS || l === 'diff' || l === 'md'), 'every guess is a language the Language menu lists')

console.log('\na fence\'s language\n')
const fence = (s: string) => (splitFences(s)[0] as { lang?: string }).lang
ok(fence('```\ndef area(r):\n    return r * r\n```') === 'py', 'no tag → the guess (py)')
ok(fence('```js\ndef area(r):\n    return r * r\n```') === 'js', 'an explicit tag wins over the guess')
ok(fence('```nosuchlang\ndef area(r):\n    return r * r\n```') === undefined, 'an unknown tag is not overridden by a guess')
ok(fence('```\nplain\n```') === undefined, 'no tag and nothing to go on → unset')

console.log('\nTab, Shift+Tab, Enter on code lines\n')
ok(CODE_INDENT === '  ', 'one level is two spaces (the starter deck\'s code)')
const t = 'if (a) {\nb()\n  c()\n}'
const allIn = indentLines(t, 0, t.length)
ok(allIn.text === '  if (a) {\n  b()\n    c()\n  }', `a selection over every line indents each (${JSON.stringify(allIn.text)})`)
ok(allIn.start === 0 && allIn.end === allIn.text.length, 'and the indented lines stay selected')
const allOut = outdentLines(allIn.text, allIn.start, allIn.end)
ok(allOut.text === t, `outdenting them again gives the original (${JSON.stringify(allOut.text)})`)
const two = indentLines(t, t.indexOf('b'), t.indexOf('c') + 1)
ok(two.text === 'if (a) {\n  b()\n    c()\n}', `a selection over lines 2–3 indents only those (${JSON.stringify(two.text)})`)
const endAtLineStart = indentLines(t, 0, t.indexOf('b'))
ok(endAtLineStart.text === '  if (a) {\nb()\n  c()\n}', 'a selection ending at the start of a line leaves that line alone')
const blank = indentLines('a\n\nb', 0, 4)
ok(blank.text === '  a\n\n  b', 'an empty line gets no trailing spaces')
const caret = outdentLines('x\n    y', 6, 6)
ok(caret.text === 'x\n  y' && caret.start === 4 && caret.end === 4, `Shift+Tab with a caret outdents its line and the caret moves with the text (${JSON.stringify(caret)})`)
const inIndent = outdentLines('    y', 1, 1)
ok(inIndent.text === '  y' && inIndent.start === 0, 'a caret inside the removed indent lands at the line start')
ok(outdentLines('\ty', 2, 2).text === 'y', 'a tab is one level')
ok(outdentLines(' y', 2, 2).text === 'y', 'a single space outdents to nothing')
const flat = outdentLines('y\nz', 0, 3)
ok(flat.text === 'y\nz' && flat.start === 0 && flat.end === 3, 'nothing to outdent → nothing changes')
ok(lineIndent('a\n    b(', 9) === '    ', 'Enter carries the line\'s indentation')
ok(lineIndent('a\n    b', 4) === '  ', 'only as much of it as sits before the caret')
ok(lineIndent('a\n\tb', 4) === '\t', 'tabs are kept as tabs')
ok(lineIndent('abc', 3) === '', 'no indentation → none')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

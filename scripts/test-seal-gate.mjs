#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The release gate refuses a sealed TEST shell, and passes the release shell
// built from the same source (security §31). This is the positive control for
// shell-gate.mjs's checkNoTestSeal: a gate that never sees the hook would pass
// every release shell vacuously. The test shell must be refused FOR THE HOOK,
// not for anything else, and the release shell must pass because the build
// removed the hook, not because the scan missed it.
//
//   npm run build:single --prefix slides && npm run build:sealtest --prefix slides
//   node scripts/test-seal-gate.mjs

import { readFileSync } from 'node:fs'
import { gateShell, checkNoTestSeal } from './shell-gate.mjs'

const release = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url)
const sealtest = new URL('../slides/dist-sealtest/Bento_Slides.bento.html', import.meta.url)

let failures = 0, checks = 0
const ok = (cond, what) => { checks++; if (cond) console.log('  ok    ' + what); else { failures++; console.log('  FAIL  ' + what) } }
const refusal = (fn) => { try { fn(); return null } catch (e) { return String(e.message) } }

const testHtml = readFileSync(sealtest, 'utf8')
const releaseHtml = readFileSync(release, 'utf8')

const r1 = refusal(() => gateShell(sealtest.pathname))
ok(r1 !== null && r1.includes('sealed-test key handoff'), `the full gate refuses the build:sealtest shell, for the hook (${r1 ?? 'passed'})`)
ok(r1 !== null && r1.includes('payload #'), 'it found the hook INSIDE a deflated payload: a plain scan of the HTML would not')
ok(!testHtml.includes('__bento' + 'TestSeal'), 'control: the hook is not visible in the raw HTML of the test shell')
ok(refusal(() => checkNoTestSeal(releaseHtml)) === null, 'the release shell carries no hook')
ok(refusal(() => gateShell(release.pathname)) === null, 'the full gate passes the release shell')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

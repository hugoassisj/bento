#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// bento.page's passkey association files: scripts/well-known.mjs never
// publishes a placeholder, writes only what it was given, and refuses values
// of the wrong shape.
//
//   node scripts/test-well-known.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let fails = 0, passes = 0
const ok = (c: unknown, n: string) => { if (c) passes++; else { fails++; console.log('FAIL ' + n) } }
const run = (args: string[]) => {
  try { return { code: 0, out: execFileSync('node', ['scripts/well-known.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } } catch (e) {
    const err = e as { status?: number; stderr?: string }
    return { code: err.status ?? 1, out: String(err.stderr ?? '') }
  }
}
const TEAM = 'AB12CD34EF'
const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':')
const tmp = () => mkdtempSync(join(tmpdir(), 'wk-'))
const read = (d: string, f: string) => readFileSync(join(d, '.well-known', f), 'utf8')

// templates: valid JSON, each carries its placeholder, the real app id
for (const f of ['assetlinks.json', 'apple-app-site-association']) {
  const t = readFileSync(join('site-src/well-known', f), 'utf8')
  let parsed = false
  try { JSON.parse(t); parsed = true } catch { /* */ }
  ok(parsed, `${f}: template is valid JSON`)
  ok(/__[A-Z0-9_]+__/.test(t), `${f}: template is marked with a placeholder`)
  ok(t.includes('page.bento.home'), `${f}: names the bento/home app (page.bento.home)`)
}

// no values: checks the templates, writes nothing
{
  const d = tmp()
  const r = run(['--out', d])
  ok(r.code === 0 && !existsSync(join(d, '.well-known')), 'no values → nothing written')
  rmSync(d, { recursive: true, force: true })
}

// both values: exact, placeholder-free, valid JSON with the right shapes
{
  const d = tmp()
  const r = run(['--out', d, '--apple-team', TEAM, '--play-sha256', FP.toLowerCase()])
  ok(r.code === 0, `both values → success (${r.out.trim()})`)
  const aasa = JSON.parse(read(d, 'apple-app-site-association'))
  ok(JSON.stringify(aasa.webcredentials.apps) === JSON.stringify([`${TEAM}.page.bento.home`]), 'AASA: webcredentials app is TEAMID.page.bento.home')
  const al = JSON.parse(read(d, 'assetlinks.json'))
  ok(al[0].relation.includes('delegate_permission/common.get_login_creds'), 'assetlinks: get_login_creds (passkeys)')
  ok(al[0].target.package_name === 'page.bento.home', 'assetlinks: package page.bento.home')
  ok(al[0].target.sha256_cert_fingerprints[0] === FP, 'assetlinks: fingerprint normalised to uppercase')
  for (const f of ['assetlinks.json', 'apple-app-site-association']) ok(!/__[A-Z0-9_]+__/.test(read(d, f)), `${f}: no placeholder in the output`)
  rmSync(d, { recursive: true, force: true })
}

// one value: writes ONLY that file (M1 and M2 may arrive at different times)
{
  const d = tmp()
  ok(run(['--out', d, '--apple-team', TEAM]).code === 0, 'Apple id only → success')
  ok(existsSync(join(d, '.well-known/apple-app-site-association')) && !existsSync(join(d, '.well-known/assetlinks.json')), 'Apple id only → assetlinks.json NOT written')
  rmSync(d, { recursive: true, force: true })
}

// wrong shapes are refused, and refusal writes nothing
for (const [flag, bad, name] of [
  ['--apple-team', 'abc', 'short team id'], ['--apple-team', '__APPLE_TEAM_ID__', 'the placeholder itself'],
  ['--play-sha256', 'AA:BB', 'short fingerprint'], ['--play-sha256', FP.replace(/:/g, ''), 'fingerprint without colons'],
  ['--play-sha256', '__PLAY_APP_SIGNING_SHA256__', 'the placeholder itself'],
]) {
  const d = tmp()
  const r = run(['--out', d, flag, bad])
  ok(r.code !== 0 && !existsSync(join(d, '.well-known')), `refused: ${name}`)
  rmSync(d, { recursive: true, force: true })
}

console.log(`${passes} passed, ${fails} failed`)
process.exit(fails)

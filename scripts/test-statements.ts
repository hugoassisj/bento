#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// bento/id statements rig: kernel/src/statements.ts + kernel/src/address.ts
// against the conformance vectors in kernel/fixtures/identity-v1.json.
//
//   node scripts/test-statements.ts
//
// WHAT THIS PROVES. Every host (Swift, Kotlin, Rust, the extension and the
// directory) is told to pass the fixture. That instruction is only worth
// something if the REFERENCE passes it too, row by row, for the stated reason.
// Beyond the rows, every accepted statement is tampered with three ways
// (signature, an extra field, one byte of text) and must then be refused, and
// every builder must reproduce the exact text it was parsed from.
// It also pins that the attack rows security's §22/§24 check runs (replay,
// relay, payload swap, docId swap, expiry) and the grammar refusals exist, so
// deleting a row cannot quietly shrink the contract.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyDev, verifyBind, verifyAtt, verifyTomb, verifyDel, verifyCmp, verifyConsent,
  buildDev, buildBind, buildAtt, buildTomb, buildDel, buildCmp, buildConsent,
  consentTranscript, webauthnChallengeFor, lowS, verifyStatementSig, payloadMatchesPurpose,
  b64uDec, b64uEnc, KX_MODE, RESERVED_PREFIXES, type Verdict, type KxMode,
} from '../kernel/src/statements.ts'
import { normalizeAddress } from '../kernel/src/address.ts'
import type { SignPurpose } from '../kernel/src/identity.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const F = JSON.parse(readFileSync(join(root, 'kernel/fixtures/identity-v1.json'), 'utf8'))
type Row = Record<string, unknown> & { name: string; type: string; text: string; sig: string; expect: 'accept' | 'reject'; reason?: string }

async function check(r: Row, text = r.text, sig = r.sig): Promise<Verdict<unknown>> {
  const now = (r.now as number) ?? F.now
  const kxMode = (r.kxMode as KxMode) ?? F.kxModeDefault
  switch (r.type) {
    case 'dev': return verifyDev(text, sig, { now, kxMode })
    case 'bind': return verifyBind(text, sig, { now, kxMode })
    case 'att': return verifyAtt(text, sig, { directoryKeys: F.directoryKeys, bindText: r.bindText as string, now, maxAgeMs: r.maxAgeMs as number })
    case 'tomb': return verifyTomb(text, sig, { directoryKeys: F.directoryKeys, now })
    case 'del': return verifyDel(text, sig, { accountPub: F.keys.account, now })
    case 'cmp': return verifyCmp(text, sig, { accountPub: F.keys.account, bindText: r.bindText as string })
    case 'cns': return verifyConsent(text, sig, {
      consentPub: F.keys.consent, rp: r.rp as string, audience: r.audience as string, challenge: r.challenge as string,
      payloadText: r.payloadText as string, docId: (r.docId as string | null) ?? null, now,
      spend: () => !r.challengeSpent,
    })
    default: throw new Error(`unknown row type ${r.type}`)
  }
}

function rebuild(type: string, v: unknown): string | null {
  const x = v as never
  switch (type) {
    case 'dev': return buildDev(x)
    case 'bind': return buildBind(x)
    case 'att': return buildAtt(x)
    case 'tomb': return buildTomb(x)
    case 'del': { const d = v as { address: string; ts: number }; return buildDel(d.address, d.ts) }
    case 'cmp': { const c = v as { bindHash: string; code: string }; return buildCmp(c.bindHash, c.code) }
    case 'cns': return buildConsent(x)
    default: return null
  }
}

console.log(`\nthe reference passes every statement row (${F.statements.length})`)
for (const r of F.statements as Row[]) {
  const v = await check(r)
  const got = v.ok ? 'accept' : `reject:${v.reason}`
  const want = r.expect === 'accept' ? 'accept' : `reject:${r.reason}`
  ok(got === want, `${r.name} → ${want}${got === want ? '' : ` (got ${got})`}`)
}

console.log('\nevery accepted statement round-trips, and refuses tampering')
for (const r of (F.statements as Row[]).filter((r) => r.expect === 'accept')) {
  const v = await check(r)
  if (!v.ok) continue
  ok(rebuild(r.type, v.value) === r.text, `${r.type}: the builder reproduces the exact text (${r.name})`)
  const sig = b64uDec(r.sig)!
  sig[10] ^= 0x01
  ok(!(await check(r, r.text, b64uEnc(sig))).ok, `${r.type}: a flipped signature bit is refused`)
  ok(!(await check(r, r.text + '.x', r.sig)).ok, `${r.type}: an extra field is refused`)
  const i = r.text.length - 2
  const flipped = r.text.slice(0, i) + (r.text[i] === '1' ? '2' : '1') + r.text.slice(i + 1)
  ok(!(await check(r, flipped, r.sig)).ok, `${r.type}: one changed byte of text is refused`)
}

console.log('\nthe contract cannot quietly shrink: required rows are present')
{
  const names = (F.statements as Row[]).map((r) => r.name)
  const has = (needle: string) => names.some((n) => n.includes(needle))
  for (const attack of ['REPLAY', 'RELAY', 'PAYLOAD SWAP', 'DOCID SWAP', 'EXPIRED']) ok(has(attack), `cns attack row present: ${attack}`)
  for (const g of ['high-S', 'DER', 'an extra field', 'a field missing', 'raw (unencoded) email', 'dotted rp', 'padded base64url'])
    ok(has(g), `grammar/signature row present: ${g}`)
  for (const t of ['dev', 'bind', 'att', 'tomb', 'del', 'cmp', 'cns'])
    ok((F.statements as Row[]).some((r) => r.type === t && r.expect === 'accept') &&
      (F.statements as Row[]).some((r) => r.type === t && r.expect === 'reject'), `${t}: at least one accept and one reject row`)
  ok(F.kxModeDefault === 'unruled' && KX_MODE === 'unruled', 'kx placement is unruled: both slots must be empty until §6b is decided')
}

console.log('\nderivations: the consent transcript and the WebAuthn challenge')
for (const t of F.transcripts) {
  const got = await consentTranscript(t.audience, t.challenge, t.payload)
  ok(got === t.transcript, `transcript(${t.audience}) ${t.transcript === null ? `→ refused (${t.note})` : '→ the fixture value'}`)
}
for (const w of F.webauthn) ok((await webauthnChallengeFor(w.cns)) === w.challenge, 'clientDataJSON.challenge = b64u(SHA-256(exact cns. bytes))')

console.log('\nlow-S: verifiers refuse high-S, signers fold it')
for (const [i, p] of (F.lowS as { high: string; low: string }[]).entries()) {
  const text = `dev.lows.${i}`
  ok(await verifyStatementSig(F.keys.account, p.low, text), `pair ${i}: the low-S signature verifies`)
  ok(!(await verifyStatementSig(F.keys.account, p.high, text)), `pair ${i}: its high-S twin (equally valid ECDSA) is refused`)
  ok(b64uEnc(lowS(b64uDec(p.high)!)) === p.low && b64uEnc(lowS(b64uDec(p.low)!)) === p.low, `pair ${i}: lowS folds high to low and leaves low alone`)
}

console.log('\nroutine signing: each SignPurpose signs only its own statement shape')
for (const p of F.purposes as { purpose: SignPurpose; payload: string; match: boolean; note?: string }[]) {
  ok(payloadMatchesPurpose(p.purpose, p.payload) === p.match,
    `${p.purpose} ${p.match ? 'accepts' : 'refuses'} ${p.payload.slice(0, 24)}${p.payload.length > 24 ? '…' : ''}${p.note ? ` (${p.note})` : ''}`)
}

console.log('\naddresses: one normal form for every host (ASCII-only, phase 1)')
for (const a of F.addresses as { input: string; address?: string; reason?: string; note?: string }[]) {
  const r = normalizeAddress(a.input)
  const want = a.address !== undefined ? `ok:${a.address}` : `refused:${a.reason}`
  const got = r.ok ? `ok:${r.address}` : `refused:${r.reason}`
  ok(got === want, `${JSON.stringify(a.input).slice(0, 40)} → ${want}${got === want ? '' : ` (got ${got})`}`)
}

console.log('\nstrict base64url')
{
  ok(b64uDec('QQ') !== null && b64uDec('QQ==') === null, 'padding is refused')
  ok(b64uDec('QR') === null, 'non-zero trailing bits (a non-canonical spelling of "A") are refused')
  ok(b64uDec('Q') === null, 'an impossible length is refused')
  ok(b64uDec('Q+8') === null && b64uDec('Q/8') === null, 'the standard alphabet (+ /) is refused')
  ok(b64uDec('') !== null && b64uDec('')!.length === 0, 'the empty string is zero bytes')
}

console.log('\nreserved prefixes')
ok(RESERVED_PREFIXES.includes('pk'), 'pk. is reserved for the phase-2 passkey statement')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

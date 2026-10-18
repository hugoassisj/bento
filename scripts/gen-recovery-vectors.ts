#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Generates kernel/fixtures/recovery-v1.json — the bento/id recovery-code and
// key-blob conformance vectors (identity-design §2f, security §28).
//
//   node scripts/gen-recovery-vectors.ts
//
// Unlike the statement vectors, every row here is DETERMINISTIC: fixed codes,
// salts and IVs, so every host (Swift, Kotlin, Rust, the extension's WASM, and the
// directory) must reproduce the exact bytes, end to end. The keys are TEST KEYS.

import { argon2 as nodeArgon2 } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARGON2, formatRecoveryCode, parseRecoveryCode, recoveryWrapKey, recoveryVerifier, prfKek,
  sealPrfBlob, sealRecoveryInner, pepperKeys, pepperVerifierTag, pepperSeal, publicKeyOf, PRF_INPUT, prfHmacSecretSalt, type Argon2id,
} from '../kernel/src/recovery.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'kernel/fixtures/recovery-v1.json')
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff)

const argon2: Argon2id = (password, salt) => new Promise((res, rej) => nodeArgon2('argon2id', {
  message: password, nonce: salt, parallelism: ARGON2.parallelism, tagLength: ARGON2.tagLength,
  memory: ARGON2.memoryKiB, passes: ARGON2.passes,
}, (e, k) => (e ? rej(e) : res(new Uint8Array(k)))))

// RFC 9106 §5.3: hosts check their Argon2id against the standard before trusting it
const rfc9106 = {
  note: 'RFC 9106 §5.3 Argon2id (NOT our parameters): validates the primitive itself',
  password: hex(bytes(32, () => 1)), salt: hex(bytes(16, () => 2)), secret: hex(bytes(8, () => 3)), ad: hex(bytes(12, () => 4)),
  memoryKiB: 32, passes: 3, parallelism: 4, tagLength: 32,
  tag: '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
}

// --- codes: one per check symbol, including the five extra ones ----------------------
const codes: Record<string, unknown>[] = []
const want = new Set('0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U'.split(''))
for (let seed = 0; want.size > 0 && seed < 100000; seed++) {
  const code = bytes(10, (i) => (seed * 2654435761 + i * 40503) >>> (i % 3) * 8)
  const printed = formatRecoveryCode(code)
  const check = printed.slice(-1)
  if (!want.has(check)) continue
  // keep every extra symbol, and a handful of ordinary ones
  if ('*~$=U'.includes(check) || codes.length < 8) codes.push({ bytes: hex(code), printed, check })
  want.delete(check)
}
for (const c of ['*', '~', '$', '=', 'U']) if (!codes.some((r) => r.check === c)) throw new Error(`no code with check ${c}`)

const base = codes[0] as { bytes: string; printed: string }
const p = base.printed
const parse: Record<string, unknown>[] = [
  { input: p, bytes: base.bytes, note: 'as printed' },
  { input: p.toLowerCase(), bytes: base.bytes, note: 'lowercase' },
  { input: p.replace(/-/g, ''), bytes: base.bytes, note: 'no separators' },
  { input: ` ${p.replace(/-/g, ' ')} `, bytes: base.bytes, note: 'spaces instead of hyphens, and around it' },
]
// O→0 and I/L→1, when the code has a 0 or a 1 to substitute
const data = p.replace(/-/g, '').slice(0, 16)
if (data.includes('0')) parse.push({ input: p.replace('0', 'O'), bytes: base.bytes, note: 'O typed for 0' })
if (data.includes('1')) parse.push({ input: p.replace('1', 'L'), bytes: base.bytes, note: 'L typed for 1' }, { input: p.replace('1', 'I'), bytes: base.bytes, note: 'I typed for 1' })
for (const c of codes) parse.push({ input: c.printed, bytes: c.bytes, note: `check symbol ${c.check}` })
const wrongCheck = p.slice(0, -1) + (p.endsWith('0') ? '1' : '0')
parse.push(
  { input: wrongCheck, reason: 'check', note: 'a wrong check symbol (a typo) is refused locally' },
  { input: p.slice(0, 4) + p.slice(5, 9) + p.slice(10, 14) + p.slice(15, 18) + p.slice(-1), reason: 'length', note: 'a data symbol missing' },
  { input: p + '0', reason: 'length', note: 'one symbol too many' },
  { input: 'U' + p.slice(1), reason: 'character', note: 'U is valid only as the check symbol' },
  { input: p.slice(0, -1) + '#', reason: 'character', note: 'not a Crockford symbol' },
)
// sanity: the reference agrees with every row it is about to publish
for (const r of parse) {
  const got = parseRecoveryCode(r.input as string)
  const ok = r.bytes ? got.ok && hex(got.code) === r.bytes : !got.ok && got.reason === r.reason
  if (!ok) throw new Error(`parse row disagrees: ${JSON.stringify(r)}`)
}

// --- derivations -----------------------------------------------------------------------
const code = Uint8Array.from(Buffer.from(base.bytes, 'hex'))
const salt = bytes(16, (i) => 0x10 + i), saltV = bytes(16, (i) => 0x40 + i)
const A = await argon2(code, salt)
const derivations = {
  code: base.bytes, salt: hex(salt), saltV: hex(saltV),
  argon2_A: hex(A),
  wrapKey: hex(await recoveryWrapKey(code, salt, argon2)),
  verifier: hex(await recoveryVerifier(code, saltV, argon2)),
  prf: { output: hex(bytes(32, (i) => 0xa0 + i)), salt: hex(bytes(32, (i) => 0x70 + i)) },
  prfKek: '',
}
derivations.prfKek = hex(await prfKek(bytes(32, (i) => 0xa0 + i), bytes(32, (i) => 0x70 + i)))

// --- the PRF input, and the CTAP hmac-secret salt for hosts without a PRF API -------------
// WebAuthn L3 §10.1.4. The two "wrong" values are the easy mistakes, published so
// a host can see it has made one rather than silently sealing unopenable blobs.
const sha256hex = async (b: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource)))
const prfInputBytes = new TextEncoder().encode(PRF_INPUT)
const label = new TextEncoder().encode('WebAuthn PRF')
const prf = {
  note: 'The PRF extension evaluates input = UTF-8(prfInput). A host speaking CTAP hmac-secret directly ' +
    '(no WebAuthn PRF API) sends hmacSecretSalt = SHA-256(UTF-8("WebAuthn PRF") ‖ 0x00 ‖ input) (WebAuthn L3 §10.1.4), ' +
    'so the authenticator returns the same 32 bytes a browser gets. Browsers apply this themselves: never twice.',
  prfInput: PRF_INPUT,
  inputHex: hex(prfInputBytes),
  hmacSecretSalt: hex(await prfHmacSecretSalt()),
  wrong: {
    noSeparator: await sha256hex(Uint8Array.from([...label, ...prfInputBytes])),
    rawInputHash: await sha256hex(prfInputBytes),
    rawInput: hex(prfInputBytes),
  },
}

// --- whole blobs (end to end) --------------------------------------------------------------
// Test keys are DETERMINISTIC (fixed scalars), so regenerating this file changes
// nothing unless a rule changes: porters can build against stable bytes.
async function testKey(name: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bento/id test key ${name}`)))
  const pub = publicKeyOf(d)
  if (!pub) throw new Error(`test scalar for ${name} out of range`)
  return { d, pub }
}
const account = await testKey('account'), kx = await testKey('kx'), other = await testKey('other')
const credentialId = bytes(16, (i) => 0xc0 + i)
const prfOutput = bytes(32, (i) => 0xa0 + i), prfSalt = bytes(32, (i) => 0x70 + i), iv = bytes(12, (i) => 0x20 + i)

const blobs = {
  keys: { accountD: hex(account.d), accountPub: account.pub, kxD: hex(kx.d), kxPub: kx.pub, otherD: hex(other.d) },
  prf: {
    unruled: await sealPrfBlob({ prfOutput, credentialId, salt: prfSalt, iv, keys: { account: account.d } }),
    modeA: await sealPrfBlob({ prfOutput, credentialId, salt: prfSalt, iv, keys: { account: account.d, kx: kx.d }, mode: 'A' }),
    inputs: { prfOutput: hex(prfOutput), credentialId: hex(credentialId), salt: hex(prfSalt), iv: hex(iv) },
  },
  recovery: {
    inputs: { code: base.bytes, salt: hex(salt), iv: hex(iv) },
    inner: hex(await sealRecoveryInner({ wrapKey: await recoveryWrapKey(code, salt, argon2), iv, accountPub: account.pub, keys: { account: account.d } })),
  },
  pepper: { secret: hex(bytes(32, (i) => 0xe0 + i)), iv: hex(bytes(12, (i) => 0x30 + i)), verifyKey: '', wrapKey: '', verifierTag: '', outer: '' },
}
{
  const pk = await pepperKeys(bytes(32, (i) => 0xe0 + i), account.pub)
  blobs.pepper.verifyKey = hex(pk.verifyKey)
  blobs.pepper.wrapKey = hex(pk.wrapKey)
  blobs.pepper.verifierTag = hex(await pepperVerifierTag(pk.verifyKey, await recoveryVerifier(code, saltV, argon2)))
  blobs.pepper.outer = hex(await pepperSeal(pk.wrapKey, bytes(12, (i) => 0x30 + i), Uint8Array.from(Buffer.from(blobs.recovery.inner, 'hex')), account.pub))
}

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const scalarHex = (x: bigint) => x.toString(16).padStart(64, '0')
const scalars = [
  { name: 'the account scalar matching the signed public half', d: hex(account.d), pub: account.pub, expect: 'accept' },
  { name: 'scalar 0', d: scalarHex(0n), pub: account.pub, expect: 'reject', reason: 'scalar-range' },
  { name: 'scalar n (the group order)', d: scalarHex(N), pub: account.pub, expect: 'reject', reason: 'scalar-range' },
  { name: 'scalar n−1 for a mismatched public half', d: scalarHex(N - 1n), pub: account.pub, expect: 'reject', reason: 'key-mismatch' },
  { name: "another key's scalar (a swapped blob)", d: hex(other.d), pub: account.pub, expect: 'reject', reason: 'key-mismatch' },
]

const fixture = {
  version: 1,
  note: 'bento/id recovery-code and key-blob vectors (identity-design §2f, security §28). TEST KEYS ONLY. ' +
    'Every value is deterministic: reproduce the bytes exactly. Generated by scripts/gen-recovery-vectors.ts, ' +
    'checked by scripts/test-recovery.ts.',
  params: { argon2: ARGON2, saltLen: 16, hkdf: 'HKDF-SHA-256; an empty salt is zero-length (= 32 zero bytes)', aead: 'AES-256-GCM, 12-byte IV, ct = ciphertext ‖ 16-byte tag' },
  rfc9106,
  codes,
  parse,
  derivations,
  prf,
  blobs,
  scalars,
}
writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n')
console.log(`wrote ${OUT}: ${codes.length} codes, ${parse.length} parse rows, ${scalars.length} scalar rows`)

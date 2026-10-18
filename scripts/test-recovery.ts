#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// bento/id recovery rig: kernel/src/recovery.ts against kernel/fixtures/recovery-v1.json.
//
//   node scripts/test-recovery.ts
//
// WHAT THIS PROVES. Five hosts must derive the identical keys from the same
// recovery code and the same passkey PRF output, or a person who sets up on one
// device can never recover on another. The vectors are deterministic, so the
// reference must reproduce every byte: the Argon2id primitive against RFC 9106,
// the code's printed form and its forgiving parse (including all five extra
// check symbols), every derivation, every blob re-sealed byte for byte, and
// every refusal: a wrong PRF, a wrong credential, a blob bound to another
// account, a scalar out of range or not matching the signed public half.

import { argon2 as nodeArgon2 } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARGON2, formatRecoveryCode, parseRecoveryCode, recoveryWrapKey, recoveryVerifier, prfKek,
  sealPrfBlob, openPrfBlob, sealRecoveryInner, openRecoveryInner, unpackScalars,
  pepperKeys, pepperVerifierTag, pepperSeal, pepperOpen, publicKeyOf, type Argon2id,
} from '../kernel/src/recovery.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

const F = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'kernel/fixtures/recovery-v1.json'), 'utf8'))
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const unhex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'))

const raw = (o: { message: Uint8Array; nonce: Uint8Array; secret?: Uint8Array; associatedData?: Uint8Array; parallelism: number; tagLength: number; memory: number; passes: number }) =>
  new Promise<Uint8Array>((res, rej) => nodeArgon2('argon2id', o, (e, k) => (e ? rej(e) : res(new Uint8Array(k)))))
const argon2: Argon2id = (password, salt) => raw({
  message: password, nonce: salt, parallelism: ARGON2.parallelism, tagLength: ARGON2.tagLength, memory: ARGON2.memoryKiB, passes: ARGON2.passes,
})

console.log('\nthe Argon2id primitive matches RFC 9106 §5.3')
{
  const v = F.rfc9106
  const tag = await raw({ message: unhex(v.password), nonce: unhex(v.salt), secret: unhex(v.secret), associatedData: unhex(v.ad),
    parallelism: v.parallelism, tagLength: v.tagLength, memory: v.memoryKiB, passes: v.passes })
  ok(hex(tag) === v.tag, 'Argon2id(RFC 9106 §5.3 inputs) = the published tag')
  ok(F.params.argon2.parallelism === 1 && F.params.argon2.memoryKiB === 65536 && F.params.argon2.passes === 3 &&
    F.params.argon2.tagLength === 32 && F.params.argon2.version === 0x13, 'the fixture states the signed parameters (p=1, 64 MiB, t=3, 32-byte tag, v0x13)')
}

console.log('\nthe printed code, including every extra check symbol')
for (const c of F.codes) ok(formatRecoveryCode(unhex(c.bytes)) === c.printed, `${c.printed} (check ${c.check})`)
for (const s of ['*', '~', '$', '=', 'U']) ok(F.codes.some((c: { check: string }) => c.check === s), `a code whose check symbol is ${s}`)

console.log('\nreading what a person typed')
for (const r of F.parse) {
  const got = parseRecoveryCode(r.input)
  const pass = r.bytes ? got.ok && hex(got.code) === r.bytes : !got.ok && got.reason === r.reason
  ok(pass, `${JSON.stringify(r.input)} → ${r.bytes ? 'the code' : `refused: ${r.reason}`} (${r.note})`)
}

console.log('\nderivations')
{
  const d = F.derivations
  const code = unhex(d.code), salt = unhex(d.salt), saltV = unhex(d.saltV)
  ok(hex(await argon2(code, salt)) === d.argon2_A, 'A = Argon2id(code bytes, salt)')
  ok(hex(await recoveryWrapKey(code, salt, argon2)) === d.wrapKey, 'wrap key = HKDF(A, empty, "bento/id/rc-wrap/v1")')
  ok(hex(await recoveryVerifier(code, saltV, argon2)) === d.verifier, 'verifier = Argon2id(code bytes, salt_v)')
  ok(d.verifier !== d.argon2_A, 'the verifier is not the wrap input (independent salts)')
  ok(hex(await prfKek(unhex(d.prf.output), unhex(d.prf.salt))) === d.prfKek, 'PRF KEK = HKDF(PRF output, salt, "bento/id/acct-wrap/v1")')
}

console.log('\nwhole blobs, end to end')
{
  const b = F.blobs, k = b.keys, i = b.prf.inputs
  const prfIn = { prfOutput: unhex(i.prfOutput), credentialId: unhex(i.credentialId), salt: unhex(i.salt), iv: unhex(i.iv) }
  const resealed = await sealPrfBlob({ ...prfIn, keys: { account: unhex(k.accountD) } })
  ok(JSON.stringify(resealed) === JSON.stringify(b.prf.unruled), 'the PRF blob re-seals byte for byte (account key only)')
  const resealedA = await sealPrfBlob({ ...prfIn, keys: { account: unhex(k.accountD), kx: unhex(k.kxD) }, mode: 'A' })
  ok(JSON.stringify(resealedA) === JSON.stringify(b.prf.modeA), 'the PRF blob under kx mode A (account ‖ kx) re-seals byte for byte')

  const opened = await openPrfBlob(b.prf.unruled, { prfOutput: prfIn.prfOutput, credentialId: prfIn.credentialId, expected: { accountPub: k.accountPub } })
  ok(opened.ok && hex(opened.value.account) === k.accountD, 'it opens to the account scalar, checked against the signed public half')
  const openedA = await openPrfBlob(b.prf.modeA, { prfOutput: prfIn.prfOutput, credentialId: prfIn.credentialId, expected: { accountPub: k.accountPub, kxPub: k.kxPub }, mode: 'A' })
  ok(openedA.ok && hex(openedA.value.kx!) === k.kxD, 'mode A opens to account ‖ kx, both checked')
  const wrongPrf = await openPrfBlob(b.prf.unruled, { prfOutput: unhex(i.prfOutput).map((x: number) => x ^ 1), credentialId: prfIn.credentialId, expected: { accountPub: k.accountPub } })
  ok(!wrongPrf.ok && wrongPrf.reason === 'decrypt', 'a different passkey PRF output cannot open it')
  const wrongCred = await openPrfBlob(b.prf.unruled, { prfOutput: prfIn.prfOutput, credentialId: unhex(i.credentialId).map((x: number) => x ^ 1), expected: { accountPub: k.accountPub } })
  ok(!wrongCred.ok && wrongCred.reason === 'credential', 'a blob for another credential is refused')
  const unruledAsA = await openPrfBlob(b.prf.unruled, { prfOutput: prfIn.prfOutput, credentialId: prfIn.credentialId, expected: { accountPub: k.accountPub, kxPub: k.kxPub }, mode: 'A' })
  ok(!unruledAsA.ok && unruledAsA.reason === 'length', 'a blob opened under the wrong kx mode is refused (length)')

  const r = b.recovery.inputs
  const wk = await recoveryWrapKey(unhex(r.code), unhex(r.salt), argon2)
  const inner = await sealRecoveryInner({ wrapKey: wk, iv: unhex(r.iv), accountPub: k.accountPub, keys: { account: unhex(k.accountD) } })
  ok(hex(inner) === b.recovery.inner, 'the recovery blob (inner layer) re-seals byte for byte')
  const rOpen = await openRecoveryInner(unhex(b.recovery.inner), { wrapKey: wk, iv: unhex(r.iv), expected: { accountPub: k.accountPub } })
  ok(rOpen.ok && hex(rOpen.value.account) === k.accountD, 'the recovery code opens it')
  const otherCode = parseRecoveryCode(F.codes[1].printed)
  const wk2 = await recoveryWrapKey(otherCode.ok ? otherCode.code : new Uint8Array(10), unhex(r.salt), argon2)
  const rWrong = await openRecoveryInner(unhex(b.recovery.inner), { wrapKey: wk2, iv: unhex(r.iv), expected: { accountPub: k.accountPub } })
  ok(!rWrong.ok && rWrong.reason === 'decrypt', 'a different recovery code cannot open it')
  // the aad binds the blob to its account: presented as another account's, it fails
  const rOther = await openRecoveryInner(unhex(b.recovery.inner), { wrapKey: wk, iv: unhex(r.iv), expected: { accountPub: F.blobs.keys.kxPub } })
  ok(!rOther.ok && rOther.reason === 'decrypt', "a recovery blob presented as another account's fails (aad binds the account)")

  const pp = b.pepper
  const pk = await pepperKeys(unhex(pp.secret), k.accountPub)
  ok(hex(pk.verifyKey) === pp.verifyKey && hex(pk.wrapKey) === pp.wrapKey, 'pepper: P → the "verify" and "wrap" subkeys')
  const verifier = await recoveryVerifier(unhex(F.derivations.code), unhex(F.derivations.saltV), argon2)
  ok(hex(await pepperVerifierTag(pk.verifyKey, verifier)) === pp.verifierTag, 'pepper: stored verifier = HMAC(verifyKey, verifier)')
  ok(hex(await pepperSeal(pk.wrapKey, unhex(pp.iv), unhex(b.recovery.inner), k.accountPub)) === pp.outer, 'pepper: the outer layer re-seals byte for byte')
  const back = await pepperOpen(pk.wrapKey, unhex(pp.iv), unhex(pp.outer), k.accountPub)
  ok(!!back && hex(back) === b.recovery.inner, 'pepper: the outer layer opens to the inner blob')
  ok((await pepperOpen(pk.wrapKey, unhex(pp.iv), unhex(pp.outer), k.kxPub)) === null, "pepper: presented as another account's, it fails")
}

console.log('\nscalars on import: in range, and matching the signed public half')
for (const s of F.scalars) {
  const v = unpackScalars(unhex(s.d), { accountPub: s.pub })
  ok(s.expect === 'accept' ? v.ok : !v.ok && v.reason === s.reason, `${s.name} → ${s.expect === 'accept' ? 'accept' : `refused: ${s.reason}`}`)
}

// The fixture's test keys are deterministic, their public halves computed by
// publicKeyOf itself, so the rows above cannot validate d·G on their own. Check
// it INDEPENDENTLY against keys the platform generated.
console.log('\nd·G agrees with the platform on keys it generated')
for (const alg of ['ECDSA', 'ECDH'] as const) {
  let agree = 0
  for (let i = 0; i < 8; i++) {
    const kp = (await crypto.subtle.generateKey({ name: alg, namedCurve: 'P-256' }, true,
      alg === 'ECDSA' ? ['sign', 'verify'] : ['deriveBits'])) as CryptoKeyPair
    const d = Uint8Array.from(Buffer.from((await crypto.subtle.exportKey('jwk', kp.privateKey)).d!, 'base64url'))
    const pub = Buffer.from(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))).toString('base64url')
    if (publicKeyOf(d) === pub) agree++
  }
  ok(agree === 8, `${alg}: publicKeyOf(d) equals WebCrypto's public key for 8 fresh key pairs`)
}
ok(publicKeyOf(new Uint8Array(32)) === null, 'publicKeyOf refuses scalar 0')

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// home/webext bento/id agent rig.
//
//   node scripts/test-webext-id.ts
//
// WHAT THIS PROVES.
//  1. The extension's statement code is the kernel reference, unaltered: the
//     generated copy in home/webext/src/id/gen/ is current (a type-strip of
//     kernel/src/statements.ts and address.ts).
//  2. That copy passes the WHOLE conformance contract,
//     kernel/fixtures/identity-v1.json: kernel's own rig is run again with its
//     imports pointed at the extension's files, so every row kernel checks is
//     checked against the code the extension ships.
//  3. The passkey-wrapped account key (identity-design §2f) round-trips, and
//     fails closed for the wrong passkey, the wrong credential, any tampered
//     field, and a recovered key that does not match the binding.
//  4. The recovery code is 80 random bits as 16 Crockford base-32 symbols plus a
//     mod-37 check symbol: typing it back is forgiving, and a typo is refused locally.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { generate } = await import('./gen-webext-id.mjs')
const blob = await import('../home/webext/src/id/blob.js')
const rec = await import('../home/webext/src/id/recovery.js')

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

console.log('\n— the extension runs the kernel reference, unaltered')
for (const [name, js] of Object.entries(generate() as Record<string, string>)) {
  let have = ''
  try { have = readFileSync(join(root, 'home/webext/src/id/gen', name), 'utf8') } catch { /* missing */ }
  ok(have === js, `home/webext/src/id/gen/${name} is the current type-strip of kernel/src (run node scripts/gen-webext-id.mjs if not)`)
}

console.log('\n— the conformance contract (kernel/fixtures/identity-v1.json), against the extension\'s copy')
{
  const src = readFileSync(join(root, 'scripts/test-statements.ts'), 'utf8')
  const gen = (f: string) => pathToFileURL(join(root, 'home/webext/src/id/gen', f)).href
  const swapped = src
    .replace("from '../kernel/src/statements.ts'", `from '${gen('statements.js')}'`)
    .replace("from '../kernel/src/address.ts'", `from '${gen('address.js')}'`)
    .replace("from '../kernel/src/identity.ts'", `from '${pathToFileURL(join(root, 'kernel/src/identity.ts')).href}'`)
    .replace("const root = join(dirname(fileURLToPath(import.meta.url)), '..')", `const root = ${JSON.stringify(root)}`)
  ok(swapped !== src && !swapped.includes("'../kernel/src/statements.ts'") && !swapped.includes("'../kernel/src/address.ts'"), 'kernel\'s rig is re-pointed at the extension\'s generated files')
  const dir = mkdtempSync(join(tmpdir(), 'webext-id-'))
  const f = join(dir, 'conformance.ts')
  writeFileSync(f, swapped)
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8' })
  const tail = (r.stdout.trim().split('\n').at(-1) ?? '')
  const m = tail.match(/^(\d+)\/(\d+) checks passed$/)
  ok(r.status === 0 && !!m && m[1] === m[2] && Number(m[2]) > 100, `every conformance row passes on the extension's code (${tail || r.stderr.trim().split('\n').at(-1)})`)
}

console.log('\n— the passkey-wrapped account key (identity-design §2f)')
{
  const subtle = globalThis.crypto.subtle
  const prf = crypto.getRandomValues(new Uint8Array(32))
  const credentialId = crypto.getRandomValues(new Uint8Array(32))
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const accountD = await blob.scalarOf(kp.privateKey)
  const accountPub = await blob.rawPub(kp.publicKey)
  const b = await blob.wrapAccount({ prf, credentialId, accountD })
  ok(b.v === 1 && b.cred === await blob.credHash(credentialId) && blob.unb64u(b.salt).length === 32 && blob.unb64u(b.iv).length === 12, 'the blob has the §2f shape: v, cred = b64u(sha256(credentialId)), 32-byte salt, 12-byte iv')
  ok(!JSON.stringify(b).includes(blob.b64u(accountD)), 'the account scalar does not appear in the blob')
  const out = await blob.unwrapAccount(b, { prf, credentialId })
  ok(blob.b64u(out.accountD) === blob.b64u(accountD) && out.kxD === null, 'the same passkey opens it (kx slot empty)')
  const fails = async (p: Promise<unknown>) => p.then(() => false, () => true)
  ok(await fails(blob.unwrapAccount(b, { prf: crypto.getRandomValues(new Uint8Array(32)), credentialId })), 'another passkey\'s PRF output cannot open it')
  ok(await fails(blob.unwrapAccount(b, { prf, credentialId: crypto.getRandomValues(new Uint8Array(32)) })), 'a blob presented for another credential is refused')
  for (const field of ['ct', 'iv', 'salt'] as const) {
    const t = { ...b, [field]: blob.b64u(blob.unb64u(b[field]).map((x: number, i: number) => (i === 0 ? x ^ 1 : x))) }
    ok(await fails(blob.unwrapAccount(t, { prf, credentialId })), `a tampered ${field} fails closed`)
  }
  // the aad binds the credential hash: moving a blob under another cred label fails even with the right PRF
  const other = crypto.getRandomValues(new Uint8Array(32))
  ok(await fails(blob.unwrapAccount({ ...b, cred: await blob.credHash(other) }, { prf, credentialId: other })), 'relabelling a blob for another credential fails (cred is in the AAD)')
  const key = await blob.importAccount(out.accountD, accountPub)
  ok(key.extractable === false && key.usages.join() === 'sign', 'the recovered key comes back NON-extractable, sign-only')
  const stranger = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  ok(await fails(blob.importAccount(out.accountD, await blob.rawPub(stranger.publicKey))), 'a recovered key that does not match the binding\'s public key is refused (a swapped blob fails closed)')
  const kx = crypto.getRandomValues(new Uint8Array(32))
  const b2 = await blob.wrapAccount({ prf, credentialId, accountD, kxD: kx })
  const out2 = await blob.unwrapAccount(b2, { prf, credentialId })
  ok(blob.b64u(out2.kxD) === blob.b64u(kx), 'with the kx slot filled (after the ruling), both scalars round-trip')
  ok(await fails(blob.wrapAccount({ prf: new Uint8Array(31), credentialId, accountD })) && await fails(blob.wrapAccount({ prf, credentialId, accountD: new Uint8Array(31) })), 'wrong-length PRF output or scalar is refused')
  const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
  const big = (v: bigint) => { const o = new Uint8Array(32); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n } return o }
  ok(!blob.scalarInRange(new Uint8Array(32)) && !blob.scalarInRange(big(N)) && !blob.scalarInRange(big(N + 5n)) && blob.scalarInRange(big(N - 1n)) && blob.scalarInRange(big(1n)), 'a scalar must lie in 1..n−1')
  ok(await fails(blob.importAccount(new Uint8Array(32), accountPub)), 'an out-of-range recovered scalar is refused before import')
  ok(new TextDecoder().decode(blob.PRF_INPUT) === 'bento/id/prf/v1', 'the PRF input is the fixed "bento/id/prf/v1"')
}

console.log('\n— the recovery code (80 bits: 16 Crockford base-32 + a mod-37 check symbol)')
{
  const codes = new Set(Array.from({ length: 200 }, () => rec.newRecoveryCode()))
  ok(codes.size === 200 && [...codes].every((c) => /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-HJKMNP-TV-Z*~$=U]$/.test(c)), 'shown XXXX-XXXX-XXXX-XXXX-C from the Crockford alphabet, fresh every time')
  const zero = rec.newRecoveryCode(() => new Uint8Array(10))
  const ones = rec.newRecoveryCode(() => new Uint8Array(10).fill(255))
  ok(zero === '0000-0000-0000-0000-0' && ones.startsWith('ZZZZ-ZZZZ-ZZZZ-ZZZZ-'), '10 bytes map to exactly 16 symbols (all 80 bits used)')
  ok(ones.endsWith('-' + '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U'[Number(((1n << 80n) - 1n) % 37n)]), 'the check symbol is the 80-bit value mod 37')
  for (const c of [...codes].slice(0, 20)) {
    const p = rec.parseRecoveryCode(c)
    ok(!!p && p.bytes.length === 10 && rec.displayCode(p.code) === c, `round-trips to 10 bytes and back: ${c}`)
    if (!p) break
  }
  const c = [...codes][0]
  const p = rec.parseRecoveryCode(c)!
  ok(rec.parseRecoveryCode(c.toLowerCase().replace(/-/g, ' '))?.code === p.code, 'typing ignores case, spaces and hyphens')
  const lookalike = p.code.replace(/0/g, 'O').replace(/1/g, 'L')
  ok(rec.parseRecoveryCode(lookalike)?.code === p.code, 'O reads as 0, and I or L as 1 (Crockford)')
  // a single-symbol typo in the data is caught by the check symbol
  let caught = 0, tried = 0
  for (let i = 0; i < 16; i++) {
    const sym = p.code[i]
    const sub = sym === 'A' ? 'B' : 'A'
    tried++
    if (rec.parseRecoveryCode(p.code.slice(0, i) + sub + p.code.slice(i + 1)) === null) caught++
  }
  ok(caught === tried, `every single-symbol typo is refused locally (${caught}/${tried})`)
  ok(rec.parseRecoveryCode(p.code.slice(0, 16)) === null && rec.parseRecoveryCode(p.code + 'A') === null && rec.parseRecoveryCode('U' + p.code.slice(1)) === null, 'a wrong length, or U in a data position, is refused')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

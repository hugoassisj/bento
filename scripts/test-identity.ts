#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// bento/id contract rig: kernel/src/identity.ts.
//
//   node scripts/test-identity.ts
//
// WHAT THIS PROVES. `identityAgent()` is how a document finds the host's
// identity agent. It must return the agent ONLY when a host defined a valid one,
// and null in every other case, so the caller falls back to today's behaviour.
// It must never throw into the caller, whatever sits on the global. And once
// found, the agent must not be swappable: a later change to the global cannot
// redirect where a signature request goes. This PR ships the contract only, so
// the rig also pins that nothing in the runtime calls it yet.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  identityAgent, resetIdentityAgentForTest, IDENTITY_CONTRACT, IDENTITY_GLOBAL,
  type IdentityAgent,
} from '../kernel/src/identity.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

const G = globalThis as Record<string, unknown>
const set = (v: unknown) => { resetIdentityAgentForTest(); G[IDENTITY_GLOBAL] = v }
const clear = () => { resetIdentityAgentForTest(); delete G[IDENTITY_GLOBAL] }

/** A well-formed phase-1 agent (no phase-2 members), recording what it was asked. */
function fakeAgent(tag = 'A') {
  const calls: string[] = []
  const agent = {
    contract: IDENTITY_CONTRACT,
    async whoami() { calls.push('whoami'); return null },
    async sign(purpose: string, payload: string) { calls.push(`sign:${purpose}:${payload}`); return { ok: true as const, sig: tag, pub: tag } },
    async resolve() { calls.push('resolve'); return null },
  }
  return { agent, calls }
}

console.log('\nno host → null, the caller keeps today\'s behaviour')
{
  clear()
  ok(identityAgent() === null, 'no global → null')
  set(undefined); ok(identityAgent() === null, 'global undefined → null')
  set(null); ok(identityAgent() === null, 'global null → null')
  set('agent'); ok(identityAgent() === null, 'a string → null')
  set(() => 0); ok(identityAgent() === null, 'a function → null')
}

console.log('\na malformed agent is refused, never half-used')
{
  const { agent } = fakeAgent()
  set({ ...agent, contract: undefined }); ok(identityAgent() === null, 'no contract version → null')
  set({ ...agent, contract: IDENTITY_CONTRACT + 1 }); ok(identityAgent() === null, 'a newer, unknown contract → null (not misread)')
  set({ ...agent, contract: String(IDENTITY_CONTRACT) }); ok(identityAgent() === null, 'a contract given as a string → null')
  for (const k of ['whoami', 'sign', 'resolve'] as const) {
    const bad: Record<string, unknown> = { ...agent }; delete bad[k]
    set(bad); ok(identityAgent() === null, `missing ${k} → null`)
    set({ ...agent, [k]: 'not a function' }); ok(identityAgent() === null, `${k} not callable → null`)
  }
  set({ ...agent, unwrap: 42 }); ok(identityAgent() === null, 'a phase-2 member that is present but not callable → null')
  set({ ...agent, share: {} }); ok(identityAgent() === null, 'share present but not callable → null')
}

console.log('\nhostile globals never throw into the caller')
{
  resetIdentityAgentForTest()
  Object.defineProperty(G, IDENTITY_GLOBAL, { configurable: true, get() { throw new Error('boom') } })
  let threw = false, got: unknown = 'unset'
  try { got = identityAgent() } catch { threw = true }
  ok(!threw && got === null, 'a throwing getter on the global → null, no throw')
  delete G[IDENTITY_GLOBAL]

  const hostile = new Proxy({}, { get() { throw new Error('trap') } })
  set(hostile)
  threw = false
  try { got = identityAgent() } catch { threw = true }
  ok(!threw && got === null, 'a throwing proxy → null, no throw')

  const { proxy, revoke } = Proxy.revocable(fakeAgent().agent, {})
  revoke()
  set(proxy)
  threw = false
  try { got = identityAgent() } catch { threw = true }
  ok(!threw && got === null, 'a revoked proxy → null, no throw')
}

console.log('\na valid agent is found, phase-2 members optional')
{
  const { agent, calls } = fakeAgent()
  set(agent)
  const a = identityAgent()
  ok(a !== null, 'a phase-1 agent (whoami, sign, resolve) is accepted')
  ok(a?.contract === IDENTITY_CONTRACT, `it reports contract ${IDENTITY_CONTRACT}`)
  ok(a?.unwrap === undefined && a?.share === undefined, 'phase-2 members absent → not invented')
  const r = await a!.sign('frame', '1.abc')
  ok(r.ok === true && calls.includes('sign:frame:1.abc'), 'calls reach the host agent with their arguments')

  const withP2 = { ...fakeAgent().agent, async unwrap() { return null }, async share() { return { ok: true as const } } }
  set(withP2)
  const b = identityAgent()
  ok(!!b && typeof b.unwrap === 'function' && typeof b.share === 'function', 'an agent with phase-2 members exposes them')
}

console.log('\nonce found, the agent cannot be swapped or patched')
{
  const first = fakeAgent('FIRST')
  set(first.agent)
  const a = identityAgent() as IdentityAgent
  // something later replaces the global, and patches the original object
  G[IDENTITY_GLOBAL] = fakeAgent('SECOND').agent
  ;(first.agent as Record<string, unknown>).sign = async () => ({ ok: true, sig: 'PATCHED', pub: 'PATCHED' })
  ok(identityAgent() === a, 'a later global is ignored: the captured agent is returned')
  const r = await a.sign('frame', '2.x')
  ok(r.ok === true && r.sig === 'FIRST', `a method patched after capture does not redirect the call (got ${r.ok ? r.sig : r.reason})`)
  ok(Object.isFrozen(a), 'the captured agent is frozen')
  const orig = a.sign
  let threw = false
  try { (a as unknown as Record<string, unknown>).sign = () => 0 } catch { threw = true }
  ok(threw && a.sign === orig, 'and cannot be reassigned (strict-mode write throws, the method is unchanged)')
}

console.log('\nlate arrival: an absent agent is not cached as null')
{
  clear()
  ok(identityAgent() === null, 'nothing yet')
  G[IDENTITY_GLOBAL] = fakeAgent().agent
  ok(identityAgent() !== null, 'the host defines it a moment late — found on the next call')
  clear()
}

// K1 is contract only. Pin that no runtime file imports it yet, so this PR is
// provably free of behaviour change; the bridge (B1) and the apps add callers.
console.log('\ncontract only: nothing calls it yet')
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f.startsWith('.') || f === 'dist' || f === 'dist-single') continue
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|js|mjs)$/.test(f) && p !== join(root, 'kernel/src/identity.ts') &&
        /from ['"][^'"]*\/identity(\.ts)?['"]/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1))
    }
  }
  for (const d of ['kernel/src', 'slides/src', 'spaces/src', 'type/src', 'dash/src']) walk(join(root, d))
  ok(hits.length === 0, `no runtime module imports kernel/src/identity.ts (${hits.join(', ') || 'none'})`)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

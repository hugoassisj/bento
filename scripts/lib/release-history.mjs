// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// THE SIGNED RELEASE HISTORY (K4, security §36): every release of an app still
// in the wild, with its pins, in one cumulative payload signed by the release
// key. It is what lets a host verify a file saved by ANY genuine release, not
// only the newest, without carrying every shell it trusts.
//
//   releases/<app>/history.json = { payload: "<json>", sig }   (the release envelope)
//   payload = { app, v: 1, releases: [ { version, sha256, at, pins }, ... ] }   newest first
//
// Three rules live here, each the one a host must apply:
//   - nextHistory(): append-only. A history never loses an entry, never changes
//     one, and a new release must be newer than every release it holds.
//   - acceptHistory(): ANTI-ROLLBACK for hosts. A host keeps the newest history
//     it has verified and refuses one that lacks an entry it holds or whose
//     newest version is lower, so a replayed older signed history can't hide a
//     release.
//   - matchRelease(): a file matches a release only if ONE entry matches EVERY
//     block (rt, rt-css, loader, remover) with exactly one block per id. Two
//     releases sharing a runtime can't be confused, and anything partial is
//     UNKNOWN: restricted mode or an update offer, never a borrowed pinned CSP.

import { checkAgainstPins, scanBlocks } from './release-pins.mjs'
import { createHash } from 'node:crypto'

export const HISTORY_V = 1

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
export function cmpVersion(a, b) {
  const x = SEMVER.exec(a), y = SEMVER.exec(b)
  if (!x || !y) throw new Error(`release-history: not a version: ${!x ? a : b}`)
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d }
  return 0
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const entryOk = (e) => e && typeof e.version === 'string' && SEMVER.test(e.version) &&
  /^[0-9a-f]{64}$/.test(e.sha256 ?? '') && typeof e.at === 'string' && e.pins?.v === 1 && typeof e.pins.blocks === 'object'

/** Check a history payload's shape; returns the problems ([] = well-formed). */
export function historyProblems(h) {
  const p = []
  if (!h || h.v !== HISTORY_V) p.push(`version ${h?.v} (expected ${HISTORY_V})`)
  if (typeof h?.app !== 'string' || !h.app) p.push('no app')
  if (!Array.isArray(h?.releases)) { p.push('no releases'); return p }
  const seen = new Set()
  h.releases.forEach((e, i) => {
    if (!entryOk(e)) p.push(`entry ${i} is malformed`)
    else {
      if (seen.has(e.version)) p.push(`version ${e.version} appears twice`)
      seen.add(e.version)
      if (i > 0 && entryOk(h.releases[i - 1]) && cmpVersion(h.releases[i - 1].version, e.version) <= 0) p.push(`entries are not newest-first at ${e.version}`)
    }
  })
  return p
}

/**
 * The next history: `held` (null for the first) plus `entry` for a new release.
 * Re-signing the SAME release (same version and sha256 and pins) is a no-op. A
 * release that isn't newer than everything held, or a changed entry for a held
 * version, is refused: a history only grows.
 */
export function nextHistory(app, held, entry) {
  if (!entryOk(entry)) throw new Error('release-history: the new entry is malformed')
  const releases = held ? held.releases : []
  if (held) {
    const problems = historyProblems(held)
    if (problems.length) throw new Error(`release-history: the held history is malformed: ${problems.join('; ')}`)
    if (held.app !== app) throw new Error(`release-history: the held history is for ${held.app}, not ${app}`)
  }
  const existing = releases.find((e) => e.version === entry.version)
  if (existing) {
    if (same(existing, entry)) return { app, v: HISTORY_V, releases }
    throw new Error(`release-history: ${entry.version} is already in the history with different bytes: a history never changes an entry`)
  }
  if (releases.length && cmpVersion(entry.version, releases[0].version) <= 0) {
    throw new Error(`release-history: ${entry.version} is not newer than ${releases[0].version}: a history only grows forward`)
  }
  return { app, v: HISTORY_V, releases: [entry, ...releases] }
}

/**
 * A HOST's acceptance of an incoming (already signature-verified) history,
 * given the newest it holds. Returns { ok: true } or { ok: false, reason }.
 */
export function acceptHistory(held, incoming, app) {
  const problems = historyProblems(incoming)
  if (problems.length) return { ok: false, reason: `malformed: ${problems[0]}` }
  if (incoming.app !== app) return { ok: false, reason: `for ${incoming.app}, not ${app}` }
  if (!held) return { ok: true }
  if (!incoming.releases.length || (held.releases.length && cmpVersion(incoming.releases[0].version, held.releases[0].version) < 0)) {
    return { ok: false, reason: 'rollback: its newest release is older than the newest already held' }
  }
  for (const e of held.releases) {
    const there = incoming.releases.find((x) => x.version === e.version)
    if (!there) return { ok: false, reason: `rollback: it lacks ${e.version}, which is already held` }
    if (!same(there, e)) return { ok: false, reason: `${e.version} changed: a history never changes an entry` }
  }
  return { ok: true }
}

const blockHash = (html, id) => {
  const found = scanBlocks(html).filter((b) => b.id === id)
  return found.length === 1 ? createHash('sha256').update(found[0].text, 'utf8').digest('hex') : null
}

/**
 * Which release made this file? The ONE entry matching every block; null when
 * none does, or when more than one would (UNKNOWN either way).
 */
export function matchRelease(history, html) {
  const rt = blockHash(html, 'bento-rt')
  if (!rt) return null
  const candidates = history.releases.filter((e) => e.pins.blocks['bento-rt'] === rt)
  const full = candidates.filter((e) => checkAgainstPins(html, e.pins).length === 0)
  return full.length === 1 ? full[0] : null
}

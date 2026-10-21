// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento/connect W2 — deciding whether a file may be served with identity, and
// what the sandbox may turn into running script.
//
// THE RULE (security §16–§18, §2c): identity only where the host SERVES the
// bytes it verified. So the host reads the file itself, gate 1 decides
// (kernel's verifyServed against the held signed histories), and:
//   · GENUINE → served into the extension's sandbox page, where ONLY the
//     executable blocks gate 1's own scanner reported become blob: scripts,
//     spliced by the scanner's own element offsets (Block.tagStart..end) —
//     never a second regex, never a re-serialisation;
//   · UNKNOWN (no single release matches every block, a markup problem, no
//     history held) → never enters the sandbox; the file opens as itself, in
//     a plain file:// tab, without identity.
// The sandbox's FIXED CSP (script-src 'self' blob:, no inline) is the second
// wall: anything the scanner did NOT report stays inline and does not run.

import { verifyServed, scanBlocks, executableScripts } from '../id/gen/gate1.js'

/**
 * `histories` is { appId: history } (serve/history.js heldHistories). Returns
 * { verdict: 'genuine', appId, release, plan } — plan = the executable
 * elements in document order: { tagStart, end, text, module } — or
 * { verdict: 'unknown', reason }.
 */
export async function prepare(html, histories) {
  const matches = []
  for (const [appId, history] of Object.entries(histories ?? {})) {
    const v = await verifyServed(html, history)
    if (v.verdict === 'genuine') matches.push({ appId, release: v.release })
  }
  if (matches.length === 0) return { verdict: 'unknown', reason: Object.keys(histories ?? {}).length ? 'no release matches' : 'no release history held' }
  if (matches.length > 1) return { verdict: 'unknown', reason: 'matches more than one app' }
  const plan = executableScripts(scanBlocks(html)).map((b) => ({
    tagStart: b.tagStart, end: b.end, text: b.text, module: (b.type ?? '').toLowerCase() === 'module',
  }))
  return { verdict: 'genuine', ...matches[0], plan }
}

/**
 * The sandbox's splice: each planned element, and ONLY those, replaced by a
 * script loading `urlFor(text, module)` (a blob: URL in the sandbox). Pure.
 * Refuses a plan that isn't in document order, overlaps, or doesn't line up
 * with the html it came with — the plan and the bytes must be the verified pair.
 */
export function splice(html, plan, urlFor) {
  let out = ''
  let at = 0
  for (const p of plan) {
    if (!(Number.isInteger(p.tagStart) && Number.isInteger(p.end) && p.tagStart >= at && p.end > p.tagStart && p.end <= html.length)) throw new Error('the plan does not line up with the file')
    if (!html.slice(p.tagStart, p.end).includes(p.text)) throw new Error('the plan does not line up with the file')
    out += html.slice(at, p.tagStart)
    out += `<script${p.module ? ' type="module"' : ''} src="${urlFor(p.text, p.module)}"></` + 'script>'
    at = p.end
  }
  return out + html.slice(at)
}

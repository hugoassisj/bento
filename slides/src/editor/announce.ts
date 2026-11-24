// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * The editor's two live regions: what a toast shows, a screen reader hears.
 *
 * A live region is announced only when text CHANGES inside a node that was
 * already in the page, so the toast itself — created and removed each time —
 * can never be one. These two are made once, when the editor is built, and
 * stay: `status` (polite) for every ordinary message, `alert` for failures.
 * Both are visually hidden (.ed-sr-only); the visible toast is unchanged.
 */
const IDS = { status: 'ed-live-status', alert: 'ed-live-alert' } as const
const pending: Record<string, number> = {}

export function ensureLiveRegions(): void {
  for (const [role, id] of Object.entries(IDS)) {
    if (document.getElementById(id)) continue
    const n = document.createElement('div')
    n.id = id
    n.className = 'ed-sr-only'
    n.setAttribute('role', role)
    n.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite')
    n.setAttribute('aria-atomic', 'true')
    document.body.appendChild(n)
  }
}

/** Say `message` in the status region, or in the alert region when `urgent`.
 *  Emptied first and filled on the next task, so the same words twice (a
 *  second refused save) are a change and are spoken again. */
export function announce(message: string, urgent = false): void {
  ensureLiveRegions()
  const id = urgent ? IDS.alert : IDS.status
  const n = document.getElementById(id)
  if (!n) return
  n.textContent = ''
  clearTimeout(pending[id])
  pending[id] = window.setTimeout(() => { n.textContent = message }, 30)
}

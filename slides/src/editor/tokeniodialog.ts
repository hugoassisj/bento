// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The Tokens view's ⋯ menu: Export tokens… and Import tokens…, in the kernel
// dialog (focus trap, Escape). The mapping and the gate are tokenio.ts and
// tokenimport.ts; this file only shows them.
//
// Export shows the file (a design-tokens JSON of the deck's tokens and theme
// colours, nothing else) with Copy and Download. Import takes pasted JSON or a
// file — read locally, never fetched — and shows a review before anything
// changes: new / changed (old → new) / unchanged / skipped with the reason, a
// box per row, "Replace existing" off by default, the theme colours off by
// default. Apply is one store.commit: one undo step.
import type { Store } from '../store'
import type { TokenType, TokenValue } from '../model'
import { exportTokens, TOKEN_FILE_LIMITS } from '../tokenio'
import { applyImport, planImport, type ImportPlan, type ImportRow, type Reason } from '../tokenimport'
import { exportBase } from '../exportimages'
import { downloadBlob } from './exportimages'
import { preview, shownValue } from './inspector/tokenpicker'
import { slotLabel } from './inspector/controls'
import { createDialog } from '../../../kernel/src/ui/dialog.ts'
import '../../../kernel/src/ui/dialog.css'
import { APP_VERSION } from '../update'
import { t } from '../i18n'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text) n.textContent = text
  return n
}
const btn = (text: string, primary = false) => { const b = el('button', primary ? 'ed-btn ed-primary' : 'ed-btn', text); b.type = 'button'; return b }

/** Export tokens…: the file, with Copy and Download. */
export function openExportTokens(store: Store, toast: (m: string) => void) {
  const json = JSON.stringify(exportTokens(store.doc, APP_VERSION), null, 2)
  const body = el('div', 'ed-tokio')
  const ta = el('textarea', 'ed-about-json')
  ta.readOnly = true
  ta.rows = 12
  ta.value = json
  ta.setAttribute('aria-label', t('Export tokens'))
  body.append(ta)
  const close = btn(t('Cancel'))
  const copy = btn(t('Copy'))
  const save = btn(t('Download'), true)
  const dlg = createDialog({ title: t('Export tokens'), content: body, actions: [close, copy, save] })
  close.addEventListener('click', () => dlg.close())
  copy.addEventListener('click', () => { void navigator.clipboard?.writeText(json).then(() => toast(t('Tokens copied')), () => ta.select()) })
  save.addEventListener('click', () => { downloadBlob(new Blob([json], { type: 'application/json' }), `${exportBase(store.doc)}.tokens.json`); dlg.close() })
  dlg.open()
}

/** A skipped row's reason, in words. */
function reasonText(r: ImportRow): string {
  const d = r.detail ?? ''
  const words: Record<Reason, () => string> = {
    type: () => t('Bento has no {type} tokens', { type: d }),
    value: () => t('Not a value of this type'),
    unit: () => t('The unit {unit} is not supported', { unit: d }),
    expression: () => t('Expressions are not supported'),
    colorSpace: () => t('The color space {space} is not supported', { space: d }),
    layers: () => t('Only a single shadow layer is supported'),
    inset: () => t('Inner shadows are not supported'),
    spread: () => t('Shadow spread is not supported'),
    name: () => t('Not a usable name'),
    proto: () => t('A name the deck refuses'),
    kind: () => t('Already a {type} token in this deck', { type: d }),
    alias: () => t('The alias {ref} is not in the file', { ref: d }),
    loop: () => t('The alias {ref} refers back to itself', { ref: d }),
    modes: () => t('A deck has 16 modes at most'),
    depth: () => t('Nested too deeply'),
    notToken: () => t('Not a token'),
    unsafe: () => t('Refused by the deck’s safety rules'),
  }
  return words[r.reason ?? 'value']()
}

/** Per mode, or the one value when there is one mode. */
const valuesText = (type: TokenType, v: Record<string, TokenValue> | undefined) => {
  const e = Object.entries(v ?? {})
  return e.length === 1 ? shownValue(type, e[0][1]) : e.map(([m, x]) => `${m}: ${shownValue(type, x)}`).join(' · ')
}

/** Import tokens…: paste or choose, then review, then Apply. */
export function openImportTokens(store: Store, toast: (m: string) => void) {
  const body = el('div', 'ed-tokio')
  const back = btn(t('Cancel'))
  const go = btn(t('Review'), true)
  const dlg = createDialog({ title: t('Import tokens'), content: body, actions: [back, go] })
  back.addEventListener('click', () => dlg.close())

  // --- step 1: the file
  const ta = el('textarea', 'ed-about-json')
  ta.rows = 10
  ta.placeholder = '{ "color": { "brand": { "$type": "color", "$value": "#ff9e8a" } } }'
  ta.setAttribute('aria-label', t('Import tokens'))
  const file = el('input')
  file.type = 'file'
  file.accept = '.json,application/json'
  file.hidden = true
  const choose = btn(t('Choose file…'))
  choose.addEventListener('click', () => file.click())
  const why = el('p', 'ed-tokio-why')
  why.setAttribute('role', 'alert')
  const errors = { size: () => t('The file is over 1 MB'), json: () => t('That is not design-tokens JSON'), empty: () => t('No tokens found in this file') }
  file.addEventListener('change', () => {
    const f = file.files?.[0]
    if (!f) return
    if (f.size > TOKEN_FILE_LIMITS.bytes) { why.textContent = errors.size(); return }
    void f.text().then((s) => { ta.value = s; review() })
  })
  ta.addEventListener('input', () => { why.textContent = '' })
  body.append(el('p', 'ed-hint', t('Paste design-tokens JSON or choose a file. Nothing is fetched.')), ta, choose, file, why)

  // --- step 2: the review
  let plan: ImportPlan | undefined
  let reviewing = false
  const ticked = new Set<string>()
  let replace = false
  let withTheme = false
  const check = (label: string, on: boolean, set: (v: boolean) => void) => {
    const l = el('label', 'ed-tokio-opt')
    const c = el('input')
    c.type = 'checkbox'
    c.checked = on
    c.addEventListener('change', () => set(c.checked))
    l.append(c, ` ${label}`)
    return l
  }
  const syncGo = () => { go.disabled = !ticked.size && !(withTheme && plan?.theme.length) }
  const review = (eachSetIsMode?: boolean) => {
    const p = planImport(store.doc, ta.value, { eachSetIsMode })
    if (p.error) { why.textContent = errors[p.error](); return }
    plan = p
    ticked.clear()
    for (const r of p.rows) if (r.status === 'new' || (r.status === 'changed' && replace)) ticked.add(r.name)
    const n = (s: ImportRow['status']) => p.rows.filter((r) => r.status === s).length
    const head = el('p', 'ed-tokio-sum', t('{n} new · {m} changed · {u} unchanged · {s} skipped', { n: n('new'), m: n('changed'), u: n('unchanged'), s: n('skipped') }))
    const notes = [head]
    if (p.aliases) notes.push(el('p', 'ed-hint', t('{n} aliases resolved to their values', { n: p.aliases })))
    if (p.overLimit) notes.push(el('p', 'ed-hint', t('{n} more tokens left out: a deck holds 500 at most', { n: p.overLimit })))
    const opts = el('div', 'ed-tokio-opts')
    if (p.setsLike) opts.append(check(t('Each set is a mode'), p.eachSetIsMode, (v) => review(v)))
    if (n('changed')) opts.append(check(t('Replace existing'), replace, (v) => { replace = v; review(p.eachSetIsMode) }))
    if (p.theme.length) opts.append(check(t('Set the theme colors too'), withTheme, (v) => { withTheme = v; syncGo() }))
    const list = el('div', 'ed-tokio-list')
    list.setAttribute('role', 'list')
    const order: ImportRow['status'][] = ['new', 'changed', 'unchanged', 'skipped']
    const caption = { new: () => t('New'), changed: () => t('Changed'), unchanged: () => t('Unchanged'), skipped: () => t('Skipped') }
    for (const s of order) {
      const rows = p.rows.filter((r) => r.status === s)
      if (!rows.length) continue
      list.append(el('h4', 'ed-tokio-cap', `${caption[s]()} · ${rows.length}`))
      for (const r of rows) {
        const line = el('label', `ed-tokio-row ed-tokio-${s}`)
        line.setAttribute('role', 'listitem')
        if (s === 'new' || s === 'changed') {
          const c = el('input')
          c.type = 'checkbox'
          c.checked = ticked.has(r.name)
          c.setAttribute('aria-label', r.name)
          c.addEventListener('change', () => { if (c.checked) ticked.add(r.name); else ticked.delete(r.name); syncGo() })
          line.append(c)
        } else line.append(el('span', 'ed-tokio-box'))
        const first = Object.values(r.values)[0]
        line.append(r.type && first !== undefined ? preview(r.type, first) : el('span', 'ed-tokio-box'))
        line.append(el('span', 'ed-tokio-name', s === 'skipped' ? r.source : r.name))
        line.append(el('span', 'ed-tokio-val', s === 'skipped' ? reasonText(r)
          : s === 'changed' ? `${valuesText(r.type!, r.old)} → ${valuesText(r.type!, r.values)}` : valuesText(r.type!, r.values)))
        line.title = s === 'skipped' ? `${r.source} — ${reasonText(r)}` : r.source
        list.append(line)
      }
    }
    if (p.theme.length) {
      list.append(el('h4', 'ed-tokio-cap', t('Set the theme colors too')))
      for (const c of p.theme) {
        const line = el('div', 'ed-tokio-row')
        line.append(el('span', 'ed-tokio-box'), preview('color', c.value), el('span', 'ed-tokio-name', slotLabel(c.slot)),
          el('span', 'ed-tokio-val', `${shownValue('color', c.old ?? '')} → ${shownValue('color', c.value)}`))
        list.append(line)
      }
    }
    body.replaceChildren(...notes, opts, list)
    go.textContent = t('Apply')
    reviewing = true
    syncGo()
  }
  go.addEventListener('click', () => {
    if (!reviewing || !plan) return review()
    const p = plan
    let n = 0
    store.commit(() => { n = applyImport(store.doc, p, ticked, withTheme) })
    dlg.close()
    toast(t('{n} tokens imported', { n }))
  })
  dlg.open()
  ta.focus()
}

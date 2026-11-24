// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Check deck: validate()'s findings, shown in the editor.
//
// `window.bento.validate()` knows about text that does not fit, tables that
// run off the slide, dead links, missing pictures and effects that never run;
// before this, only someone typing in the console ever saw it. This shows the
// same findings in plain words — nothing new is checked here (validate.ts and
// visualchecks.ts decide, and their quiet-where-unsure rules, DECISIONS
// 2026-11-24, are kept by not second-guessing a single finding).
//
// Three parts:
//  - a chip at the head of the canvas's bottom-end cluster, [chip] [notes]
//    [Slideshow] [zoom], with the count of errors and warnings. No chip when
//    there are none; tips (`info`) are never counted.
//  - a panel, a labelled region floating over the canvas's top-end corner. It
//    is not modal: a row jumps to its element and the panel stays, so you can
//    fix, look and go on. Rows are buttons in slide order, errors first on
//    each slide; tips fold under a toggle, closed by default. ↑/↓ move between
//    rows, Escape closes and puts focus back where it was.
//  - fixes, only where safe and obvious, each one undo step and each saying
//    what it will do: fit a text box or a table to what it holds, remove a
//    dead link, show an element's font. Design findings (contrast, overlap,
//    bleed) get none. A read-only viewer sees the findings without them.
//
// WHEN IT RUNS. On open (once the fonts are in, or the measured checks would
// be measuring fallback faces), then: with the panel open, 300ms after each
// change; with it closed, 2s after the last change, on a slide change and on
// save if the deck changed since — never per keystroke. A text box being typed
// in changes nothing until the edit commits, so typing runs nothing. One run
// of the starter (19 slides, 336 elements) costs about 60ms in Chromium, which
// is why closed means "once things settle" and not "after every edit".
// The panel's being open is viewer state; it never enters the document.

import type { Store } from '../store'
import type { BentoDoc, Slide, SlideElement, TableElement, TextElement } from '../model'
import { paginates } from '../model'
import { validateDoc, type Finding, type Severity, type ValidateResult } from '../validate'
import { FINDING_LABELS } from '../findinglabels'
import { measureElement, measureTables } from '../measure'
import { fieldContext } from '../render'
import { labelIn } from './layerrows'
import { ICONS } from '../icons'
import { t } from '../i18n'

/** One finding's identity across runs: what, where. */
export const findingKey = (f: Finding) => [f.code, f.slide ?? '', f.element ?? '', f.path ?? ''].join('\u001f')

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

export interface CheckDeckHost {
  store: Store
  /** the canvas's bottom-end cluster: the chip goes first in it */
  cluster: HTMLElement
  /** the canvas wrap: the panel floats in its top-end corner */
  into: HTMLElement
  signal: AbortSignal
  /** bring the Format panel's font control into view, the element selected */
  revealFont: () => void
  /** the chip came, went or changed width: the cluster refits its row */
  onChipChange: () => void
}

/** The counts in words: "1 error, 6 warnings". */
export function countWords(counts: Record<Severity, number>): string {
  const parts: string[] = []
  if (counts.error) parts.push(counts.error === 1 ? t('1 error') : t('{n} errors', { n: String(counts.error) }))
  if (counts.warning) parts.push(counts.warning === 1 ? t('1 warning') : t('{n} warnings', { n: String(counts.warning) }))
  return parts.join(', ')
}

export class CheckDeck {
  readonly chip: HTMLButtonElement
  readonly panel: HTMLElement
  private list: HTMLElement
  private summary: HTMLElement
  private filterNote: HTMLElement
  private result: ValidateResult | null = null
  /** store.revision the last result was taken at */
  private ranAt = -1
  private runs = 0
  private timer = 0
  private opener: HTMLElement | null = null
  /** findings to show, by key — Replace from JSON shows what the load brought in */
  private only: Set<string> | null = null
  private tipsOpen = false
  /** a replaced document re-checks at once: the old deck's count must not linger */
  private replaced = false

  constructor(private host: CheckDeckHost) {
    const { store, into, signal } = host
    const chip = this.chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'ed-btn ed-check-chip'
    chip.hidden = true
    chip.setAttribute('aria-controls', 'ed-check')
    chip.setAttribute('aria-expanded', 'false')
    chip.addEventListener('click', () => this.isOpen ? this.close() : this.open({ opener: chip }))
    // In the row only while there is something to count (paint): a clean
    // deck's cluster is exactly what it was before the chip existed.

    const panel = this.panel = document.createElement('section')
    panel.className = 'ed-check'
    panel.id = 'ed-check'
    panel.hidden = true
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-labelledby', 'ed-check-h')
    const head = document.createElement('div')
    head.className = 'ed-check-head'
    const h = document.createElement('h2')
    h.id = 'ed-check-h'
    h.textContent = t('Check deck')
    this.summary = document.createElement('span')
    this.summary.className = 'ed-check-sum'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'ed-btn ed-check-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('Close'))
    close.title = t('Close')
    close.addEventListener('click', () => this.close())
    head.append(h, this.summary, close)
    this.filterNote = document.createElement('div')
    this.filterNote.className = 'ed-check-filter'
    this.filterNote.hidden = true
    this.list = document.createElement('div')
    this.list.className = 'ed-check-list'
    panel.append(head, this.filterNote, this.list)
    // The panel's keys are its own while focus is in it: an arrow here is not
    // a nudge, a letter is not a tool, Delete or ⌘⌫ does not delete the
    // element a row just selected. Other ⌘/Ctrl chords pass, so ⌘Z still
    // undoes a fix.
    panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.close(); return }
      const step = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[ev.key]
      if (step !== undefined && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        const rows = [...panel.querySelectorAll<HTMLElement>('.ed-check-jump')].filter((b) => b.offsetParent)
        const at = rows.indexOf(document.activeElement as HTMLElement)
        const next = rows[at < 0 && Math.abs(step) === 1 ? 0 : Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + step))]
        if (next) { ev.preventDefault(); next.focus() }
      }
      if ((!ev.metaKey && !ev.ctrlKey) || ev.key === 'Backspace' || ev.key === 'Delete') ev.stopPropagation()
    })
    // A press anywhere else hands the keys back: after a row jumps and the
    // person clicks the canvas, the arrows nudge and typing types again.
    document.addEventListener('pointerdown', (ev) => {
      const active = document.activeElement as HTMLElement | null
      if (active && panel.contains(active) && !panel.contains(ev.target as Node)) active.blur()
    }, { capture: true, signal })
    into.appendChild(panel)

    const offs = [
      store.on('replace', () => { this.replaced = true }),
      store.on('doc', () => this.schedule(this.replaced ? 0 : this.isOpen ? 300 : 2000)),
      store.on('current', () => { if (!this.isOpen && this.stale) this.schedule(0) }),
      store.on('dirty', () => { if (!store.dirty && this.stale) this.schedule(0) }),
    ]
    signal.addEventListener('abort', () => { offs.forEach((off) => off()); clearTimeout(this.timer) }, { once: true })
    // on open: the measured checks need the deck's real fonts
    void document.fonts?.ready.then(() => requestAnimationFrame(() => { if (!signal.aborted) this.run() }))
  }

  get isOpen() { return !this.panel.hidden }
  private get stale() { return this.ranAt !== this.host.store.revision }

  private schedule(ms: number) {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.run(), ms)
  }

  /** Validate now, and show it. */
  run(): ValidateResult {
    clearTimeout(this.timer)
    this.replaced = false
    this.ranAt = this.host.store.revision
    this.result = validateDoc(this.host.store.doc)
    this.panel.dataset.runs = String(++this.runs)
    this.paint()
    return this.result
  }

  /** The current findings (a fresh run if the deck changed since the last). */
  findings(): Finding[] {
    return (this.stale || !this.result ? this.run() : this.result).findings
  }

  open(opts: { only?: Set<string> | null; opener?: HTMLElement | null } = {}) {
    if (!this.isOpen) this.opener = opts.opener ?? (document.activeElement as HTMLElement | null)
    this.only = opts.only ?? null
    this.panel.hidden = false
    this.chip.setAttribute('aria-expanded', 'true')
    this.run()
    const first = this.panel.querySelector<HTMLElement>('.ed-check-jump') ?? this.panel.querySelector<HTMLElement>('.ed-check-close')
    first?.focus({ preventScroll: true })
  }

  close() {
    if (!this.isOpen) return
    const hadFocus = this.panel.contains(document.activeElement)
    this.panel.hidden = true
    this.only = null
    this.chip.setAttribute('aria-expanded', 'false')
    if (hadFocus) {
      const back = this.opener?.isConnected && this.opener.offsetParent ? this.opener : this.chip.isConnected ? this.chip : null
      back?.focus({ preventScroll: true })
    }
    this.opener = null
  }

  private paint() {
    const r = this.result!
    const counted = { error: r.counts.error, warning: r.counts.warning, info: 0 }
    const words = countWords(counted)
    const count = words ? String(counted.error + counted.warning) : ''
    if (count !== this.chip.textContent || !!words !== this.chip.isConnected) {
      this.chip.hidden = !words
      if (words) {
        const label = t('{counts}, check deck', { counts: words })
        this.chip.innerHTML = ICONS.alert
        const n = document.createElement('span')
        n.textContent = count
        this.chip.appendChild(n)
        this.chip.setAttribute('aria-label', label)
        this.chip.title = label
        if (!this.chip.isConnected) this.host.cluster.prepend(this.chip)
      } else {
        this.chip.replaceChildren()
        this.chip.remove()
      }
      this.host.onChipChange()
    }
    if (words) {
      // the words can change with the count unchanged (an error for a warning)
      const label = t('{counts}, check deck', { counts: words })
      this.chip.setAttribute('aria-label', label)
      this.chip.title = label
      this.chip.dataset.sev = counted.error ? 'error' : 'warning'
    }
    if (!this.isOpen) return
    const keepFocus = (document.activeElement as HTMLElement | null)?.dataset?.key
    this.summary.textContent = words
    const shown = this.only ? r.findings.filter((f) => this.only!.has(findingKey(f))) : r.findings
    this.filterNote.hidden = !this.only
    if (this.only) {
      const all = document.createElement('button')
      all.type = 'button'
      all.className = 'ed-check-link'
      all.textContent = t('Show all')
      all.addEventListener('click', () => { this.only = null; this.paint() })
      this.filterNote.replaceChildren(t('Showing what the loaded JSON brought in'), ' ', all)
    }
    const main = shown.filter((f) => f.severity !== 'info')
    const tips = shown.filter((f) => f.severity === 'info')
    const kids: HTMLElement[] = []
    // tips are not issues: a deck with only tips has no issues, and says so
    if (!main.length) {
      const p = document.createElement('p')
      p.className = 'ed-check-empty'
      p.textContent = t('No issues found in this deck')
      kids.push(p)
    }
    kids.push(...this.rows(main))
    if (tips.length) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'ed-check-tips ed-sec-toggle'
      toggle.textContent = t('Tips ({n})', { n: String(tips.length) })
      toggle.setAttribute('aria-expanded', String(this.tipsOpen))
      toggle.classList.toggle('closed', !this.tipsOpen)
      const box = document.createElement('div')
      box.className = 'ed-check-tiplist'
      box.hidden = !this.tipsOpen
      box.append(...this.rows(tips))
      toggle.addEventListener('click', () => {
        this.tipsOpen = !this.tipsOpen
        box.hidden = !this.tipsOpen
        toggle.setAttribute('aria-expanded', String(this.tipsOpen))
        toggle.classList.toggle('closed', !this.tipsOpen)
      })
      kids.push(toggle, box)
    }
    this.list.replaceChildren(...kids)
    if (keepFocus) this.list.querySelector<HTMLElement>(`.ed-check-jump[data-key="${CSS.escape(keepFocus)}"]`)?.focus({ preventScroll: true })
  }

  /** Rows in deck order — the deck's own findings first, then slide by slide,
   *  errors before warnings on each. */
  private rows(findings: Finding[]): HTMLElement[] {
    const doc = this.host.store.doc
    const at = new Map(doc.slides.map((s, i) => [s.id, i]))
    const sorted = findings.map((f, i) => ({ f, i })).sort((a, b) =>
      ((a.f.slide ? at.get(a.f.slide) ?? 1e9 : -1) - (b.f.slide ? at.get(b.f.slide) ?? 1e9 : -1))
      || RANK[a.f.severity] - RANK[b.f.severity] || a.i - b.i)
    let lastSlide: string | undefined = '\u0000'
    return sorted.map(({ f }) => {
      const row = this.row(f, doc)
      if (f.slide !== lastSlide && lastSlide !== '\u0000') row.classList.add('ed-check-newslide')
      lastSlide = f.slide
      return row
    })
  }

  private row(f: Finding, doc: BentoDoc): HTMLElement {
    const slideIdx = f.slide ? doc.slides.findIndex((s) => s.id === f.slide) : -1
    const slide = slideIdx >= 0 ? doc.slides[slideIdx] : undefined
    const el = slide && f.element ? slide.elements.find((e) => e.id === f.element) : undefined
    const where = [slide ? t('Slide {n}', { n: String(slideNumber(doc, slideIdx)) }) : t('Deck')]
    if (el) where.push(labelIn(slide!, el, t))
    const label = FINDING_LABELS[f.code]

    const row = document.createElement('div')
    row.className = 'ed-check-row'
    row.dataset.sev = f.severity
    row.dataset.code = f.code
    const jump = document.createElement('button')
    jump.type = 'button'
    jump.className = 'ed-check-jump'
    jump.dataset.key = findingKey(f)
    const sev = document.createElement('span')
    sev.className = 'ed-check-sev'
    sev.setAttribute('aria-hidden', 'true')
    sev.innerHTML = f.severity === 'info' ? ICONS.info : ICONS.alert
    const sevName = document.createElement('span')
    sevName.className = 'ed-sr-only'
    sevName.textContent = f.severity === 'error' ? t('Error') : f.severity === 'warning' ? t('Warning') : t('Tip')
    const text = document.createElement('span')
    text.className = 'ed-check-text'
    const whereEl = document.createElement('span')
    whereEl.className = 'ed-check-where'
    whereEl.textContent = where.join(' · ') + ' · '
    const what = document.createElement('span')
    what.className = 'ed-check-what'
    what.textContent = label ? t(label) : f.message
    text.append(whereEl, what)
    if (label) {
      // the precise message, developer English, as the second line
      const detail = document.createElement('span')
      detail.className = 'ed-check-detail'
      detail.textContent = f.message
      text.appendChild(detail)
    }
    jump.title = f.message
    jump.append(sev, sevName, text)
    jump.addEventListener('click', () => this.jump(f))
    row.appendChild(jump)
    const fix = this.fixFor(f, slide, el)
    if (fix) row.appendChild(fix)
    return row
  }

  /** Go to the finding's slide and select its element. */
  private jump(f: Finding): boolean {
    const store = this.host.store
    const at = f.slide ? store.doc.slides.findIndex((s) => s.id === f.slide) : -1
    if (at < 0) return false
    if (at !== store.currentIndex) store.goTo(at)
    if (!f.element || !store.element(f.element)) { store.select([]); return true }
    store.select([f.element])
    // a zoomed-in canvas may have the element out of view: scroll it in
    requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`.ed-stage-scale [data-el-id="${CSS.escape(f.element!)}"]`)
      const scroller = node?.closest<HTMLElement>('.ed-scroll')
      if (!node || !scroller) return
      const n = node.getBoundingClientRect(), s = scroller.getBoundingClientRect()
      if (n.right < s.left || n.left > s.right) scroller.scrollLeft += n.left - s.left - (s.width - n.width) / 2
      if (n.bottom < s.top || n.top > s.bottom) scroller.scrollTop += n.top - s.top - (s.height - n.height) / 2
    })
    return true
  }

  /** The one safe, obvious fix for a finding, if there is one and the deck
   *  can be edited. Each is one commit, so one ⌘Z. */
  private fixFor(f: Finding, slide: Slide | undefined, el: SlideElement | undefined): HTMLElement | null {
    const store = this.host.store
    if (store.readOnly || store.doc.readonly || !slide || !el) return null
    const button = (label: string, title: string, run: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ed-btn ed-check-fix'
      b.textContent = label
      b.title = title
      b.addEventListener('click', () => {
        // the row goes once the finding does: hand focus to the next row
        const next = b.closest('.ed-check-row')?.nextElementSibling?.querySelector<HTMLElement>('.ed-check-jump')?.dataset.key
        run()
        this.run()
        const to = (next && this.list.querySelector<HTMLElement>(`.ed-check-jump[data-key="${CSS.escape(next)}"]`))
          || this.list.querySelector<HTMLElement>('.ed-check-jump') || this.panel.querySelector<HTMLElement>('.ed-check-close')
        to?.focus({ preventScroll: true })
      })
      return b
    }
    // measured and changed at click time, on the live document: an undo
    // since this row was drawn has replaced every object it saw
    const live = (): { s: Slide; e: SlideElement } | null => {
      const s = store.doc.slides.find((x) => x.id === slide.id)
      const e = s?.elements.find((x) => x.id === el.id)
      return s && e ? { s, e } : null
    }
    const textNeed = (s: Slide, e: TextElement) => measureElement(e, store.doc, fieldContext(store.doc, s)).height
    const rowsNeed = (e: TableElement) => measureTables([e], store.doc)[0].height
    if (f.code === 'text-overflow' && el.type === 'text') {
      return button(t('Fit box to text'), t('Sets the box to {h}px tall, the height its text needs', { h: String(textNeed(slide, el)) }), () => {
        const l = live()
        if (l?.e.type === 'text') { const h = textNeed(l.s, l.e); store.commit(() => { l.e.h = h }) }
      })
    }
    if (f.code === 'table-overflow' && el.type === 'table') {
      return button(t('Fit box to rows'), t('Sets the box to {h}px tall, the height its rows need', { h: String(rowsNeed(el)) }), () => {
        const l = live()
        if (l?.e.type === 'table') { const h = rowsNeed(l.e); store.commit(() => { l.e.h = h }) }
      })
    }
    if (f.code === 'broken-link' && el.link) {
      return button(t('Remove link'), t('Takes the link off this element; it led nowhere'), () => {
        const l = live()
        if (l?.e.link) store.commit(() => { delete l.e.link })
      })
    }
    if (f.code === 'font-not-embedded' && (el.type === 'text' || el.type === 'code')) {
      return button(t('Show the font'), t('Selects the element and shows its font in the Format panel'), () => {
        if (this.jump(f)) requestAnimationFrame(() => this.host.revealFont())
      })
    }
    return null
  }
}

/** The number the slide list shows for a slide; a variant counts as its parent. */
function slideNumber(doc: BentoDoc, idx: number): number {
  const s = doc.slides[idx]
  const parent = s?.stateOf ? doc.slides.findIndex((x) => x.id === s.stateOf) : -1
  const i = parent >= 0 ? parent : idx
  return Math.max(1, doc.slides.slice(0, i + 1).filter((x) => paginates(x, doc)).length)
}

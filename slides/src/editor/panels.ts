// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Right-hand properties panel. Shows slide properties when nothing is
// selected, element properties otherwise. Bursts of 'input' events collapse
// into a single undo checkpoint.

import type { Store } from '../store'
import { MEDIA_EMBED_BUDGET, applyChartPalette, defaultChart, internAsset, morphKey, paginates, isWebUrl, tableStyleFor, uid, type ChartElement, type ImageElement, type LineEnding, type MediaElement, type ShapeElement, type Slide, type SlideElement, type TableElement, type TextElement, type TransitionKind, type CodeElement, type BentoDoc, type EmbedElement } from '../model'
import { CROP_MAX_SCALE, normalizeCrop } from '../crop'
import { LANGS } from '../../../kernel/src/tokenize.ts'
import { cssColor, resolveAsset } from '../render'
import { measureElement } from '../measure'
import { PALETTE_SLOTS, paletteOf, refAt, setColor, slotIsSet } from '../palette'
import { CHART_PRESETS } from '../charts'
import { FONT_CHOICES, firstFamily, injectFonts } from '../fonts'
import { fontFaceDescriptors } from '../fontmeta'
import { CODE_SCOPES, DEFAULT_CODE_COLORS } from '../code'
import { TIPS } from '../tips'
import { DATE_PRESETS, TIME_PRESETS, OTHER_FIELDS, formatDate } from '../datefmt'
import { shrinkImageFile, shrinkNote, fmtBytes } from './shrink'
import { revealInOrder, revealTogether, removeReveal, type StepPatch } from './reveal'
import { stepOf } from '../steps'
import { ICONS } from '../icons'
import { LayersUI, labelFor, GLYPH as LAYER_GLYPH } from './layers'
import { isMacOS } from '../screens'
import { openCtxMenu } from './ctxmenu'
import { t } from '../i18n'
import { lsJson, lsSet } from '../../../kernel/src/storage.ts'

// Hover help for panel rows, keyed by the RAW English label (translated at
// render). A missing entry means no tooltip — better silence than an echo.
// i18n NOTE: both the keys (row labels) and the values here reach t() as
// VARIABLES — literal-extraction sweeps must treat this table as in-use
// catalog keys, never prune them.
/**
 * Sentinel <option> value for "clear the morph override". Safe against
 * collision with a real morph key by construction: setMorphId strips anything
 * outside [A-Za-z0-9._-], so no stored morphId can ever contain '#'.
 */
const UNPAIR = '#unpair'

const ROW_TIPS: Record<string, string> = {
  'Page size': 'Deck-wide slide size. Elements keep their positions — changing size reframes the canvas, never rescales your art.',
  'Width': 'Custom slide width in pixels',
  'Height': 'Custom slide height in pixels',
  'Slide number': 'Deck-wide. Show the slide counter to the audience while presenting.',
  'Progress bar': 'Deck-wide. Show the thin progress bar along the bottom while presenting.',
  'Corner arrows': 'Deck-wide. Show clickable ‹ › arrows in the corner while presenting. Off by default — clicks and arrow keys already move between slides.',
  'Background': 'This slide’s background colour',
  'Transition': 'How this slide comes in. Morph moves matching elements from the previous slide into place.',
  'Slide name': 'Optional. Shown in the Link to and Variant of lists and on variant thumbnails, so this slide is easy to pick.',
  'On hover': 'While presenting, what happens when the pointer rests on an element that has a Hover group: dim the other groups, or switch which content shows.',
  'Fade others to': 'How visible the other groups stay while one is pointed at: 0 = hidden, 1 = no fading. 0.15 is a soft fade.',
  'Shown at rest': 'The Hover group whose content shows before the pointer is on anything. Empty = nothing extra.',
  'Preview on canvas': 'Which Hover group’s content the canvas shows while you edit. Doesn’t change the show.',
  'Layout role': 'What this text is in the layout (title, body…). Apply layout uses it to put content in the matching place.',
  'Shadow': 'Drop-shadow presets — the shadow follows the element’s real shape, corners and transparency',
  'Color': 'Colour with opacity — pick with the swatch, the % field is how opaque it is',
  'Entrance': 'How the element appears when the slide comes in. Skipped when it morphs in from the previous slide.',
  'Entrance (s)': 'How long the entrance takes, in seconds',
  'Appears on click': '0 = shown with the slide. 1 = appears on the first click or → press, 2 = on the second, and so on. Elements with the same number appear together.',
  'Count up numbers': 'Numbers in this text count up from zero when the slide enters',
  'Typewriter': 'Code types in a character at a time, behind a cursor, when it appears',
  'Pan & zoom': 'Slow, continuous Ken Burns motion while the slide is on screen — made for full-bleed photos.',
  'Motion': 'Drift: an endless slow pan and zoom. Zoom out / Zoom in: one smooth zoom each time the slide appears.',
  'Zoom': 'How far the picture is zoomed inside its frame',
  'Zoom amount %': 'How far the Ken Burns zoom travels',
  'Pan & zoom (s)': 'How long one pan-and-zoom pass takes, in seconds',
  // 'Loop animation' — NOT 'Loop': the media panel's playback toggle owns that
  // word, and one key cannot mean both (a language must pick one and be wrong
  // in the other place).
  'Loop animation': 'A repeating animation: marching dashes along strokes, or motion along a drawn path',
  'Seconds per lap': 'How long one lap takes — lower is faster',
  'Motion path': 'The motion path — edit it as draggable points on the canvas',
  'Lap speed': 'How the speed changes during one lap — constant, or easing in and out at the ends',
  'Show on hover of': 'Type a Hover group name: this element stays hidden until the pointer is on an element of that group (slide’s On hover: Switch content). Empty = always visible.',
  'Hover group': 'A name shared by elements that react to the pointer together while presenting (see On hover on the slide). Not the same as ⌘G grouping.',
  'Link to': 'Clicking this element during the show jumps to the chosen slide',
  'Web link': 'Clicking this element during the show opens this web page in a new tab (https:// only)',
  'Font': 'Typeface for this text',
  'Size (pt)': 'Font size in points',
  'Weight': 'Font weight — 400 regular, 700 bold',
  'Align': 'Horizontal text alignment',
  'Vertical align': 'Vertical alignment inside the box',
  'Line height': 'Line spacing as a multiple of the font size',
  'Fill style': 'Solid colour or a linear gradient',
  'Fill': 'Fill colour with opacity — for lines this IS the line colour',
  'Gradient angle': 'Gradient direction in degrees (CSS convention: 0° points up)',
  'Stroke': 'Outline colour',
  'Stroke width': 'Outline thickness in pixels',
  'Line style': 'Solid, dashed or dotted stroke',
  'Line start': 'Decoration at the line’s start — arrow, dot or bar',
  'Line end': 'Decoration at the line’s end — arrow, dot or bar',
  'Corner radius': 'How rounded the corners are, in pixels',
  'Keep aspect ratio': 'On: a resize keeps the image’s proportions (Shift frees it for one drag). Off: width and height move independently and the image stretches',
  'Type': 'Chart type — switching bar⇄pie animates the data across',
  'Legend': 'Show the series legend above the chart',
  'Second axis': 'Adds a right-hand value axis — assign series to it in the list below',
  'Header row': 'Style the first row as a header',
  'Preset': 'Quick table looks — Lined, Zebra, Boxed, Minimal',
  'Header fill': 'Header row background colour',
  'Header text': 'Header row text colour',
  'Text': 'Table text colour',
  'Grid lines': 'Colour of the lines between cells',
  'Fit': 'How the media fills its box — cover crops to fill, contain letterboxes',
  'URL': 'Link a hosted file instead of embedding — keeps the deck small',
  'Poster': 'Preview image shown before the video plays',
  'Page URL': 'The web page the live frame loads while online (http or https)',
  'Live': 'Load the page in a sandboxed frame while online. Offline, or with offline mode on, the captured view shows instead.',
  'Variant of': 'Make this slide a variant of another slide: arrow keys skip it, the audience opens it by clicking a linked element, and matching elements morph between the two.',
  'Skip numbering': 'This slide stays in the show but gets no number of its own; its page-number field shows the previous slide’s.',
  'Number hidden slides': 'On: hidden slides keep their number, so the others don’t renumber when you hide one (as in PowerPoint). Off: the audience sees no gaps in the numbering.',
  'Blend mode': 'How this element mixes with what is underneath — Multiply darkens, Screen lightens.',
  'Morph name': 'Elements with the same morph name on neighbouring slides morph into each other. Until you change it, it is the element’s own name.',
  'Morph with': 'Pick an element on another slide; this one takes its morph name and morphs into it.',
}

/** An embed view from a raster: one <svg> around a data:image, sized to the
 *  element so it fills the box the way `fit: cover` would. */
function rasterView(dataUri: string, w: number, h: number): string {
  const vw = Math.max(1, Math.round(w)), vh = Math.max(1, Math.round(h))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}">`
    + `<image href="${dataUri.replace(/"/g, '')}" width="${vw}" height="${vh}" preserveAspectRatio="xMidYMid slice"/></svg>`
}

/** internAsset for raw svg markup: identical markup reuses its key. Callers
 *  run inside a store.commit for the same reason internAsset's do. */
function internView(doc: BentoDoc, markup: string): string {
  const assets = (doc.assets ??= {})
  for (const k in assets) if (assets[k] === markup) return `asset:${k}`
  const key = uid('a')
  assets[key] = markup
  return `asset:${key}`
}

/**
 * Fill-style options: the stored model words are 'solid'/'gradient', only the
 * LABEL is localised. 'solid' here is a solid COLOUR, which in many languages
 * is a different word from the 'solid' LINE style further down (Swedish:
 * enfärgad vs heldragen) — so it gets its own catalog key rather than sharing
 * one that must be wrong in one of the two places.
 *
 * A function, not a const: t() in a module-level const freezes the English at
 * import time.
 */
const fillStyles = (): Array<[string, string]> =>
  [['solid', t('solid colour')], ['gradient', t('gradient')]]

export class PropsPanel {
  private burst = false
  /** Indent (+1) / outdent (−1) bullets — set by the editor to the canvas,
   *  which knows whether a text box is open and where its caret is. */
  onListIndent: ((dir: 1 | -1) => void) | null = null

  constructor(
    private host: HTMLElement,
    private store: Store,
  ) {
    // Selection/slide switches always rebuild — the user acted outside the
    // panel, so whatever input was focused is obsolete. Doc mutations respect
    // a focused input (skip + mark stale) and catch up when focus leaves.
    store.on('selection', () => this.rebuild(true))
    store.on('current', () => this.rebuild(true))
    store.on('doc', () => this.rebuild())
    this.host.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.stale && !this.host.matches(':focus-within')) this.rebuild()
      }, 0)
    })
    this.rebuild()
  }

  private stale = false

  /**
   * True only while the user is mid-edit in a control a rebuild would
   * disrupt: typing in text/number fields, or the native color popup.
   * Discrete controls (selects, checkboxes, buttons) commit atomically, so
   * the panel rebuilds the moment they change — structural rows (shadow
   * color, fx options) appear immediately instead of after focus leaves.
   */
  private isActiveEditFocus(): boolean {
    const a = document.activeElement as HTMLElement | null
    if (!a || !this.host.contains(a)) return false
    if (a.tagName === 'TEXTAREA' || a.isContentEditable) return true
    if (a.tagName === 'INPUT') {
      const t = (a as HTMLInputElement).type
      return t !== 'checkbox' && t !== 'radio' && t !== 'button'
    }
    return false
  }

  /** checkpoint once per burst of continuous input, commit on change. */
  private edit(mutate: () => void, final: boolean) {
    if (!this.burst) {
      this.store.checkpoint()
      this.burst = true
    }
    mutate()
    this.store.touch()
    if (final) this.burst = false
  }

  /* The canonical API to edit `slide` attributes. */
  private editSlideAttrs(slideId: string, mutate: (slide: Slide) => void, final: boolean) {
    const slide = this.store.slideById(slideId)
    if (slide) {
      this.edit(() => {
        mutate(slide)
      }, final)
    }
  }

  private rebuild(force = false) {
    if (!force && this.isActiveEditFocus()) {
      this.stale = true // don't rip the field out from under the user; catch up on focusout
      return
    }
    this.stale = false
    this.burst = false
    // A doc edit rebuilds the same inspector in place: keep its scroll so a
    // control near the bottom does not throw the panel back to the top on
    // every change. A selection or slide switch (force) starts the new
    // inspector at the top, which is where a different subject belongs.
    const scrollTop = force ? 0 : this.host.scrollTop
    this.host.innerHTML = ''
    const els = this.store.selectedElements
    if (els.length === 0) this.buildSlidePanel()
    else if (els.length === 1) this.buildElementPanel(els[0])
    else this.buildMultiPanel(els)
    this.applyAccordion()
    this.mountTabs()
    this.mountContext(els)
    this.stackCrampedRows()
    this.host.scrollTop = scrollTop
  }

  /** Collapsed by default until the user opens them (persisted per title).
   *  English keys, matched against the TRANSLATED header like SHOW_SECTIONS. */
  private static CLOSED_BY_DEFAULT = ['Layout', 'Advanced (JSON)']

  /** Which tab a section lives on, by its English title — matched against
   *  the TRANSLATED header, like CLOSED_BY_DEFAULT. Format is the rest: how
   *  things look. Animate is how they move; Interact is what they do when the
   *  audience points at them. */
  private static TAB_SECTIONS: Record<'animate' | 'interact', string[]> = {
    animate: ['Animation', 'Morph', 'Transition'],
    interact: ['Interactivity'],
  }

  private tab: PanelTab = (() => {
    const saved = lsJson<string>('bento-panel-tab', 'format')
    return saved === 'animate' || saved === 'interact' ? saved : saved === 'show' ? 'animate' : 'format'
  })()

  /** Format | Animate | Interact, heading the panel the way design tools head
   *  theirs (Penpot: Design | Prototype | Inspect; Keynote: Format | Animate).
   *  A tab hides the others' sections with CSS (data-tab), so switching never
   *  rebuilds the panel or loses a field's state. A tab with nothing for this
   *  selection says so, rather than showing a blank. */
  private mountTabs() {
    const bar = document.createElement('div')
    bar.className = 'ed-tabs'
    bar.setAttribute('role', 'tablist')
    const tabs = [['format', t('Format')], ['animate', t('Animate')], ['interact', t('Interact')]] as const
    for (const [id, label] of tabs) {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(this.tab === id))
      b.textContent = label
      b.addEventListener('click', () => {
        this.tab = id
        lsSet('bento-panel-tab', JSON.stringify(id))
        this.host.dataset.tab = id
        for (const x of bar.children) x.setAttribute('aria-selected', String(x === b))
        this.stackCrampedRows() // rows on a hidden tab had no width to measure
      })
      bar.appendChild(b)
      if (!this.host.querySelector(`:scope > .ed-section[data-tab="${id}"], :scope > .ed-layer-block[data-tab="${id}"]`)) {
        const empty = document.createElement('p')
        empty.className = 'ed-hint ed-tab-empty'
        empty.dataset.tab = id
        empty.textContent = t('Nothing to set here for this selection.')
        this.host.appendChild(empty)
      }
    }
    // the pill sits in a full-width band of the panel's own surface: sticky,
    // it covers what scrolls under it edge to edge instead of floating over it
    const band = document.createElement('div')
    band.className = 'ed-tabs-band'
    band.appendChild(bar)
    this.host.prepend(band)
    this.host.dataset.tab = this.tab
  }

  /** The layer list: one instance, the SAME header and list nodes re-appended
   *  on every rebuild (a drag emits a doc event per frame; the rows are only
   *  rebuilt when what they say changed — layers.ts refresh). */
  /** The layer list. It lives in the side column now (editor.ts mounts it
   *  there); the panel still owns it because the panel owns the store verbs. */
  readonly layers = new LayersUI({
    slide: () => this.store.slide,
    selection: () => this.store.selection,
    select: (ids) => this.store.select(ids),
    setOrder: (elements) => this.store.commit(() => { this.store.slide.elements = elements }),
    rename: (id, name) => this.store.commit(() => {
      const el = this.store.element(id)
      if (!el) return
      if (name) el.name = name
      else delete el.name
    }),
    renameGroup: (gid, name) => this.store.commit(() => {
      for (const el of this.store.slide.elements) {
        if (el.groupId !== gid) continue
        if (name) el.groupName = name
        else delete el.groupName
      }
    }),
  })

  /**
   * Retrofit the flat panel into an accordion: every .ed-section header
   * gathers its following siblings into a collapsible body. Open state is
   * remembered per section title — everything stays discoverable (headers
   * always visible) while rarely-used sections stop costing space.
   */
  private applyAccordion() {
    let openState: Record<string, boolean> = {}
    openState = lsJson<Record<string, boolean>>('bento-panel-open', {})
    const headers = [...this.host.querySelectorAll<HTMLElement>('.ed-section')]
    const closed = new Set(PropsPanel.CLOSED_BY_DEFAULT.map((k) => t(k)))
    const tabOf = new Map<string, PanelTab>()
    for (const [tab, keys] of Object.entries(PropsPanel.TAB_SECTIONS)) for (const k of keys) tabOf.set(t(k), tab as PanelTab)
    for (const h of headers) {
      const key = h.dataset.key ?? h.textContent ?? ''
      const body = document.createElement('div')
      body.className = 'ed-section-body'
      let n: ChildNode | null = h.nextSibling
      while (n && !(n instanceof HTMLElement && n.classList.contains('ed-section'))) {
        const next: ChildNode | null = n.nextSibling
        body.appendChild(n)
        n = next
      }
      h.after(body)
      // Help paragraphs fold behind a "?" on the section's header line, as
      // design tools keep explanation out of the controls: hover or focus shows
      // it as a hint, a click unfolds it in place (touch has no hover). State
      // messages — .ed-status, the morph warning — are not help, and stay.
      const help = [...body.querySelectorAll<HTMLElement>(':scope > p.ed-hint:not(.ed-status, .ed-morph-warn, .ed-tab-empty, .ed-keep)')]
      if (help.length) {
        const q = document.createElement('button')
        q.type = 'button'
        q.className = 'ed-help-btn'
        q.textContent = '?'
        q.setAttribute('aria-label', t('Help'))
        q.setAttribute('aria-expanded', 'false')
        q.title = help.map((p) => p.textContent?.trim()).join('\n\n')
        q.addEventListener('click', () => q.setAttribute('aria-expanded', String(body.classList.toggle('ed-help-open'))))
        body.prepend(q)
      }
      h.dataset.tab = body.dataset.tab = tabOf.get(key) ?? 'format'
      const isOpen = openState[key] ?? !closed.has(key)
      h.classList.add('ed-sec-toggle')
      h.classList.toggle('closed', !isOpen)
      if (!isOpen) body.style.display = 'none'
      // A header can outlive a rebuild (the Layers h3 is one node for the
      // panel's life), so the click handler is attached once and reads its
      // body from the DOM each time rather than closing over one that a later
      // rebuild threw away.
      if (h.dataset.acc) continue
      h.dataset.acc = '1'
      h.addEventListener('click', () => {
        const nowClosed = h.classList.toggle('closed')
        const live = h.nextElementSibling as HTMLElement | null
        if (live?.classList.contains('ed-section-body')) live.style.display = nowClosed ? 'none' : ''
        if (!nowClosed) this.stackCrampedRows()
        const state = lsJson<Record<string, boolean>>('bento-panel-open', {})
        state[key] = !nowClosed
        lsSet('bento-panel-open', JSON.stringify(state))
      })
    }
  }

  // --- builders ---------------------------------------------------------------

  private static readonly PAGE_PRESETS: Record<string, { w: number; h: number }> = {
    'Widescreen 16:9': { w: 1280, h: 720 },
    'Classic 4:3': { w: 960, h: 720 },
    'Square 1:1': { w: 1080, h: 1080 },
    'Portrait 9:16': { w: 1080, h: 1920 },
    'A4 landscape': { w: 1123, h: 794 },
    'A4 portrait': { w: 794, h: 1123 },
  }


  private buildSlidePanel() {
    const slide = this.store.slide
    // Track the `slide.id` so when updating you can find the slide to update using its `id`. 
    // This way if the doc is actively replaced and the references are stale the update still succeeds.
    const slideId = slide.id
    this.section(t('Slide'))
    this.row('Background', this.color(slide.background, (v, fin) =>
      this.editSlideAttrs(slideId, (slide: Slide) => { slide.background = v }, fin),
      { id: null, path: 'background', slide }))
    // Hidden slides stay in the deck and stay editable; they drop out of the
    // walk, the PDF and the file thumbnail. Offered only on ordinary slides —
    // a state is already unreachable linearly, so hiding one means nothing.
    if (!slide.stateOf) {
      this.row('Hide slide', this.toggle(!!slide.hidden, (v) =>
        this.editSlideAttrs(slideId, (slide: Slide) => {
          if (v) slide.hidden = true
          else delete slide.hidden
        }, true)))
      // The third answer to "does it take a number": stays in the walk, counts
      // for nothing, and {{page}} on it continues the slide before. Builds
      // (one element revealed per morph step) and interstitials.
      this.row('Skip numbering', this.toggle(!!slide.unnumbered, (v) =>
        this.editSlideAttrs(slideId, (slide: Slide) => {
          if (v) slide.unnumbered = true
          else delete slide.unnumbered
        }, true)))
      if (slide.unnumbered) {
        const hint = document.createElement('p')
        hint.className = 'ed-hint'
        hint.textContent = t('Stays in the show without a number of its own — its page-number field shows the previous slide’s. Use it for build-up steps or a divider that shouldn’t count.')
        this.host.appendChild(hint)
      }
    }

    this.section(t('Layout'))
    const applyLy = document.createElement('button')
    applyLy.className = 'ed-btn ed-btn-block'
    applyLy.textContent = t('⧉ Apply layout…')
    applyLy.title = t('Re-arrange this slide onto a layout — content moves by matching id, then role; extra elements are kept')
    applyLy.addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('bento:apply-layout', { detail: { anchor: applyLy } })))
    this.host.appendChild(applyLy)

    const saveLy = document.createElement('button')
    saveLy.className = 'ed-btn ed-btn-block'
    saveLy.textContent = t('＋ Save slide as layout…')
    saveLy.title = t('Adds this slide to the layouts offered by New slide in this deck')
    saveLy.addEventListener('click', () => {
      const name = window.prompt(t('Layout name'), slide.name ?? t('My layout'))
      if (!name) return
      this.edit(() => {
        const doc = this.store.doc
        const copy: Slide = JSON.parse(JSON.stringify(slide))
        doc.layouts = [...(doc.layouts ?? []), { ...copy, id: uid('layout'), name, stateOf: undefined, notes: '' }]
      }, true)
    })
    this.host.appendChild(saveLy)

    this.buildThemeProps()

    // What applies to the whole DECK, in one section: its page size and how
    // it presents (slide numbers, progress, arrows). None of these is a
    // property of THIS slide, and mixing them in beside Background read as
    // per-slide. Keynote keeps the same set in its Document inspector.
    this.section(t('Deck'))
    // deck-wide page size: presets + custom. Elements keep their absolute
    // positions — a size change reframes the canvas, it never rescales art.
    const { width: dw, height: dh } = this.store.doc.size
    const presetKey =
      Object.entries(PropsPanel.PAGE_PRESETS).find(([, s]) => s.w === dw && s.h === dh)?.[0] ?? 'Custom…'
    let widthRow: HTMLElement
    let heightRow: HTMLElement
    const showCustomSize = (show: boolean) => {
      widthRow.style.display = show ? '' : 'none'
      heightRow.style.display = show ? '' : 'none'
    }
    this.row('Page size', this.select(
      [...Object.keys(PropsPanel.PAGE_PRESETS), 'Custom…'],
      presetKey,
      (v) => {
        const s = PropsPanel.PAGE_PRESETS[v]
        if (s) {
          showCustomSize(false)
          this.edit(() => { this.store.doc.size = { width: s.w, height: s.h } }, true)
        } else {
          showCustomSize(true)
        }
      },
    ))
    widthRow = this.row('Width', this.number(dw, 10, (v, fin) =>
      this.edit(() => { this.store.doc.size.width = Math.max(320, Math.min(4000, Math.round(v))) }, fin)))
    heightRow = this.row('Height', this.number(dh, 10, (v, fin) =>
      this.edit(() => { this.store.doc.size.height = Math.max(320, Math.min(4000, Math.round(v))) }, fin)))
    showCustomSize(presetKey === 'Custom…')
    // These live in doc.present because they are AUDIENCE-facing: what the
    // author designs is what a recipient's audience sees. Contrast reduce-motion
    // and locale, which are viewer preferences and deliberately never enter the
    // document.
    //
    // Each writes `undefined` at its default rather than the default value, so a
    // deck that never touches these carries no `present` block at all.
    const pres = this.store.doc.present ?? {}
    const setPresent = (k: 'slideNumber' | 'progress' | 'controls' | 'numberHidden', v: boolean, dflt: boolean) =>
      this.edit(() => {
        const d = this.store.doc
        const cur = { ...(d.present ?? {}) }
        if (v === dflt) delete cur[k]
        else cur[k] = v
        if (Object.keys(cur).length) d.present = cur
        else delete d.present
      }, true)
    this.row('Slide number', this.toggle(pres.slideNumber ?? true,
      (v) => setPresent('slideNumber', v, true)))
    this.row('Progress bar', this.toggle(pres.progress ?? true,
      (v) => setPresent('progress', v, true)))
    this.row('Corner arrows', this.toggle(pres.controls ?? false,
      (v) => setPresent('controls', v, false)))
    // Off by default: skipped means uncounted, the same rule interactive states
    // already follow, which is what keeps the audience's numbering contiguous.
    // On matches PowerPoint and Keynote, where a hidden slide keeps its number
    // so the visible ones do not renumber as you toggle slides during rehearsal.
    this.row('Number hidden slides', this.toggle(pres.numberHidden ?? false,
      (v) => setPresent('numberHidden', v, false)))


    // interactivity: naming, state-of, hover focus
    this.section(t('Transition'))
    this.row('Transition', this.select(
      ['none', 'fade', 'slide', 'zoom', 'morph'],
      slide.transition,
      (v) => this.editSlideAttrs(slideId, (slide: Slide) => { slide.transition = v as TransitionKind }, true),
    ))
    if (slide.transition === 'morph') {
      const hint = document.createElement('p')
      hint.className = 'ed-hint'
      hint.innerHTML = t('<b>Morph</b> animates elements that appear on both this slide and the previous one (copy a slide, then move things around).')
      this.host.appendChild(hint)
    }

    this.section(t('Interactivity'))
    const name = document.createElement('input')
    name.type = 'text'
    name.placeholder = t('unnamed')
    name.value = slide.name ?? ''
    name.addEventListener('change', () =>
       this.editSlideAttrs(slideId, (slide: Slide) => { slide.name = name.value || undefined }, true))
    this.row('Slide name', name)

    const stateSel = document.createElement('select')
    const optNone = document.createElement('option')
    optNone.value = ''
    optNone.textContent = t('None — a normal slide')
    stateSel.appendChild(optNone)
    this.store.doc.slides.forEach((s, i) => {
      if (s.stateOf || s.id === slide.id) return
      const o = document.createElement('option')
      o.value = s.id
      o.textContent = this.slideLabel(s, i)
      if (slide.stateOf === s.id) o.selected = true
      stateSel.appendChild(o)
    })
    stateSel.addEventListener('change', () =>
      this.editSlideAttrs(slideId, (slide: Slide) => {
        slide.stateOf = stateSel.value || undefined
        this.store.emit('slides')
      }, true))
    stateSel.title = t('Make this slide a variant of another slide: arrow keys skip it, the audience opens it by clicking a linked element, and matching elements morph between the two.')
    this.row('Variant of', stateSel)

    if (slide.stateOf) {
      const sync = document.createElement('button')
      sync.className = 'ed-btn ed-btn-block'
      sync.innerHTML = `${ICONS.sync}<span>${t('Update from main slide')}</span>`
      sync.title = t('Copies in elements added to the main slide since, and follows its layer order. Your changes in this variant are kept.')
      sync.addEventListener('click', () => this.syncStateFromParent())
      this.host.appendChild(sync)
    }

    this.row('On hover', this.labeledSelect(
      [['none', t('none')], ['focus-group', t('Dim other groups')], ['reveal', t('Switch content')]],
      slide.hover?.type ?? 'none',
      (v) => this.editSlideAttrs(slideId, (slide: Slide) => {
        slide.hover = v === 'none'
          ? undefined
          : { ...(slide.hover ?? {}), type: v as 'focus-group' | 'reveal' }
      }, true)))
    if (slide.hover?.type === 'focus-group') {
      this.row('Fade others to', this.number(slide.hover.dim ?? 0.15, 0.01, (v, fin) =>
        this.editSlideAttrs(slideId, (slide: Slide) => { if (slide.hover) slide.hover.dim = Math.min(Math.max(v, 0), 1) }, fin), { min: 0, max: 1 }))
    }
    if (slide.hover?.type === 'reveal') {
      const sets = [...new Set(slide.elements.map((e) => e.showOnHover).filter(Boolean))] as string[]
      const defIn = document.createElement('input')
      defIn.type = 'text'
      defIn.placeholder = sets[0] ?? t('group name')
      defIn.value = slide.hover.default ?? ''
      defIn.addEventListener('change', () =>
        this.editSlideAttrs(slideId, (slide: Slide) => { if (slide.hover) slide.hover.default = defIn.value || undefined }, true))
      this.row('Shown at rest', defIn)
      if (sets.length) {
        this.row('Preview on canvas', this.select(sets, this.store.hoverPreview ?? slide.hover.default ?? sets[0], (v) => {
          this.store.hoverPreview = v
          this.store.emit('current') // re-render canvas without touching the doc
        }))
        const revealHint = document.createElement('p')
        revealHint.className = 'ed-hint'
        revealHint.innerHTML = t('While presenting, pointing at an element shows the content whose <b>Show on hover of</b> matches its <b>Hover group</b>. Pick a group in <b>Preview on canvas</b> to edit its content.')
        this.host.appendChild(revealHint)
      }
    }

  }

  private buildMultiPanel(els: SlideElement[]) {
    this.layerBlock(els)
    this.section(t('Animation'))
    this.revealRow(els)
  }

  private buildElementPanel(el: SlideElement) {
    // Penpot's order: how it sits (align, order, blend, opacity, measures) with
    // no header, then what it IS (its type's own controls), then the optional
    // layers of paint — fill, stroke, shadow, blur — each added from its header.
    this.layerBlock([el])
    this.section(t({ text: 'Text', shape: 'Shape', image: 'Image', svg: 'Diagram', chart: 'Chart', table: 'Table', code: 'Code', media: el.type === 'media' && el.kind === 'audio' ? 'Audio' : 'Video', embed: 'Embed' }[el.type]))
    const kindHead = this.host.lastElementChild!
    if (el.type === 'text') this.buildTextProps(el)
    if (el.type === 'shape') this.buildShapeProps(el)
    if (el.type === 'image') this.buildImageProps(el)
    if (el.type === 'chart') this.buildChartProps(el)
    if (el.type === 'table') this.buildTableProps(el)
    if (el.type === 'media') this.buildMediaProps(el)
    if (el.type === 'code') this.buildCodeProps(el)
    if (el.type === 'embed') this.buildEmbedProps(el)
    // a kind with nothing of its own (an ellipse, a diagram) shows no empty
    // header, and one whose builder opens its own section (Chart, Source
    // code) does not get the kind's name twice
    const next = kindHead.nextElementSibling
    if (!next || next.classList.contains('ed-section')) kindHead.remove()
    if (el.type === 'text') { this.buildTextFill(el); this.buildTextStroke(el) }
    if (el.type === 'shape') { this.buildShapeFill(el); this.buildShapeStroke(el) }
    this.buildShadow(el)
    this.buildBlur(el)
    this.buildLayoutRole(el)
    this.buildPresentingProps(el)
    this.buildMorphProps(el)
  }

  private buildLayoutRole(el: SlideElement) {
    // What the box IS to the slide's layout — its own section, said in
    // words: a bare 'Layout role' dropdown among the text settings told
    // nobody what it did.
    this.section(t('Layout'))
    const why = document.createElement('p')
    why.className = 'ed-hint ed-keep' // the section's whole point: shown, not folded behind '?'
    why.textContent = t('Which box of the slide’s layout this is. When you switch the slide to another layout, the content moves into the new layout’s box with the same role — as a placeholder does in PowerPoint.')
    this.host.appendChild(why)
    this.row('Layout role', this.labeledSelect(
      (['none', 'title', 'subtitle', 'body', 'kicker'] as const).map((r): [string, string] => [r, t(r)]),
      el.role ?? 'none',
      (v) => this.mutate(el.id, (e) => {
        if (v === 'none') delete e.role
        else e.role = v
      }, true)))
  }

  /** The block above the sections, as Penpot heads its Design tab: the align
   *  and order toolbars, blend mode with opacity, then the measures — the
   *  labels inside the fields. */
  private layerBlock(els: SlideElement[]) {
    const block = document.createElement('div')
    block.className = 'ed-layer-block'
    block.dataset.tab = 'format'
    this.host.appendChild(block)
    const iconBtn = (icon: string, hint: string, onClick: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ed-btn ed-tool'
      b.innerHTML = icon
      b.title = hint
      b.setAttribute('aria-label', hint.replace(/\s*\(.*\)$/, ''))
      b.addEventListener('click', onClick)
      return b
    }
    const bar = (...buttons: HTMLElement[]) => {
      const row = document.createElement('div')
      row.className = 'ed-toolbar'
      row.append(...buttons)
      block.appendChild(row)
      return row
    }
    // Controls the selection cannot use are left out, not greyed: matching
    // sizes needs two elements, even gaps three.
    const mod = isMacOS() ? '⌘' : 'Ctrl+'
    const grouped = els.some((e) => e.groupId)
    const allSame = els.length > 1 && els.every((e) => e.groupId && e.groupId === els[0].groupId)
    const groupBtn = els.length > 1 || grouped
      ? (allSame || (grouped && els.length === 1)
        ? iconBtn(ICONS.ungroup, `${t('Ungroup')} (⇧${mod}G)`, () => this.ungroup(els))
        : iconBtn(ICONS.group, `${t('Group')} (${mod}G)`, () => this.group(els)))
      : null
    // One toolbar, Penpot's: align | order | spacing | group, a hairline
    // between the kinds; it wraps at a kind's edge when the panel is narrow.
    const kind = (...buttons: HTMLElement[]) => {
      const k = document.createElement('div')
      k.className = 'ed-toolbar-kind'
      k.style.setProperty('--n', String(buttons.length))
      k.append(...buttons)
      return k
    }
    bar(
      kind(
        iconBtn(ICONS.arrLeft, t('Align left'), () => this.align(els, 'left')),
        iconBtn(ICONS.arrCenterX, t('Align centers'), () => this.align(els, 'centerX')),
        iconBtn(ICONS.arrRight, t('Align right'), () => this.align(els, 'right')),
        iconBtn(ICONS.arrTop, t('Align top'), () => this.align(els, 'top')),
        iconBtn(ICONS.arrMiddleY, t('Align middles'), () => this.align(els, 'middleY')),
        iconBtn(ICONS.arrBottom, t('Align bottom'), () => this.align(els, 'bottom')),
      ),
      kind(
        iconBtn(ICONS.toFront, t('Bring to front'), () => this.reorder(els, 'front')),
        iconBtn(ICONS.forward, t('Bring forward'), () => this.step(els, +1)),
        iconBtn(ICONS.backward, t('Send backward'), () => this.step(els, -1)),
        iconBtn(ICONS.toBack, t('Send to back'), () => this.reorder(els, 'back')),
      ),
      ...(els.length >= 2 ? [kind(
        ...(els.length >= 3 ? [
          iconBtn(ICONS.distX, t('Space evenly across (3 or more)'), () => this.distribute(els, 'x')),
          iconBtn(ICONS.distY, t('Space evenly down (3 or more)'), () => this.distribute(els, 'y')),
        ] : []),
        iconBtn(ICONS.matchW, t('Same width as the first selected (2 or more)'), () => this.matchSize(els, 'w')),
        iconBtn(ICONS.matchH, t('Same height as the first selected (2 or more)'), () => this.matchSize(els, 'h')),
      )] : []),
      ...(groupBtn ? [kind(groupBtn)] : []),
    )
    if (els.length !== 1) return
    const el = els[0]

    const layer = document.createElement('div')
    layer.className = 'ed-grid2 ed-grid-wide'
    const blend = this.labeledSelect(
      [['normal', t('Normal')], ['multiply', t('Multiply')], ['screen', t('Screen')], ['overlay', t('Overlay')],
        ['darken', t('Darken')], ['lighten', t('Lighten')], ['difference', t('Difference')], ['exclusion', t('Exclusion')]],
      el.blend || 'normal',
      (v) => this.mutate(el.id, (e) => {
        if (v === 'normal') delete e.blend
        else e.blend = v
      }, true))
    blend.title = t('Blend mode')
    blend.setAttribute('aria-label', t('Blend mode'))
    const opacity = this.mini('%', Math.round(el.opacity * 100), (v, fin) =>
      this.setNum(el.id, 'opacity', Math.min(Math.max(v / 100, 0), 1), fin), undefined, { min: 0, max: 100 })
    opacity.title = t('Opacity')
    layer.append(blend, opacity)
    block.appendChild(layer)

    const geo = document.createElement('div')
    geo.className = 'ed-grid2'
    geo.append(
      this.mini(t('W'), el.w, (v, fin) => this.setNum(el.id, 'w', Math.max(v, 1), fin), undefined, { min: 1 }),
      this.mini(t('H'), el.h, (v, fin) => this.setNum(el.id, 'h', Math.max(v, 1), fin), undefined, { min: 1 }),
      this.mini(t('X'), el.x, (v, fin) => this.setNum(el.id, 'x', v, fin)),
      this.mini(t('Y'), el.y, (v, fin) => this.setNum(el.id, 'y', v, fin)),
      this.mini(t('Angle'), el.rotation, (v, fin) => this.setNum(el.id, 'rotation', v, fin), ICONS.rotate),
    )
    if (el.type === 'shape' && el.shape === 'rect') {
      geo.append(this.mini(t('Corner radius'), el.radius ?? 0, (v, fin) =>
        this.mutate(el.id, (e) => { (e as ShapeElement).radius = Math.max(v, 0) }, fin), ICONS.radius, { min: 0 }))
    }
    block.appendChild(geo)
  }

  /** Shadow — added and removed from its header; a preset to start from,
   *  then the concrete values (per layer when stacked). */
  private buildShadow(el: SlideElement) {
    const first = Object.keys(SHADOW_PRESETS)[0]
    this.section(t('Shadow'), el.shadow
      ? { add: false, hint: t('Remove shadow'), run: () => this.mutate(el.id, (e) => { delete e.shadow }, true) }
      : { add: true, hint: t('Add shadow'), run: () => this.mutate(el.id, (e) => { e.shadow = { ...SHADOW_PRESETS[first] } }, true) })
    if (!el.shadow) return
    // The presets as tiles: each one SHOWS its shadow, its name under it —
    // one click, all visible, where a dropdown of words hid what they meant.
    const current = Object.entries(SHADOW_PRESETS).find(([, p]) => JSON.stringify(p) === JSON.stringify(el.shadow))?.[0] ?? 'custom'
    const tiles = document.createElement('div')
    tiles.className = 'ed-shadow-tiles'
    tiles.setAttribute('role', 'radiogroup')
    tiles.setAttribute('aria-label', t('Shadow'))
    for (const [key, sh] of Object.entries(SHADOW_PRESETS)) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ed-shadow-tile'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(key === current))
      const swatch = document.createElement('span')
      swatch.className = 'ed-shadow-swatch'
      // the preset drawn at a quarter of its size, so all four fit a tile
      swatch.style.boxShadow = `${(sh.x ?? 0) / 4}px ${(sh.y ?? 0) / 4}px ${sh.blur / 4}px ${sh.color}`
      const name = document.createElement('span')
      name.textContent = t(SHADOW_NAMES[key] ?? key)
      b.append(swatch, name)
      b.addEventListener('click', () => { if (key !== current) this.mutate(el.id, (e) => { e.shadow = { ...SHADOW_PRESETS[key] } }, true) })
      tiles.appendChild(b)
    }
    this.host.appendChild(tiles)
    // editing any value turns a preset into 'custom' on the next rebuild
    const shadows = Array.isArray(el.shadow) ? el.shadow : [el.shadow]
    const setShadow = (i: number, patch: Record<string, unknown>, fin = true) =>
      this.mutate(el.id, (e) => {
        const arr = Array.isArray(e.shadow) ? [...e.shadow] : e.shadow ? [e.shadow] : []
        arr[i] = { ...arr[i], ...patch }
        e.shadow = Array.isArray(e.shadow) ? arr : arr[0]
      }, fin)
    shadows.forEach((sh, i) => {
      if (shadows.length > 1) {
        const cap = document.createElement('div')
        cap.className = 'ed-shadow-cap'
        cap.textContent = t('Shadow {n}', { n: i + 1 })
        this.host.appendChild(cap)
      }
      const grid = document.createElement('div')
      grid.className = 'ed-grid3'
      grid.append(
        this.mini(t('X'), sh.x ?? 0, (v, fin) => setShadow(i, { x: v }, fin)),
        this.mini(t('Y'), sh.y ?? 0, (v, fin) => setShadow(i, { y: v }, fin)),
        this.mini(t('Blur'), sh.blur, (v, fin) => setShadow(i, { blur: Math.max(v, 0) }, fin), ICONS.blur, { min: 0 }),
      )
      this.host.appendChild(grid)
      this.field(this.colorAlpha(sh.color, (v, fin) => setShadow(i, { color: v }, fin)))
    })
  }

  /** Blur on the element and the frosted glass behind it — one optional layer. */
  private buildBlur(el: SlideElement) {
    const on = !!(el.blur || el.backdropFilter)
    this.section(t('Blur'), on
      ? { add: false, hint: t('Remove blur'), run: () => this.mutate(el.id, (e) => { delete e.blur; delete e.backdropFilter }, true) }
      : { add: true, hint: t('Add blur'), run: () => this.mutate(el.id, (e) => { e.blur = 4 }, true) })
    if (!on) return
    const grid = document.createElement('div')
    grid.className = 'ed-grid2'
    grid.append(
      this.mini(t('Blur'), el.blur ?? 0, (v, fin) => this.mutate(el.id, (e) => {
        if (v > 0) e.blur = v
        else delete e.blur
      }, fin), undefined, { min: 0 }),
      this.mini(t('Behind'), el.backdropFilter ?? 0, (v, fin) => this.mutate(el.id, (e) => {
        if (v > 0) e.backdropFilter = v
        else delete e.backdropFilter
      }, fin), undefined, { min: 0 }),
    )
    grid.lastElementChild!.setAttribute('title', t('Blur behind'))
    this.host.appendChild(grid)
  }

  /**
   * Morph section. The morph key is `morphId ?? id`: by default an element
   * morphs with same-id elements on adjacent slides (the duplicate-a-slide
   * idiom), but setting a `morphId` re-targets the pairing WITHOUT mutating
   * `id` (which stays the stable identity used by selection, connectors,
   * comments and the CRDT). The text field edits the key directly; the picker
   * adopts another slide element's key. Writing the element's own id clears
   * the override.
   */
  private buildMorphProps(el: SlideElement) {
    this.section(t('Morph'))
    const effective = morphKey(el)

    const warn = document.createElement('p')
    warn.className = 'ed-hint ed-morph-warn'
    warn.style.display = 'none'

    const input = document.createElement('input')
    input.type = 'text'
    input.value = effective
    input.spellcheck = false
    input.addEventListener('change', () => {
      const err = this.setMorphId(el, input.value)
      if (err) { warn.textContent = err; warn.style.display = ''; input.value = effective }
    })
    this.row('Morph name', input)

    const targets = this.morphTargets(el)
    // `|| el.morphId`: a paired element with no OTHER slide to pair with still
    // needs the picker — otherwise there is nowhere to unpair from.
    if (targets.length || el.morphId) {
      const sel = document.createElement('select')
      const none = document.createElement('option')
      none.value = ''
      none.textContent = t('(pick an element)')
      sel.appendChild(none)
      // Clearing an override had no affordance: the documented way is to retype
      // the element's own id into the field above, which means knowing what it
      // was (issue #54). Offer it as a choice instead.
      if (el.morphId) {
        const un = document.createElement('option')
        un.value = UNPAIR
        un.textContent = t('Don’t pair — use its own name')
        sel.appendChild(un)
      }
      for (const tgt of targets) {
        const o = document.createElement('option')
        o.value = tgt.key
        o.textContent = tgt.label
        if (tgt.key === effective) o.selected = true
        sel.appendChild(o)
      }
      sel.addEventListener('change', () => {
        if (!sel.value) return
        // writing the element's OWN id is what clears the override
        const err = this.setMorphId(el, sel.value === UNPAIR ? el.id : sel.value)
        if (err) { warn.textContent = err; warn.style.display = '' }
      })
      this.row('Morph with', sel)
    }

    this.host.appendChild(warn)

    const hint = document.createElement('p')
    // an override in force is STATE, and stays in view; otherwise it is help
    hint.className = el.morphId ? 'ed-hint ed-status' : 'ed-hint'
    hint.innerHTML = el.morphId
      ? t('Morphs as <code>{id}</code> instead of its own name, <code>{own}</code>. Choose “Don’t pair” below to undo.', { id: effective, own: el.id })
      : t('Elements with the same morph name morph into each other between slides. Rename it, or pick below, to pair it with an element on another slide.')
    this.host.appendChild(hint)
  }

  /** Set or clear an element's morph-key override. Writing the element's own
   *  id clears it. Returns an inline error message, or null on success. */
  private setMorphId(el: SlideElement, raw: string): string | null {
    const clean = raw.trim().replace(/[^A-Za-z0-9._-]/g, '')
    if (!clean) return t('Morph name can’t be empty.')
    const next = clean === el.id ? undefined : clean
    const effective = next ?? el.id
    const clash = this.store.slide.elements.some(
      (e) => e.id !== el.id && morphKey(e) === effective)
    if (clash) return t('Another element on this slide already uses that morph name.')
    this.mutate(el.id, (e) => {
      if (next === undefined) delete e.morphId
      else e.morphId = next
    }, true)
    return null
  }

  /** Distinct morph keys present on OTHER slides, each with a readable label,
   *  for the "Pair with" picker. Skips keys that already sit on this slide
   *  (they'd collide) and our own default key. */
  private morphTargets(el: SlideElement): Array<{ key: string; label: string }> {
    const here = new Set(
      this.store.slide.elements.filter((e) => e.id !== el.id).map(morphKey))
    const seen = new Map<string, string>()
    this.store.doc.slides.forEach((s, i) => {
      if (s.id === this.store.slide.id) return
      for (const e of s.elements) {
        const key = morphKey(e)
        if (key === el.id || here.has(key) || seen.has(key)) continue
        seen.set(key, `${t('Slide')} ${i + 1} · ${this.morphElDesc(e)}`)
      }
    })
    return [...seen].map(([key, label]) => ({ key, label }))
  }

  /** Short human label for an element in the morph picker. */
  private morphElDesc(e: SlideElement): string {
    if (e.type === 'text') {
      const txt = (e as TextElement).html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      if (txt) return `"${txt.slice(0, 24)}"`
    }
    // Capitalize to hit the existing insert-menu catalog keys (Text/Image/…).
    return t(e.type.charAt(0).toUpperCase() + e.type.slice(1))
  }

  /** fx + link — how the element behaves while presenting. */
  private buildPresentingProps(el: SlideElement) {
    this.section(t('Animation'))
    const setFx = (patch: Partial<NonNullable<SlideElement['fx']>>) =>
      this.mutate(el.id, (e) => {
        const fx = { ...(e.fx ?? {}), ...patch }
        if (!fx.enter && !fx.countUp && !fx.ambient && !fx.loop && !fx.step && !fx.typeWriter) delete e.fx
        else e.fx = fx
      }, true)

    // labelled by where the element comes FROM: slide-left starts on the right
    // and travels left (present.ts enterSpec)
    this.row('Entrance', this.labeledSelect(
      [['none', t('none')], ['fade', t('fade')], ['fade-up', t('Fade up')], ['fade-down', t('Fade down')],
        ['slide-left', t('Fly in from right')], ['slide-right', t('Fly in from left')],
        ['slide-up', t('Fly in from below')], ['slide-down', t('Fly in from above')]],
      el.fx?.enter ?? 'none',
      (v) => setFx(v === 'none'
        ? { enter: undefined, enterDur: undefined }
        : { enter: v as NonNullable<typeof el.fx>['enter'] })))
    if (el.fx?.enter) {
      // per-kind default (slide-* 0.75s, fade-* 0.55s); lower = snappier
      this.row('Entrance (s)', this.number(
        el.fx.enterDur ?? (el.fx.enter.startsWith('slide-') ? 0.75 : 0.55), 0.05,
        (v, fin) => { if (fin) setFx({ enterDur: Math.max(v, 0.05) }) }, { min: 0.05 }))
    }
    // "Animate on click": hidden until the n-th → on this slide (0 = with the
    // slide). The element's Enter plays when its step comes, or a plain fade.
    // The verbs come first (one click, no number to think about); the number
    // row underneath is the precise control, and the canvas badge cycles it.
    this.revealRow([el])
    this.row('Appears on click', this.number(el.fx?.step ?? 0, 1,
      (v, fin) => { if (fin) setFx({ step: v >= 1 ? Math.floor(v) : undefined }) }))
    if (el.fx?.step) {
      const hint = document.createElement('p')
      hint.className = 'ed-hint'
      hint.textContent = t('Hidden until that press of → while presenting; ← hides it again. Give several elements the same step to reveal them together.')
      this.host.appendChild(hint)
    }
    this.row('Count up numbers', this.select(
      ['off', 'on'], el.fx?.countUp ? 'on' : 'off',
      (v) => setFx({ countUp: v === 'on' ? true : undefined })))
    if (el.type === 'code') this.row('Typewriter', this.select(
      ['off', 'on'], el.fx?.typeWriter ? 'on' : 'off',
      (v) => setFx({ typeWriter: v === 'on' ? true : undefined })))
    this.row('Pan & zoom', this.labeledSelect(
      [['none', t('none')], ['kenburns', t('Ken Burns')]], el.fx?.ambient ?? 'none',
      (v) => setFx(v === 'none' ? { ambient: undefined, ken: undefined } : { ambient: 'kenburns' })))
    if (el.fx?.ambient === 'kenburns') {
      const ken = el.fx.ken ?? {}
      const dir = ken.dir ?? 'drift'
      const setKen = (patch: Partial<NonNullable<NonNullable<SlideElement['fx']>['ken']>>) =>
        setFx({ ken: { ...ken, ...patch } })
      this.row('Motion', this.labeledSelect(
        [['drift', t('Drift')], ['zoom-out', t('Zoom out')], ['zoom-in', t('Zoom in')]],
        dir === 'out' ? 'zoom-out' : dir === 'in' ? 'zoom-in' : 'drift',
        (v) => {
          const d = v === 'zoom-out' ? 'out' : v === 'zoom-in' ? 'in' : 'drift'
          // give each style its natural pace when switching
          setFx({ ken: d === 'drift' ? undefined : { dir: d, scale: 1.06, duration: 2.5 } })
        }))
      this.row('Zoom amount %', this.number(
        Math.round(((ken.scale ?? (dir === 'drift' ? 1.1 : 1.06)) - 1) * 100), 1,
        (v, fin) => { if (fin) setKen({ scale: 1 + Math.min(Math.max(v, 0), 100) / 100 }) }, { min: 0, max: 100 }))
      this.row('Pan & zoom (s)', this.number(
        ken.duration ?? (dir === 'drift' ? 26 : 2.5), 0.1,
        (v, fin) => { if (fin) setKen({ duration: Math.max(v, 0.1) }) }, { min: 0.1 }))
    }

    // continuous loop animation
    const loop = el.fx?.loop
    this.row('Loop animation', this.labeledSelect(
      [['none', t('none')], ['dash-march', t('Marching dashes')], ['motion-path', t('Follow a path')]],
      loop?.type ?? 'none',
      (v) => setFx({
        loop: v === 'none' ? undefined
          : v === 'dash-march' ? { type: 'dash-march', distance: 18, duration: (loop as any)?.duration ?? 1.4 }
          : { type: 'motion-path', path: (loop as any)?.path ?? 'M 0 0 L 100 0', duration: (loop as any)?.duration ?? 3 },
      })))
    if (loop) {
      this.row('Seconds per lap', this.number(loop.duration ?? 2, 0.1, (v, fin) =>
        this.mutate(el.id, (e) => { if (e.fx?.loop) e.fx.loop.duration = Math.max(v, 0.1) }, fin), { min: 0.1 }))
      if (loop.type === 'motion-path') {
        const path = document.createElement('input')
        path.type = 'text'
        path.value = loop.path
        path.title = t('SVG path the element travels along, relative to its position')
        path.addEventListener('change', () =>
          this.mutate(el.id, (e) => { if (e.fx?.loop?.type === 'motion-path') e.fx.loop.path = path.value }, true))
        this.row('Motion path', path)

        // lap easing — the tempo of a whole lap (per-anchor speed is edited on canvas)
        this.row('Lap speed', this.labeledSelect(
          [['none', t('Constant')], ['sine.inOut', t('Ease in-out')], ['power2.in', t('Ease in')], ['power2.out', t('Ease out')]],
          (loop as { ease?: string }).ease ?? 'none',
          (v) => this.mutate(el.id, (e) => {
            const lp = e.fx?.loop
            if (lp?.type !== 'motion-path') return
            if (v === 'none') delete lp.ease; else lp.ease = v
          }, true)))

        const editPath = document.createElement('button')
        editPath.className = 'ed-btn ed-btn-block'
        editPath.textContent = t('✎ Edit path on canvas')
        editPath.title = t('Drag points to reshape · double-click to add/remove · scroll a point to change its speed')
        editPath.addEventListener('click', () =>
          document.dispatchEvent(new CustomEvent('bento:edit-path', { detail: { id: el.id } })))
        this.host.appendChild(editPath)
        const speedHint = document.createElement('p')
        speedHint.className = 'ed-hint'
        speedHint.textContent = t('Tip: on the canvas, scroll a point to make the element dwell there or rush past it.')
        this.host.appendChild(speedHint)
      }
    }

    // What the element DOES in the show, as opposed to how it moves: its own
    // section, on the Interact tab.
    this.section(t('Interactivity'))

    // hover-reveal set membership
    const soh = document.createElement('input')
    soh.type = 'text'
    soh.placeholder = t('always visible')
    soh.value = el.showOnHover ?? ''
    soh.addEventListener('change', () => {
      this.mutate(el.id, (e) => {
        if (soh.value) e.showOnHover = soh.value
        else delete e.showOnHover
      }, true)
      // follow the element into its new set so it stays visible/editable
      this.store.hoverPreview = soh.value || null
      this.store.emit('current')
    })
    this.row('Show on hover of', soh)

    // group tag (hover focus & interaction targeting)
    const group = document.createElement('input')
    group.type = 'text'
    group.placeholder = t('none')
    group.value = el.group ?? ''
    group.addEventListener('change', () =>
      this.mutate(el.id, (e) => {
        if (group.value) e.group = group.value
        else delete e.group
      }, true))
    this.row('Hover group', group)

    // link → slide picker
    const sel = document.createElement('select')
    const none = document.createElement('option')
    none.value = ''
    none.textContent = t('none')
    sel.appendChild(none)
    this.store.doc.slides.forEach((s, i) => {
      const o = document.createElement('option')
      o.value = s.id
      o.textContent = this.slideLabel(s, i)
      if (el.link === s.id) o.selected = true
      sel.appendChild(o)
    })
    if (isWebUrl(el.link)) {
      const web = document.createElement('option')
      web.value = el.link
      web.textContent = t('web page (below)')
      web.selected = true
      sel.appendChild(web)
    }
    sel.addEventListener('change', () =>
      this.mutate(el.id, (e) => {
        if (sel.value) e.link = sel.value
        else delete e.link
      }, true))
    this.row('Link to', sel)
    // Or a web page: opens in a new tab while presenting (discussion #373).
    const url = document.createElement('input')
    url.type = 'url'
    url.placeholder = 'https://…'
    url.value = isWebUrl(el.link) ? el.link : ''
    url.addEventListener('change', () => {
      const v = url.value.trim()
      if (v && !isWebUrl(v)) {
        this.toast(t('That doesn’t look like a web address — it should start with https://'))
        url.value = isWebUrl(el.link) ? el.link : ''
        return
      }
      this.mutate(el.id, (e) => {
        if (v) e.link = v
        else if (isWebUrl(e.link)) delete e.link
      }, true)
    })
    this.row('Web link', url)

    // one-click interactivity: duplicate this slide as a hidden state
    // (element ids preserved ⇒ it morphs) and link this element to it
    const makeState = document.createElement('button')
    makeState.className = 'ed-btn ed-btn-block'
    makeState.textContent = t('＋ Link to a new variant of this slide')
    makeState.title = t('Copies this slide as a variant and links this element to it: while presenting, clicking the element opens the copy. Edit the copy to show what changes.')
    makeState.addEventListener('click', () => this.createLinkedState(el))
    this.host.appendChild(makeState)
  }

  /**
   * Re-sync an interactive state with its parent: parent elements missing
   * here (added since the state was created) come in, ordering follows the
   * parent, and this state's own versions of shared elements — its whole
   * point — stay untouched. Elements unique to this state stay on top.
   */
  private syncStateFromParent() {
    const state = this.store.slide
    const parent = this.store.doc.slides.find((s) => s.id === state.stateOf)
    if (!parent) return
    const own = new Map(state.elements.map((e) => [e.id, e]))
    // sync only makes sense for states that share lineage with the parent —
    // otherwise "merging" would just stack two full copies of everything
    const shared = parent.elements.filter((pe) => own.has(pe.id)).length
    if (state.elements.length && !shared) {
      this.toast(t('This variant shares no elements with its main slide — nothing to update.'))
      return
    }
    let added = 0
    const merged: SlideElement[] = parent.elements.map((pe) => {
      const mine = own.get(pe.id)
      if (mine) {
        own.delete(pe.id)
        return mine
      }
      added++
      return JSON.parse(JSON.stringify(pe))
    })
    const extras = [...own.values()] // this state's additions, kept on top
    this.store.commit(() => {
      this.store.slide.elements = [...merged, ...extras]
    })
    this.store.select([])
    // numbers rather than hand-made plurals, which no catalog can follow
    this.toast(t('Updated from the main slide — new: {added} · only in this variant: {kept}', { added, kept: extras.length }))
  }

  private toast(message: string) {
    document.querySelector('.ed-toast')?.remove()
    const t = document.createElement('div')
    t.className = 'ed-toast'
    t.textContent = message
    document.body.appendChild(t)
    setTimeout(() => t.classList.add('show'))
    setTimeout(() => {
      t.classList.remove('show')
      setTimeout(() => t.remove(), 300)
    }, 2600)
  }

  /** Duplicate the current slide as a hidden state and link `el` to it. */
  private createLinkedState(el: SlideElement) {
    const src = this.store.slide
    const clone = JSON.parse(JSON.stringify(src)) as typeof src
    clone.id = uid('slide')
    clone.stateOf = src.stateOf ?? src.id // states of a state share one parent
    clone.name = `${src.name ?? t('variant')} ${this.store.doc.slides.filter((s) => s.stateOf === clone.stateOf).length + 2}`
    clone.transition = 'morph'
    delete (clone as any).hover // inherit nothing implicit; user can re-enable
    if (src.hover) clone.hover = { ...src.hover }
    // insert right after the parent and its existing states, keeping the
    // family together in the slide list
    const parentIdx = this.store.doc.slides.findIndex((s) => s.id === clone.stateOf)
    let insertAt = parentIdx + 1
    while (this.store.doc.slides[insertAt]?.stateOf === clone.stateOf) insertAt++
    this.store.commit(() => {
      this.store.doc.slides.splice(insertAt, 0, clone)
      const live = this.store.element(el.id)
      if (live) live.link = clone.id
    }, 'slides')
    this.store.goTo(insertAt)
  }

  /**
   * Human label for a slide in pickers — the number the SIDEBAR shows, so an
   * author who reads "4" there finds "slide 4" here. That is the page number
   * (`paginates`), not the position: an unnumbered or hidden slide shows the
   * number it continues, marked, so two entries can share a number without
   * being confused for each other.
   */
  private slideLabel(s: { id: string; name?: string; stateOf?: string; hidden?: boolean; unnumbered?: boolean }, i: number): string {
    const doc = this.store.doc
    const pageAt = (idx: number) => doc.slides.slice(0, idx + 1).filter((x) => paginates(x, doc)).length
    if (s.stateOf) {
      const p = doc.slides.findIndex((x) => x.id === s.stateOf)
      return `${t('variant of slide {n}', { n: pageAt(p) })}${s.name ? ` — ${s.name}` : ''}`
    }
    const mark = s.hidden ? ` (${t('hidden')})` : s.unnumbered ? ` (${t('unnumbered')})` : ''
    return `${t('slide {n}', { n: pageAt(i) })}${mark}${s.name ? ` — ${s.name}` : ''}`
  }

  /**
   * "Fit height to text" — set `h` to exactly what the content needs.
   *
   * A box that is too short lets its text spill over whatever sits below, and
   * one that is too tall throws off vertical alignment against its neighbours;
   * neither is visible in the numbers. The button reports the delta so it is
   * obvious whether anything was wrong before you press it.
   */
  private buildFitHeight(el: TextElement): HTMLElement {
    const fit = document.createElement('button')
    fit.type = 'button'
    fit.className = 'ed-btn ed-tool'
    fit.innerHTML = ICONS.fitHeight
    fit.setAttribute('aria-label', t('Fit height to text'))
    if (!el.html?.trim()) { // nothing to measure yet
      fit.disabled = true
      fit.title = t('Fit height to text')
      return fit
    }
    const m = measureElement(el, this.store.doc)
    fit.title = `${t('Fit height to text')}\n${t('The text needs {need}px and the box is {have}px',
      { need: String(m.height), have: String(el.h) })}`
    if (m.height === el.h) fit.disabled = true
    fit.addEventListener('click', () => {
      // measure again at click time — the text may have been edited since the
      // panel was built, and a stale height is worse than no button
      const fresh = measureElement(this.store.element(el.id) as TextElement, this.store.doc)
      this.mutate(el.id, (e) => { e.h = fresh.height }, true)
    })
    return fit
  }

  /** "Insert field": drops a {{token}} at the end of the text (discussion
   *  #381 — the tokens existed since 0.9.12 but nothing in the editor said
   *  so). Date and time offer presets whose labels show TODAY in that shape,
   *  so the choice is made by eye; the pattern is in the token for anyone who
   *  wants to edit it. Appends rather than inserts at a caret: choosing from
   *  the panel blurs the text box and commits the edit, so there is no caret
   *  to honour — the token lands at the end, inside the last block, and the
   *  author moves it like any other text. */
  private buildFieldPicker(el: TextElement): HTMLElement {
    const now = new Date()
    const fmt = (token: string) => { const m = /^\{\{(?:date|time):(.*)\}\}$/.exec(token); return m ? formatDate(now, m[1]) : '' }
    const pairs: Array<[string, string]> = []
    for (const p of DATE_PRESETS) pairs.push([p.token, p.token === '{{date}}' ? t(p.label) : `${t('Date')} — ${fmt(p.token)}`])
    for (const p of TIME_PRESETS) pairs.push([p.token, p.token === '{{time}}' ? t(p.label) : `${t('Time')} — ${fmt(p.token)}`])
    for (const p of OTHER_FIELDS) pairs.push([p.token, t(p.label)])
    const insert = (token: string) => this.mutate(el.id, (e) => {
      const tx = e as TextElement
      const html = tx.html ?? ''
      // inside the last block if there is one, so the token joins the last
      // line rather than starting a stray one after </p>
      const m = /<\/(p|div|li)>\s*$/i.exec(html)
      const at = m ? m.index : html.length
      const sep = at > 0 && !/[\s>]$/.test(html.slice(0, at)) ? ' ' : ''
      tx.html = html.slice(0, at) + sep + token + html.slice(at)
    }, true)
    // a tool among the text tools, its list a menu — a dropdown that reads
    // 'Insert field…' sat among the settings looking like one of them
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ed-btn ed-tool'
    b.innerHTML = ICONS.braces
    b.title = `${t('Insert field…')}\n${t('Page number, date, time, title and the document properties — resolved when the slide is shown. Date and time can pin a format: {{date:M/D/YY}}; edit the pattern in the text.')}`
    b.setAttribute('aria-label', t('Insert field…'))
    b.setAttribute('aria-haspopup', 'menu')
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect()
      openCtxMenu(r.left, r.bottom + 4, pairs.map(([token, label]) => ({ label, run: () => insert(token) })))
    })
    return b
  }

  private buildTextProps(el: TextElement) {
    const hint = document.createElement('p')
    hint.className = 'ed-hint'
    hint.innerHTML = t('While editing: <b>⌘B</b>/<b>⌘I</b>/<b>⌘U</b> · markdown auto-converts — **bold*&#8203;* *italic*&#8203; `code` ~~strike~~ and "- " bullets; pasting markdown converts too. Escape with \\ or press ⌘Z right after to keep the literal characters.')
    this.host.appendChild(hint)
    // Penpot's Text block: family; size and weight; line height and tracking;
    // then the alignments and the list tools as one icon row each.
    const font = this.fontSelect(el)
    font.setAttribute('aria-label', t('Font'))
    font.title = t('Font')
    this.field(font)

    const sizes = document.createElement('div')
    sizes.className = 'ed-grid2'
    // Shown in POINTS (the unit office users know); the model stores slide-space
    // px. 1pt = 4/3 px at the slide's 96dpi space, so 32px = 24pt exactly.
    const size = this.mini('pt', Math.round(el.fontSize * 0.75 * 10) / 10, (v, fin) =>
      this.mutate(el.id, (e) => {
        (e as TextElement).fontSize = Math.round(Math.max(v, 3) * (4 / 3) * 100) / 100
      }, fin), undefined, { min: 3 })
    size.title = t('Size (pt)')
    const weight = this.weightSelect(el)
    weight.title = t('Weight')
    weight.setAttribute('aria-label', t('Weight'))
    sizes.append(size, weight,
      this.mini(t('Line height'), el.lineHeight, (v, fin) =>
        this.mutate(el.id, (e) => { (e as TextElement).lineHeight = Math.max(Math.round(v * 100) / 100, 0.5) }, fin), ICONS.lineHeight, { min: 0.5 }),
      this.mini(t('Letter spacing'), el.letterSpacing ?? 0, (v, fin) =>
        this.mutate(el.id, (e) => {
          const tx = e as TextElement
          if (v) tx.letterSpacing = v
          else delete tx.letterSpacing
        }, fin), ICONS.letterSpacing))
    ;(sizes.children[2].querySelector('input') as HTMLInputElement).step = '0.05'
    this.host.appendChild(sizes)

    const align = this.segmented(['left', 'center', 'right'], el.align, (v) =>
      this.mutate(el.id, (e) => { (e as TextElement).align = v as TextElement['align'] }, true))
    align.setAttribute('aria-label', t('Align'))
    const valign = this.segmented(['top', 'middle', 'bottom'], el.valign, (v) =>
      this.mutate(el.id, (e) => { (e as TextElement).valign = v as TextElement['valign'] }, true))
    valign.setAttribute('aria-label', t('Vertical align'))
    this.field(align, valign).classList.add('ed-line-even')

    // Indent / Outdent bullets (#368): the item under the caret while the box
    // is open — a press here must not take the caret away, so mousedown is
    // held — else the whole box. Tab / ⇧Tab do the same while editing.
    const tools: HTMLElement[] = []
    for (const [dir, icon, label, tip] of [
      [-1, ICONS.outdent, t('Outdent'), t('Move the bullet up a level (⇧Tab while editing)')],
      [1, ICONS.indent, t('Indent'), t('Move the bullet down a level, under the one above (Tab while editing)')],
    ] as const) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ed-btn ed-tool'
      b.innerHTML = icon
      b.setAttribute('aria-label', label)
      b.title = tip
      b.addEventListener('mousedown', (ev) => ev.preventDefault())
      b.addEventListener('click', (ev) => { ev.preventDefault(); this.onListIndent?.(dir) })
      tools.push(b)
    }
    this.field(...tools, this.buildFitHeight(el), this.buildFieldPicker(el))
  }

  /** Text fill: a solid colour, or a multi-stop gradient painted into the glyphs. */
  private buildTextFill(el: TextElement) {
    this.section(t('Fill'))
    const tgrad = el.colorGradient
    this.field(this.fillKind(tgrad ? 'gradient' : 'solid', (v) =>
      this.mutate(el.id, (e) => {
        const tx = e as TextElement
        if (v === 'gradient') {
          const base = parseColor(tx.color)
          tx.colorGradient ??= {
            angle: 90,
            stops: [
              { at: 0, color: combineColor(base.hex, Math.max(base.a, 1)) },
              { at: 1, color: '#5B8DEF' },
            ],
          }
        } else {
          delete tx.colorGradient
        }
      }, true)))
    if (!tgrad) {
      this.field(this.colorAlpha(el.color, (v, fin) =>
        this.mutate(el.id, (e) => { (e as TextElement).color = v }, fin),
        { id: el.id, path: 'color' }))
    } else {
      this.gradientRows(tgrad, (fn, fin) => this.mutate(el.id, (e) => {
        const g = (e as TextElement).colorGradient
        if (g) fn(g)
      }, fin))
    }
  }

  /** Text outline — hollow or outlined glyphs, an optional layer like a shape's stroke. */
  private buildTextStroke(el: TextElement) {
    const ts = el.textStroke
    this.section(t('Stroke'), ts?.width
      ? { add: false, hint: t('Remove stroke'), run: () => this.mutate(el.id, (e) => { delete (e as TextElement).textStroke }, true) }
      : { add: true, hint: t('Add stroke'), run: () => this.mutate(el.id, (e) => {
        const tx = e as TextElement
        tx.textStroke = { color: '#1E2A3A', ...(tx.textStroke ?? {}), width: 1 }
      }, true) })
    if (!ts?.width) return
    this.field(this.colorAlpha(ts.color, (v, fin) =>
      this.mutate(el.id, (e) => {
        const g = (e as TextElement).textStroke
        if (g) g.color = v
      }, fin)))
    const w = this.mini(t('Width'), ts.width, (v, fin) =>
      this.mutate(el.id, (e) => {
        const tx = e as TextElement
        if (v > 0) tx.textStroke = { color: '#1E2A3A', ...(tx.textStroke ?? {}), width: v }
        else delete tx.textStroke
      }, fin), undefined, { min: 0 })
    const interior = this.segmented(['filled', 'hollow'], ts.fill === 'none' ? 'hollow' : 'filled', (v) =>
      this.mutate(el.id, (e) => {
        const g = (e as TextElement).textStroke
        if (g) { if (v === 'hollow') g.fill = 'none'; else delete g.fill }
      }, true))
    interior.setAttribute('aria-label', t('Interior'))
    // the width beside nothing it could crowd; the words ('filled' / 'hollow')
    // get a line of their own, so no translation is cut
    const grid = document.createElement('div')
    grid.className = 'ed-grid2'
    grid.append(w)
    this.host.appendChild(grid)
    this.field(interior)
  }

  /** Solid | Gradient, one click. */
  private fillKind(value: 'solid' | 'gradient', onChange: (v: string) => void): HTMLElement {
    const seg = this.segmented(['solid', 'gradient'], value, onChange, Object.fromEntries(fillStyles()))
    seg.setAttribute('aria-label', t('Fill style'))
    return seg
  }

  /** A gradient's angle and stops, shared by text and shapes. `edit` hands
   *  the live gradient to change. */
  private gradientRows(grad: { angle: number; stops: Array<{ at: number; color: string }> }, edit: (fn: (g: typeof grad) => void, final: boolean) => void) {
    const angle = this.mini(t('Gradient angle'), grad.angle, (v, fin) => edit((g) => { g.angle = v }, fin), ICONS.rotate)
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'ed-btn ed-tool'
    add.innerHTML = ICONS.plus
    add.title = t('＋ Add stop').replace(/^＋\s*/, '')
    add.setAttribute('aria-label', add.title)
    add.addEventListener('click', () => edit((g) => {
      const mid = g.stops[Math.floor(g.stops.length / 2)]
      g.stops.push({ at: 0.5, color: mid?.color ?? '#808080' })
      g.stops.sort((a, b) => a.at - b.at)
    }, true))
    this.field(angle, add)
    grad.stops.forEach((stop, i) => {
      const wrap = document.createElement('div')
      wrap.className = 'ed-gradstop'
      const at = this.mini('%', Math.round(stop.at * 100), (v, fin) =>
        edit((g) => { if (g.stops[i]) g.stops[i].at = Math.min(Math.max(v / 100, 0), 1) }, fin), undefined, { min: 0, max: 100 })
      at.title = t('Stop {n}', { n: i + 1 }) + ' · ' + t('Position %')
      at.classList.add('ed-gradstop-at')
      const color = this.colorAlpha(stop.color, (v, fin) => edit((g) => { if (g.stops[i]) g.stops[i].color = v }, fin))
      wrap.append(at, color)
      if (grad.stops.length > 2) {
        const del = document.createElement('button')
        del.type = 'button'
        del.className = 'ed-btn ed-tool'
        del.innerHTML = ICONS.minus
        del.title = t('Remove stop')
        del.setAttribute('aria-label', t('Remove stop'))
        del.addEventListener('click', () => edit((g) => { if (g.stops.length > 2) g.stops.splice(i, 1) }, true))
        wrap.appendChild(del)
      }
      this.host.appendChild(wrap)
    })
  }

  /**
   * Font picker: theme default, curated system stacks, fonts embedded in the
   * document, and (if unmatched) the element's current custom stack. Options
   * render in their own face so the menu previews itself.
   */
  private fontSelect(el: TextElement): HTMLElement {
    const sel = document.createElement('select')
    const current = el.fontFamily ?? ''
    const add = (label: string, value: string, selected: boolean) => {
      const o = document.createElement('option')
      o.value = value
      o.textContent = label
      o.style.fontFamily = value || 'inherit'
      o.selected = selected
      sel.appendChild(o)
      return o
    }
    const curFirst = firstFamily(current)
    let matched = false
    add(t('Theme font'), '', current === '')
    for (const f of this.store.doc.fonts ?? []) {
      const hit = !matched && (current === f.family || curFirst === firstFamily(f.family))
      if (hit) matched = true
      add(t('{name} (embedded)', { name: f.family }), f.family, hit)
    }
    for (const c of FONT_CHOICES) {
      const hit = !matched && current !== '' && curFirst === firstFamily(c.stack)
      if (hit) matched = true
      add(c.label, c.stack, hit)
    }
    if (current && !matched) add(curFirst || t('custom'), current, true)
    // bringing in a font is where you look for fonts: the list's last entry
    const EMBED = '\u0000embed'
    const chosen = sel.selectedIndex
    const embed = add(t('＋ Embed font file…'), EMBED, false)
    embed.style.fontFamily = 'inherit'
    embed.title = t('Bundle a .woff2/.woff/.ttf/.otf into this file and use it here')
    sel.addEventListener('change', () => {
      if (sel.value === EMBED) {
        sel.selectedIndex = chosen // the choice stays the font in use
        this.embedFont(el)
        return
      }
      this.mutate(el.id, (e) => { (e as TextElement).fontFamily = sel.value }, true)
    })
    return sel
  }

  /** Bundle a font file into the document and apply it to this element. */
  private embedFont(el: TextElement) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.woff2,.woff,.ttf,.otf'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async () => {
        const family = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Embedded font'
        const asset = `font_${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        const src = String(reader.result)
        // the weights and style the file states (#850): otherwise every face is
        // declared 400 and Bold on a variable or bold font is faux bold
        const faces = await fontFaceDescriptors(new Uint8Array(await file.arrayBuffer()), src)
        this.store.commit(() => {
          const doc = this.store.doc
          doc.assets = { ...(doc.assets ?? {}), [asset]: src }
          doc.fonts = [...(doc.fonts ?? []).filter((f) => f.family !== family), { family, asset, ...faces }]
          const live = this.store.element(el.id)
          if (live && live.type === 'text') live.fontFamily = family
        })
        injectFonts(this.store.doc)
        this.toast(t('“{name}” embedded in this file', { name: family }))
      }
      reader.readAsDataURL(file)
    })
    input.click()
  }

  /** What only some shapes have: line tips, a second arrow head. */
  private buildShapeProps(el: ShapeElement) {
    // Tips: lines, and open paths (a curved line or connector, #302). The
    // options are tips.ts's catalogue — display labels localized, values the
    // model's words. A closed path (polygon) has no ends to tip.
    if (el.shape === 'line' || (el.shape === 'path' && !/z\s*$/i.test(el.d ?? ''))) {
      const ENDINGS: Array<[string, string]> = TIPS.map((tip) => [tip.kind, t(tip.label)])
      this.row('Line start', this.labeledSelect(ENDINGS, el.lineStart ?? 'none', (v) =>
        this.mutate(el.id, (e) => { (e as ShapeElement).lineStart = v === 'none' ? undefined : (v as LineEnding) }, true)))
      this.row('Line end', this.labeledSelect(ENDINGS, el.lineEnd ?? 'none', (v) =>
        this.mutate(el.id, (e) => { (e as ShapeElement).lineEnd = v === 'none' ? undefined : (v as LineEnding) }, true)))
    }
    if (el.shape === 'arrow') {
      // #304: a head at both ends is a property of the arrow, not a kind
      this.row('Double-headed', this.toggle(el.heads === 2, (on) =>
        this.mutate(el.id, (e) => { const s = e as ShapeElement; if (on) s.heads = 2; else delete s.heads }, true)))
    }
  }

  private buildShapeFill(el: ShapeElement) {
    this.section(t('Fill'))
    const grad = el.fillGradient
    this.field(this.fillKind(grad ? 'gradient' : 'solid', (v) =>
      this.mutate(el.id, (e) => {
        const s = e as ShapeElement
        if (v === 'gradient') {
          const base = parseColor(s.fill)
          s.fillGradient ??= {
            angle: 180,
            stops: [
              { at: 0, color: combineColor(base.hex, Math.max(base.a, 0.85)) },
              { at: 1, color: combineColor(base.hex, 0) },
            ],
          }
        } else {
          delete s.fillGradient
        }
      }, true)))
    if (!grad) {
      this.field(this.colorAlpha(el.fill, (v, fin) =>
        this.mutate(el.id, (e) => { (e as ShapeElement).fill = v }, fin),
        { id: el.id, path: 'fill' }))
    } else {
      this.gradientRows(grad, (fn, fin) => this.mutate(el.id, (e) => {
        const g = (e as ShapeElement).fillGradient
        if (g) fn(g)
      }, fin))
    }
  }

  /** Stroke — an optional layer for a closed shape; a line IS its stroke, so
   *  a line's cannot be removed. */
  private buildShapeStroke(el: ShapeElement) {
    const isLine = el.shape === 'line' || el.shape === 'arrow' || (el.shape === 'path' && !/z\s*$/i.test(el.d ?? ''))
    const on = el.strokeWidth > 0 && parseColor(el.stroke).a > 0
    this.section(t('Stroke'), isLine ? undefined : on
      ? { add: false, hint: t('Remove stroke'), run: () => this.mutate(el.id, (e) => { (e as ShapeElement).strokeWidth = 0 }, true) }
      : { add: true, hint: t('Add stroke'), run: () => this.mutate(el.id, (e) => {
        const s = e as ShapeElement
        s.strokeWidth = 2
        if (parseColor(s.stroke).a === 0) s.stroke = '#1E2A3A'
      }, true) })
    if (!on && !isLine) return
    this.field(this.colorAlpha(el.stroke === 'transparent' ? 'rgba(30, 42, 58, 0)' : el.stroke, (v, fin) =>
      this.mutate(el.id, (e) => { (e as ShapeElement).stroke = v }, fin)))
    const style = this.labeledSelect(
      [['solid', t('solid')], ['dashed', t('dashed')], ['dotted', t('dotted')]],
      el.strokeStyle ?? (el.strokeDash ? 'dashed' : 'solid'),
      (v) => this.mutate(el.id, (e) => {
        const s = e as ShapeElement
        s.strokeStyle = v === 'solid' ? undefined : (v as 'dashed' | 'dotted')
        if (v === 'solid') delete s.strokeDash // clear the legacy dash too
      }, true))
    style.title = t('Line style')
    style.setAttribute('aria-label', t('Line style'))
    const grid = document.createElement('div')
    grid.className = 'ed-grid2'
    grid.append(this.mini(t('Width'), el.strokeWidth, (v, fin) =>
      this.mutate(el.id, (e) => { (e as ShapeElement).strokeWidth = Math.max(v, 0) }, fin), undefined, { min: 0 }), style)
    this.host.appendChild(grid)
  }

  /** Edit the live chart option in place; final=false while typing. */
  private editOption(id: string, fn: (o: Record<string, any>) => void, final = true) {
    this.mutate(id, (e) => { fn((e as ChartElement).option as Record<string, any>) }, final)
  }

  /** Native <select> with distinct value/label pairs (for model-word values). */
  private labeledSelect(pairs: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLSelectElement {
    const sel = document.createElement('select')
    for (const [v, label] of pairs) {
      const o = document.createElement('option')
      o.value = v; o.textContent = label
      if (v === value) o.selected = true
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => onChange(sel.value))
    return sel
  }

  private buildChartProps(el: ChartElement) {
    const opt = el.option as Record<string, any>
    const series: any[] = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : []
    const isPie = series.some((s) => s?.type === 'pie')
    const isScatter = series.some((s) => s?.type === 'scatter')

    this.section(t('Chart'))
    // live table binding banner (if this chart tracks a table)
    if (el.source?.tableId) {
      const linkRow = document.createElement('div')
      linkRow.className = 'ed-chart-link'
      const label = document.createElement('span')
      const stillThere = this.store.slide.elements.some((e) => e.id === el.source!.tableId && e.type === 'table')
      label.textContent = stillThere ? t('🔗 Live-linked to a table') : t('🔗 Linked table not on this slide')
      const unlink = document.createElement('button')
      unlink.className = 'ed-btn'
      unlink.textContent = t('Unlink')
      unlink.title = t('Stop tracking the table; the chart keeps its current data')
      unlink.addEventListener('click', () => this.mutate(el.id, (e) => { delete (e as ChartElement).source }, true))
      linkRow.append(label, unlink)
      this.host.appendChild(linkRow)
    }
    this.row('Type', this.labeledSelect(Object.keys(CHART_PRESETS).map((k): [string, string] => [k, t(({ bar: 'Bar', line: 'Line', pie: 'Pie', scatter: 'Scatter' } as Record<string, string>)[k] ?? k)]), el.preset ?? 'bar', (v) =>
      this.mutate(el.id, (e) => {
        const c = e as ChartElement
        c.preset = v
        c.option = applyChartPalette(CHART_PRESETS[v](), this.store.doc.theme)
      }, true)))

    if (!isPie && !isScatter) this.buildChartCartesian(el, opt, series)
    else if (isPie) this.buildChartPie(el, series)

    // The escape hatch: the full option as JSON, for anything the UI omits.
    this.section(t('Advanced (JSON)'))
    const hint = document.createElement('p')
    hint.className = 'ed-hint'
    hint.innerHTML = t('The full <b>chart option</b> as JSON (pure data — use template-string formatters like <code>{b}: {c}</code>, never functions). Tooltips and zoom run while presenting.')
    this.host.appendChild(hint)
    const ta = document.createElement('textarea')
    ta.className = 'ed-chart-json'
    ta.rows = 12
    ta.spellcheck = false
    ta.value = JSON.stringify(el.option, null, 2)
    ta.addEventListener('change', () => {
      try {
        const parsed = JSON.parse(ta.value)
        ta.classList.remove('ed-invalid')
        this.mutate(el.id, (e) => { (e as ChartElement).option = parsed }, true)
      } catch { ta.classList.add('ed-invalid') }
    })
    this.host.appendChild(ta)
  }

  private static seriesColor(s: any, palette: string[] | undefined, i: number): string {
    const c = s?.type === 'line' ? s?.lineStyle?.color : s?.itemStyle?.color
    if (typeof c === 'string') return c
    const p = palette && palette.length ? palette : ['#5470c6', '#91cc75', '#fac858', '#ee6666']
    return p[i % p.length]
  }

  private static setSeriesColor(s: any, v: string) {
    if (s?.type === 'line') s.lineStyle = { ...(s.lineStyle ?? {}), color: v }
    else s.itemStyle = { ...(s.itemStyle ?? {}), color: v }
  }

  private buildChartCartesian(el: ChartElement, opt: Record<string, any>, series: any[]) {
    const yAxis: any[] = Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [{ type: 'value' }]
    const twoAxes = yAxis.length > 1

    this.row('Legend', this.toggle(!!opt.legend, (on) =>
      this.editOption(el.id, (o) => { if (on) o.legend = { bottom: 0 }; else delete o.legend })))

    this.row('Second axis', this.toggle(twoAxes, (on) => this.editOption(el.id, (o) => {
      const ss: any[] = Array.isArray(o.series) ? o.series : o.series ? [o.series] : []
      if (on) {
        const first = Array.isArray(o.yAxis) ? (o.yAxis[0] ?? {}) : (o.yAxis ?? {})
        o.yAxis = [{ type: 'value', ...first }, { type: 'value', name: t('Axis {n}', { n: 2 }) }]
        ss.forEach((s, i) => { if (s) s.yAxisIndex = i === 0 ? 0 : 1 })
      } else {
        o.yAxis = { type: 'value', ...(Array.isArray(o.yAxis) ? o.yAxis[0] : o.yAxis) }
        ss.forEach((s) => { if (s) delete s.yAxisIndex })
      }
    })))

    // --- series list --------------------------------------------------------
    this.section(t('Series'))
    const palette: string[] | undefined = Array.isArray(opt.color) ? opt.color : undefined
    series.forEach((s, i) => {
      const row = document.createElement('div')
      row.className = 'ed-series-row'
      const name = document.createElement('input')
      name.type = 'text'; name.className = 'ed-series-name'; name.value = s?.name ?? ''
      name.placeholder = t('Series {n}', { n: i + 1 })
      name.addEventListener('input', () => this.editOption(el.id, (o) => { o.series[i].name = name.value }, false))
      name.addEventListener('change', () => this.editOption(el.id, (o) => { o.series[i].name = name.value }, true))
      const type = this.labeledSelect([['bar', t('Bar')], ['line', t('Line')]], s?.type === 'line' ? 'line' : 'bar',
        (v) => this.editOption(el.id, (o) => { o.series[i].type = v }))
      row.append(name, type)
      if (twoAxes) {
        row.append(this.labeledSelect([['0', t('Left')], ['1', t('Right')]], String(Math.round(s?.yAxisIndex ?? 0)),
          (v) => this.editOption(el.id, (o) => { o.series[i].yAxisIndex = parseInt(v) })))
      }
      row.append(this.color(PropsPanel.seriesColor(s, palette, i), (v, final) =>
        this.editOption(el.id, (o) => PropsPanel.setSeriesColor(o.series[i], v), final)))
      const rm = this.opBtn('✕', t('Remove'), () => this.editOption(el.id, (o) => {
        o.series.splice(i, 1)
        if (o.series.length <= 1) { o.series.forEach((x: any) => x && delete x.yAxisIndex); if (Array.isArray(o.yAxis)) o.yAxis = o.yAxis[0] ?? { type: 'value' } }
      }))
      rm.classList.add('ed-series-rm')
      row.append(rm)
      this.host.appendChild(row)
    })
    const addRow = document.createElement('div')
    addRow.className = 'ed-chart-add'
    const addBtn = document.createElement('button')
    addBtn.className = 'ed-btn'
    addBtn.textContent = t('＋ Add series')
    addBtn.addEventListener('click', () => this.editOption(el.id, (o) => {
      const ss: any[] = Array.isArray(o.series) ? o.series : o.series ? [o.series] : []
      const n = (o.xAxis?.data?.length) || 4
      ss.push({ type: 'bar', name: t('Series {n}', { n: ss.length + 1 }), data: Array(n).fill(0) })
      o.series = ss
    }))
    addRow.appendChild(addBtn)
    this.host.appendChild(addRow)

    // --- per-axis min/max ---------------------------------------------------
    yAxis.forEach((ax, ai) => {
      const label = twoAxes ? (ai === 0 ? t('Left axis') : t('Right axis')) : t('Y axis')
      const wrap = document.createElement('div')
      wrap.className = 'ed-axis-range'
      const mk = (key: 'min' | 'max', ph: string) => {
        const inp = document.createElement('input')
        inp.type = 'number'; inp.placeholder = ph
        inp.value = typeof ax?.[key] === 'number' ? String(ax[key]) : ''
        const commit = (final: boolean) => this.editOption(el.id, (o) => {
          const a = Array.isArray(o.yAxis) ? o.yAxis[ai] : o.yAxis
          const raw = inp.value.trim()
          if (raw === '' || Number.isNaN(parseFloat(raw))) delete a[key]
          else a[key] = parseFloat(raw)
        }, final)
        inp.addEventListener('input', () => commit(false))
        inp.addEventListener('change', () => commit(true))
        inp.addEventListener(SCRUB, () => commit(false))
        return inp
      }
      // a placeholder is no label once a value is typed: say min/max beside
      // the fields, and let those words scrub them
      const lo = mk('min', t('min')), hi = mk('max', t('max'))
      wrap.append(unitHandle(t('min'), lo), lo, unitHandle(t('max'), hi), hi)
      this.row(label, wrap)
    })

    // --- data grid ----------------------------------------------------------
    this.buildChartGrid(el, opt, series)
  }

  /** Editable categories × series grid. Adding/removing rows keeps every
   *  series data array and the x-axis categories in lockstep. */
  private buildChartGrid(el: ChartElement, opt: Record<string, any>, series: any[]) {
    const cats: any[] = opt.xAxis?.data ?? []
    this.section(t('Data'))
    const scroll = document.createElement('div')
    scroll.className = 'ed-chart-grid-wrap'
    const table = document.createElement('table')
    table.className = 'ed-chart-grid'
    const thead = document.createElement('tr')
    const corner = document.createElement('th'); corner.textContent = ''
    thead.appendChild(corner)
    series.forEach((s, i) => {
      const th = document.createElement('th')
      th.textContent = s?.name || t('Series {n}', { n: i + 1 })
      thead.appendChild(th)
    })
    thead.appendChild(document.createElement('th'))
    table.appendChild(thead)

    const cellInput = (value: string, onCommit: (v: string, final: boolean) => void, numeric: boolean) => {
      const inp = document.createElement('input')
      inp.type = numeric ? 'number' : 'text'
      inp.value = value
      inp.addEventListener('input', () => onCommit(inp.value, false))
      inp.addEventListener('change', () => onCommit(inp.value, true))
      return inp
    }

    const rowCount = Math.max(cats.length, ...series.map((s) => (s?.data?.length ?? 0)))
    for (let r = 0; r < rowCount; r++) {
      const tr = document.createElement('tr')
      const cat = document.createElement('td')
      cat.appendChild(cellInput(String(cats[r] ?? ''), (v, final) => this.editOption(el.id, (o) => {
        if (!Array.isArray(o.xAxis?.data)) { o.xAxis = { ...(o.xAxis ?? { type: 'category' }), data: [] } }
        o.xAxis.data[r] = v
      }, final), false))
      tr.appendChild(cat)
      series.forEach((s, i) => {
        const td = document.createElement('td')
        td.appendChild(cellInput(String(s?.data?.[r] ?? ''), (v, final) => this.editOption(el.id, (o) => {
          const arr = o.series[i].data ?? (o.series[i].data = [])
          const n = parseFloat(v)
          arr[r] = Number.isNaN(n) ? 0 : n
        }, final), true))
        tr.appendChild(td)
      })
      const rmTd = document.createElement('td')
      rmTd.appendChild(this.opBtn('✕', t('Remove row'), () => this.editOption(el.id, (o) => {
        if (Array.isArray(o.xAxis?.data)) o.xAxis.data.splice(r, 1)
        o.series.forEach((s: any) => { if (Array.isArray(s?.data)) s.data.splice(r, 1) })
      })))
      tr.appendChild(rmTd)
      table.appendChild(tr)
    }
    scroll.appendChild(table)
    this.host.appendChild(scroll)

    const addRow = document.createElement('div')
    addRow.className = 'ed-chart-add'
    const addBtn = document.createElement('button')
    addBtn.className = 'ed-btn'
    addBtn.textContent = t('＋ Add row')
    addBtn.addEventListener('click', () => this.editOption(el.id, (o) => {
      if (!Array.isArray(o.xAxis?.data)) o.xAxis = { ...(o.xAxis ?? { type: 'category' }), data: [] }
      o.xAxis.data.push(t('Item {n}', { n: o.xAxis.data.length + 1 }))
      const ss: any[] = Array.isArray(o.series) ? o.series : [o.series]
      ss.forEach((s) => { if (s) (s.data ?? (s.data = [])).push(0) })
    }))
    addRow.appendChild(addBtn)
    this.host.appendChild(addRow)
  }

  /** Pie: one row per slice (name · value · colour · remove) + add. */
  private buildChartPie(el: ChartElement, series: any[]) {
    const s = series.find((x) => x?.type === 'pie') ?? series[0]
    const data: any[] = s?.data ?? []
    const palette: string[] | undefined = Array.isArray((el.option as any).color) ? (el.option as any).color : undefined
    this.section(t('Slices'))
    data.forEach((d, i) => {
      const row = document.createElement('div')
      row.className = 'ed-series-row'
      const name = document.createElement('input')
      name.type = 'text'; name.className = 'ed-series-name'; name.value = d?.name ?? ''
      name.addEventListener('input', () => this.editPieDatum(el.id, i, (x) => { x.name = name.value }, false))
      name.addEventListener('change', () => this.editPieDatum(el.id, i, (x) => { x.name = name.value }, true))
      const val = document.createElement('input')
      val.type = 'number'; val.className = 'ed-pie-val'; val.value = String(d?.value ?? 0)
      const commitVal = (final: boolean) => this.editPieDatum(el.id, i, (x) => { const n = parseFloat(val.value); x.value = Number.isNaN(n) ? 0 : n }, final)
      val.addEventListener('input', () => commitVal(false))
      val.addEventListener('change', () => commitVal(true))
      const swatch = this.color((palette && palette[i]) || PropsPanel.seriesColor({ type: 'pie' }, palette, i), (v, final) =>
        this.editOption(el.id, (o) => { if (!Array.isArray(o.color)) o.color = []; o.color[i] = v }, final))
      const rm = this.opBtn('✕', t('Remove'), () => this.editPieDatum(el.id, i, null, true))
      rm.classList.add('ed-series-rm')
      row.append(name, val, swatch, rm)
      this.host.appendChild(row)
    })
    const addRow = document.createElement('div')
    addRow.className = 'ed-chart-add'
    const addBtn = document.createElement('button')
    addBtn.className = 'ed-btn'
    addBtn.textContent = t('＋ Add slice')
    addBtn.addEventListener('click', () => this.editOption(el.id, (o) => {
      const ps = (Array.isArray(o.series) ? o.series : [o.series]).find((x: any) => x?.type === 'pie') ?? o.series[0]
      ps.data = ps.data ?? []
      ps.data.push({ name: t('Item {n}', { n: ps.data.length + 1 }), value: 0 })
    }))
    addRow.appendChild(addBtn)
    this.host.appendChild(addRow)
  }

  private editPieDatum(id: string, i: number, fn: ((d: any) => void) | null, final: boolean) {
    this.editOption(id, (o) => {
      const ps = (Array.isArray(o.series) ? o.series : [o.series]).find((x: any) => x?.type === 'pie') ?? o.series[0]
      if (!ps?.data) return
      if (fn === null) ps.data.splice(i, 1)
      else fn(ps.data[i])
    }, final)
  }

  private buildTableProps(el: TableElement) {
    const stepper = (label: string, count: number, onDelta: (d: number) => void) => {
      const wrap = document.createElement('div')
      wrap.className = 'ed-stepper'
      const minus = this.opBtn('−', t('Remove'), () => onDelta(-1))
      const val = document.createElement('span')
      val.className = 'ed-stepper-val'
      val.textContent = String(count)
      const plus = this.opBtn('+', t('Add'), () => onDelta(1))
      wrap.append(minus, val, plus)
      this.row(label, wrap)
    }
    const cols = el.columns.length
    const rows = el.rows.length
    stepper(t('Columns'), cols, (d) => this.mutate(el.id, (e) => {
      const tb = e as TableElement
      if (d > 0) { tb.columns.push({ w: 1 }); tb.rows.forEach((r) => r.cells.push({ html: '' })) }
      else if (tb.columns.length > 1) { tb.columns.pop(); tb.rows.forEach((r) => r.cells.pop()) }
    }, true))
    stepper(t('Rows'), rows, (d) => this.mutate(el.id, (e) => {
      const tb = e as TableElement
      const minRows = tb.header ? 2 : 1
      if (d > 0) tb.rows.push({ cells: tb.columns.map(() => ({ html: '' })) })
      else if (tb.rows.length > minRows) tb.rows.pop()
    }, true))

    this.row('Header row', this.toggle(el.header, (v) => this.mutate(el.id, (e) => {
      (e as TableElement).header = v
    }, true)))

    // one-tap looks that all work within the fixed-grid renderer
    const st = el.style
    const preset = st.borderWidth && st.zebra ? 'Boxed'
      : st.borderWidth ? 'Lined'
      : st.zebra ? 'Zebra'
      : 'Minimal'
    const themed = tableStyleFor(this.store.doc.theme)
    this.section(t('Style'))
    this.row('Preset', this.labeledSelect([['Lined', t('Lined')], ['Zebra', t('Striped')], ['Boxed', t('Boxed')], ['Minimal', t('Minimal')]], preset, (v) =>
      this.mutate(el.id, (e) => {
        const s = (e as TableElement).style
        s.borderWidth = v === 'Lined' || v === 'Boxed' ? Math.max(themed.borderWidth, 1) : 0
        s.zebra = v === 'Zebra' || v === 'Boxed' ? themed.zebra ?? 'rgba(30,42,58,0.05)' : undefined
        if (v === 'Minimal') { s.headerBg = 'transparent'; s.headerColor = s.color }
        else if (s.headerBg === 'transparent') {
          s.headerBg = themed.headerBg
          s.headerColor = themed.headerColor
        }
      }, true)))

    this.row('Header fill', this.colorAlpha(st.headerBg, (v, fin) =>
      this.mutate(el.id, (e) => { (e as TableElement).style.headerBg = v }, fin)))
    this.row('Header text', this.colorAlpha(st.headerColor, (v, fin) =>
      this.mutate(el.id, (e) => { (e as TableElement).style.headerColor = v }, fin)))
    this.row('Text', this.colorAlpha(st.color, (v, fin) =>
      this.mutate(el.id, (e) => { (e as TableElement).style.color = v }, fin)))
    this.row('Grid lines', this.colorAlpha(st.borderColor, (v, fin) =>
      this.mutate(el.id, (e) => { (e as TableElement).style.borderColor = v }, fin)))

    const grid = document.createElement('div')
    grid.className = 'ed-grid2'
    grid.append(
      this.mini(t('Font'), st.fontSize, (v, fin) => this.mutate(el.id, (e) =>
        { (e as TableElement).style.fontSize = Math.max(v, 6) }, fin), undefined, { min: 6 }),
      this.mini(t('Radius'), st.radius, (v, fin) => this.mutate(el.id, (e) =>
        { (e as TableElement).style.radius = Math.max(v, 0) }, fin), undefined, { min: 0 }),
      this.mini(t('Pad X'), st.cellPadX, (v, fin) => this.mutate(el.id, (e) =>
        { (e as TableElement).style.cellPadX = Math.max(v, 0) }, fin), undefined, { min: 0 }),
      this.mini(t('Pad Y'), st.cellPadY, (v, fin) => this.mutate(el.id, (e) =>
        { (e as TableElement).style.cellPadY = Math.max(v, 0) }, fin), undefined, { min: 0 }),
    )
    this.host.appendChild(grid)

    const hint = document.createElement('p')
    hint.className = 'ed-hint'
    hint.textContent = t('Double-click a cell to edit. Tab moves across, Enter down.')
    this.host.appendChild(hint)

    const toChart = document.createElement('button')
    toChart.className = 'ed-btn ed-btn-block'
    toChart.textContent = t('Make a chart from this table →')
    toChart.title = t('Create a bar chart from the numbers in this table (first column = labels)')
    toChart.addEventListener('click', () => this.tableToChart(el))
    this.host.appendChild(toChart)
  }

  /** Bridge: build a bar chart from a table's numeric columns and insert it. */
  private tableToChart(el: TableElement) {
    const bodyRows = el.header ? el.rows.slice(1) : el.rows
    // strip markup + entities + thousands separators so "1,204" / "+222%" parse
    const strip = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').replace(/,/g, '').trim()
    const num = (html: string) => parseFloat(strip(html))
    const labels = bodyRows.map((r) => strip(r.cells[0]?.html ?? ''))
    const headerRow = el.header ? el.rows[0] : null
    // every column after the labels that is mostly numeric becomes its own series
    const cols: Array<{ name: string; data: number[]; isPct: boolean; maxAbs: number }> = []
    for (let c = 1; c < el.columns.length; c++) {
      const raw = bodyRows.map((r) => r.cells[c]?.html ?? '')
      const parsed = raw.map(num)
      const good = parsed.filter((n) => !Number.isNaN(n))
      if (good.length < Math.ceil(bodyRows.length / 2)) continue
      const isPct = /%/.test(headerRow ? strip(headerRow.cells[c]?.html ?? '') : '') ||
        raw.filter((h) => /%/.test(h)).length >= Math.ceil(bodyRows.length / 2)
      cols.push({
        name: headerRow ? strip(headerRow.cells[c]?.html ?? '') : '',
        data: parsed.map((n) => (Number.isNaN(n) ? 0 : n)),
        isPct,
        maxAbs: Math.max(1, ...good.map((n) => Math.abs(n))),
      })
    }
    if (!cols.length) { this.toast(t('No numeric column found to chart')); return }

    // two columns on very different scales (or one is a %) → dual axis: bars
    // on the left, the odd one as a line on a right-hand axis
    let secondary = -1
    if (cols.length === 2) {
      const pct = cols.filter((c) => c.isPct)
      if (pct.length === 1) secondary = cols.indexOf(pct[0])
      else {
        const big = cols[0].maxAbs >= cols[1].maxAbs ? 0 : 1
        if (cols[big].maxAbs / cols[1 - big].maxAbs >= 12) secondary = 1 - big
      }
    }

    const option: Record<string, unknown> = {
      xAxis: { type: 'category', data: labels },
      tooltip: { trigger: 'axis' },
    }
    if (secondary >= 0) {
      const prim = cols[1 - secondary], sec = cols[secondary]
      option.yAxis = [
        { type: 'value', name: prim.name || undefined },
        { type: 'value', name: sec.name || undefined, axisLabel: sec.isPct ? { formatter: '{value}%' } : undefined },
      ]
      option.series = [
        { type: 'bar', name: prim.name, data: prim.data, yAxisIndex: 0 },
        { type: 'line', name: sec.name, data: sec.data, yAxisIndex: 1, smooth: true },
      ]
      option.legend = { bottom: 0 }
    } else {
      option.yAxis = { type: 'value' }
      option.series = cols.map((c) => ({ type: 'bar', name: c.name, data: c.data }))
      if (cols.length > 1) option.legend = { bottom: 0 }
    }
    applyChartPalette(option, this.store.doc.theme)
    const chart = defaultChart(option, {
      x: el.x, y: Math.min(el.y + el.h + 24, 480), w: Math.max(el.w, 640), h: 300, preset: 'bar',
      // live binding: edits to the table flow into this chart
      source: { tableId: el.id },
    })
    this.store.commit(() => this.store.slide.elements.push(chart))
    this.store.select([chart.id])
    this.toast(t('Chart created — it updates live with the table'))
  }

  private buildImageProps(el: SlideElement) {
    this.section(t('Picture'))
    const src = (el as ImageElement).src
    // what is stored: size and pixels for an embed, the URL otherwise
    const status = document.createElement('p')
    status.className = 'ed-hint'
    const resolved = src ? resolveAsset(this.store.doc, src) : ''
    if (resolved.startsWith('data:')) {
      const bytes = Math.floor(((resolved.length - resolved.indexOf(',') - 1) * 3) / 4)
      status.textContent = t('Embedded') + ` · ${fmtBytes(bytes)}`
      const probe = new Image()
      probe.onload = () => { status.textContent = t('Embedded') + ` · ${fmtBytes(bytes)} · ${probe.naturalWidth}×${probe.naturalHeight}` }
      probe.src = resolved
    } else status.textContent = src ? t('Linked') + ` · ${src.slice(0, 60)}` : t('No picture yet')
    this.host.appendChild(status)
    // Replace: through the shrink path, or at original size (the one honest
    // way to say "I want the full-resolution file in the deck").
    const pick = (label: string, original: boolean) => {
      const b = document.createElement('button')
      b.className = 'ed-btn ed-btn-block'
      b.textContent = label
      b.addEventListener('click', () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.addEventListener('change', () => {
          const file = input.files?.[0]
          if (!file) return
          void (original ? Promise.resolve(null) : shrinkImageFile(file)).then(async (r) => {
            const dataUrl = r ? r.dataUrl : await new Promise<string>((resolve) => { const rd = new FileReader(); rd.onload = () => resolve(String(rd.result)); rd.readAsDataURL(file) })
            const note = r && shrinkNote(r)
            if (note) this.toast(note.photo ? t('Photo stored at {px} px — {before} → {after}', note.vars) : t('Image stored at {px} px — {before} → {after}', note.vars))
            this.mutate(el.id, (e) => { (e as ImageElement).src = internAsset(this.store.doc, dataUrl) }, true)
          })
        })
        input.click()
      })
      this.host.appendChild(b)
    }
    pick(t('Replace file…'), false)
    pick(t('Replace file (original size)…'), true)
    this.section(t('Fit & corners'))
    this.row('Fit', this.segmented(['contain', 'cover', 'fill'], (el as any).fit, (v) =>
      this.mutate(el.id, (e) => { (e as any).fit = v }, true)))
    this.row('Corner radius', this.number((el as any).radius, 1, (v, fin) =>
      this.mutate(el.id, (e) => { (e as any).radius = Math.max(v, 0) }, fin), { min: 0 }))
    // Off = width and height resize independently. Unlocking also sets
    // fit:'fill' so the stretch is what the reader sees — contain/cover would
    // letterbox the distortion away. Re-locking deletes the field (absent =
    // locked, the format's default) and keeps the CURRENT shape: the next
    // resize starts from whatever ratio the frame has now.
    this.row('Keep aspect ratio', this.toggle((el as ImageElement).keepAspectRatio !== false, (on) =>
      this.mutate(el.id, (e) => {
        if (e.type !== 'image') return
        if (on) delete e.keepAspectRatio
        else { e.keepAspectRatio = false; e.fit = 'fill' }
      }, true)))
    this.buildCropProps(el as ImageElement)
  }

  /** Crop (discussion #319): which part of the picture the frame shows. The
   *  numbers live in `crop` (model.ts ImageCrop); the canvas edits them by
   *  gesture (double-click the picture), this block offers the zoom as a
   *  number, the way in, and the way back to the whole picture. */
  private buildCropProps(el: ImageElement) {
    this.section(t('Crop'))
    const hint = document.createElement('p')
    hint.className = 'ed-hint'
    hint.textContent = t('Double-click the picture to move it inside its frame; scroll or pinch to zoom.')
    this.host.appendChild(hint)
    const crop = normalizeCrop(el.crop)
    this.row('Zoom', this.number(Math.round((crop?.scale ?? 1) * 10) / 10, 0.1, (v, fin) =>
      this.mutate(el.id, (e) => {
        const im = e as ImageElement
        const scale = Math.min(CROP_MAX_SCALE, Math.max(1, Number.isFinite(v) ? v : 1))
        const cur = normalizeCrop(im.crop) ?? { x: 0.5, y: 0.5, scale: 1 }
        if (scale === 1 && cur.x === 0.5 && cur.y === 0.5) delete im.crop
        else im.crop = { ...cur, scale }
      }, fin)))
    const edit = document.createElement('button')
    edit.className = 'ed-btn ed-btn-block'
    edit.textContent = t('✎ Edit crop on canvas')
    edit.addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('bento:edit-crop', { detail: { id: el.id } })))
    this.host.appendChild(edit)
    if (el.crop) {
      const reset = document.createElement('button')
      reset.className = 'ed-btn ed-btn-block'
      reset.textContent = t('Reset crop')
      reset.title = t('Show the whole picture again, the way Fit says')
      reset.addEventListener('click', () => this.mutate(el.id, (e) => { delete (e as ImageElement).crop }, true))
      this.host.appendChild(reset)
    }
  }

  private buildMediaProps(el: MediaElement) {
    this.section(t('Source & playback'))

    // source status: embedded (with size) / linked / none
    const status = document.createElement('p')
    status.className = 'ed-hint'
    // Resolve first: an embed is stored as an `asset:` ref, so testing el.src
    // directly would report an embedded clip as "linked".
    const resolved = el.src ? resolveAsset(this.store.doc, el.src) : ''
    if (!el.src) status.textContent = t('No source yet — choose a file or paste a URL.')
    else if (resolved.startsWith('data:')) {
      const kb = Math.round((resolved.length * 3) / 4 / 1024)
      status.innerHTML = t('Embedded in the file') + ` · <b>${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}</b>`
    } else status.textContent = t('Linked — the deck stays small but needs this URL to play.')
    this.host.appendChild(status)

    // replace / choose file (embeds; warns over budget)
    const replace = document.createElement('button')
    replace.className = 'ed-btn ed-btn-block'
    replace.textContent = el.src ? t('Replace file…') : t('Choose file…')
    replace.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = el.kind === 'audio' ? 'audio/*' : 'video/*'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) return
        if (file.size > MEDIA_EMBED_BUDGET) {
          const mb = Math.round(file.size / (1024 * 1024))
          if (!confirm(t('This file is {mb} MB. Embedding makes the .bento.html large and slow to open and save. Embed anyway?', { mb }))) return
        }
        const reader = new FileReader()
        // interned, not inline — same reason as every other embed site: only
        // doc.assets entries are reachable by the live-collab blob offload.
        reader.onload = () => this.mutate(el.id, (e) => {
          (e as MediaElement).src = internAsset(this.store.doc, String(reader.result))
        }, true)
        reader.readAsDataURL(file)
      })
      input.click()
    })
    this.host.appendChild(replace)

    // URL (reference) — clears an embed when set
    const url = document.createElement('input')
    url.type = 'text'
    url.placeholder = t('…or paste a media URL')
    url.value = el.src && !el.src.startsWith('data:') && !el.src.startsWith('asset:') ? el.src : ''
    url.addEventListener('change', () =>
      this.mutate(el.id, (e) => { (e as MediaElement).src = url.value.trim() }, true))
    this.row('URL', url)

    // playback
    // Labels stay RAW English — row() translates them, and looks its tooltip up
    // by the English label. Passing t(…) here would translate twice and miss
    // ROW_TIPS in every locale but English.
    const toggle = (label: string, on: boolean, set: (v: boolean) => void) =>
      this.row(label, this.toggle(on, set))
    toggle('Controls', el.controls !== false, (v) => this.mutate(el.id, (e) => { (e as MediaElement).controls = v ? undefined : false }, true))
    toggle('Autoplay', !!el.autoplay, (v) => this.mutate(el.id, (e) => { (e as MediaElement).autoplay = v || undefined }, true))
    toggle('Loop', !!el.loop, (v) => this.mutate(el.id, (e) => { (e as MediaElement).loop = v || undefined }, true))
    toggle('Muted', !!el.muted, (v) => this.mutate(el.id, (e) => { (e as MediaElement).muted = v || undefined }, true))
    const note = document.createElement('p')
    note.className = 'ed-hint'
    note.textContent = t('Autoplay runs only while presenting; browsers require “muted” for video to autoplay.')
    this.host.appendChild(note)

    if (el.kind === 'video') {
      this.row('Fit', this.segmented(['contain', 'cover', 'fill'], el.fit ?? 'contain', (v) =>
        this.mutate(el.id, (e) => { (e as MediaElement).fit = v as MediaElement['fit'] }, true)))
      this.row('Corner radius', this.number(el.radius ?? 0, 1, (v, fin) =>
        this.mutate(el.id, (e) => { (e as MediaElement).radius = Math.max(v, 0) }, fin), { min: 0 }))
      const poster = document.createElement('input')
      poster.type = 'text'
      poster.placeholder = t('Poster image URL (optional)')
      poster.value = el.poster && !el.poster.startsWith('data:') ? el.poster : ''
      poster.addEventListener('change', () =>
        this.mutate(el.id, (e) => {
          const m = e as MediaElement
          const v = poster.value.trim()
          if (v) m.poster = v; else delete m.poster
        }, true))
      this.row('Poster', poster)
    }
  }

  /**
   * The `embed` element (model.ts EmbedElement). The view is the
   * tier that always paints; "Capture view" fills it from a picture the
   * author already has. It cannot be read off the live frame: the frame is
   * sandboxed without same-origin, so its pixels are not ours to take, and
   * that boundary is the point of the sandbox. A screenshot file is.
   */
  private buildEmbedProps(el: EmbedElement) {
    this.section(t('Web page'))

    const status = document.createElement('p')
    status.className = 'ed-hint ed-status'
    const view = (el.view ?? '').trim()
    if (!view) status.textContent = t('No view yet. Capture a picture of the page so it shows offline.')
    else if (view.startsWith('<') || view.startsWith('asset:')) status.textContent = t('View embedded in the file')
    else status.textContent = t('View is a link. It needs the network and shows nothing offline.')
    this.host.appendChild(status)

    const capture = document.createElement('button')
    capture.className = 'ed-btn ed-btn-block'
    capture.textContent = view ? t('Replace view…') : t('Capture view…')
    capture.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/svg+xml,image/png,image/jpeg,image/webp,image/gif'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) return
        const reader = new FileReader()
        const svg = file.type === 'image/svg+xml'
        reader.onload = () => this.mutate(el.id, (e) => {
          // an svg is the view as-is; a raster is wrapped so the view stays
          // one svg the sanitizer knows how to read (a data:image href is
          // on its allowlist). Interned, never inline: only doc.assets
          // entries reach the live-collab blob offload.
          const markup = svg ? String(reader.result) : rasterView(String(reader.result), e.w, e.h)
          ;(e as EmbedElement).view = internView(this.store.doc, markup)
        }, true)
        if (svg) reader.readAsText(file); else reader.readAsDataURL(file)
      })
      input.click()
    })
    this.host.appendChild(capture)

    // Labels stay RAW English: row() translates them and looks its tooltip
    // up by the English label (see buildMediaProps).
    const url = document.createElement('input')
    url.type = 'text'
    url.placeholder = 'https://'
    url.value = el.url ?? ''
    url.addEventListener('change', () =>
      this.mutate(el.id, (e) => {
        const m = e as EmbedElement
        const v = url.value.trim()
        if (v) m.url = v; else delete m.url
      }, true))
    this.row('Page URL', url)

    this.row('Live', this.toggle(!!el.live, (v) =>
      this.mutate(el.id, (e) => { (e as EmbedElement).live = v || undefined }, true)))
    const note = document.createElement('p')
    note.className = 'ed-hint'
    note.textContent = t('The live frame loads only while online. Offline mode and a missing network show the captured view instead.')
    this.host.appendChild(note)
    // Two things a presenter finds out on stage otherwise: a focused frame
    // keeps the arrow keys until they click outside it, and a live frame means
    // every viewer who presents this deck requests the page from its author —
    // the same trade a linked media src makes, said here so it is a choice.
    const trade = document.createElement('p')
    trade.className = 'ed-hint'
    trade.textContent = t('While presenting, a clicked frame keeps the arrow keys until you click outside it. Everyone who presents this deck loads the page from its site.')
    this.host.appendChild(trade)
  }

  private buildCodeProps(el: CodeElement) {
    this.section(t('Source Code'))
    const status = document.createElement('p')
    status.className = 'ed-hint'
    this.host.appendChild(status)
    // Font Size
    // Shown in POINTS (the unit office users know); the model stores slide-space
    // px. 1pt = 4/3 px at the slide's 96dpi space, so 32px = 24pt exactly.
    this.row('Size (pt)', this.number(Math.round(el.fontSize * 0.75 * 10) / 10, 1, (v, fin) =>
      this.mutate(el.id, (e) => {
        (e as CodeElement).fontSize = Math.round(Math.max(v, 3) * (4 / 3) * 100) / 100
      }, fin), { min: 3 }))
    // Alignment
    this.row('Align', this.segmented(['left', 'center', 'right'], el.align, (v) =>
      this.mutate(el.id, (e) => { (e as CodeElement).align = v as CodeElement['align'] }, true)))
    // V-Alignment
    this.row('Vertical align', this.segmented(['top', 'middle', 'bottom'], el.valign, (v) =>
      this.mutate(el.id, (e) => { (e as CodeElement).valign = v as CodeElement['valign'] }, true)))
    // Line height
    this.row('Line height', this.number(el.lineHeight, 0.05, (v, fin) =>
      this.mutate(el.id, (e) => { (e as CodeElement).lineHeight = Math.max(v, 0.5) }, fin), { min: 0.5 }))
    // Language — selects the built-in tokenizer table. grammarName doubles as
    // the language id; grammarAssetId/themeAssetId stay in the format as the
    // seam for a future signed-extension tier carrying real TextMate grammars
    // as deck assets, at which point pickers for them return here.
    const langs = Object.keys(LANGS).sort().concat(['diff', 'md'])
    this.row(t('Language'), this.select(langs, el.grammarName ?? 'js', (v) =>
      this.mutate(el.id, (e) => { (e as CodeElement).grammarName = v }, true)))
    status.textContent = t('{n} languages built in', { n: String(langs.length) })
    this.host.appendChild(status)
  }

  // --- element ops --------------------------------------------------------------

  /**
   * A dropdown whose chosen option does not fit beside its caption gets the
   * row to itself — caption above, field full width — rather than cutting
   * the value off, in whichever language made it long. Measured with text
   * metrics, not layout, so sections on a hidden tab are sized too; a resize
   * of the panel measures again.
   */
  private stackCrampedRows() {
    const host = this.host
    const ctx = (PropsPanel.measure ??= document.createElement('canvas').getContext('2d')!)
    // measured in the caption | control grid: a value wider than the control
    // column takes the row to itself, caption above
    for (const sel of host.querySelectorAll<HTMLSelectElement>('.ed-row > select')) {
      const row = sel.parentElement!
      row.classList.remove('ed-row-stack')
      if (!sel.offsetParent) continue
      ctx.font = getComputedStyle(sel).font
      const valueW = ctx.measureText(sel.options[sel.selectedIndex]?.text ?? '').width + 30 // padding + arrow
      row.classList.toggle('ed-row-stack', valueW > sel.clientWidth)
    }
    if (!this.watchingWidth) {
      this.watchingWidth = true
      let last = host.clientWidth
      new ResizeObserver(() => { if (host.clientWidth !== last) { last = host.clientWidth; this.stackCrampedRows() } }).observe(host)
    }
  }
  private static measure: CanvasRenderingContext2D | undefined
  private watchingWidth = false

  /**
   * What the panel is about, under the tabs, on every tab: the selection's
   * glyph and name, its two everyday actions, and one quiet line on how to
   * change it. The panel follows the selection — select something and its
   * options appear, click empty space and the slide's come back — and this
   * says so, so a different set of options never arrives as a surprise.
   */
  private mountContext(els: SlideElement[]) {
    const bar = document.createElement('div')
    bar.className = 'ed-context'
    const glyph = document.createElement('span')
    glyph.className = 'ed-context-glyph'
    const name = document.createElement('span')
    name.className = 'ed-context-name'
    const how = document.createElement('p')
    how.className = 'ed-context-how'
    const one = els.length === 1 ? els[0] : null
    if (!els.length) {
      const slide = this.store.slide
      glyph.innerHTML = ICONS.slideshow
      name.textContent = slide.name || t('Slide {n}', { n: this.store.currentIndex + 1 })
      how.textContent = t('Select something on the slide to see its options.')
    } else {
      glyph.innerHTML = one ? (LAYER_GLYPH[one.type] ?? ICONS.shapes) : ICONS.shapes
      name.textContent = one ? labelFor(one, t) : t('{n} elements', { n: els.length })
      how.textContent = one ? t('Click an empty part of the slide for the slide’s options.') : t('Shift-click to add an element or take one out.')
    }
    name.title = name.textContent ?? ''
    bar.append(glyph, name)
    if (els.length) {
      const mod = isMacOS() ? '⌘' : 'Ctrl+'
      bar.append(
        this.opBtn(ICONS.copy, `${t('Duplicate')} (${mod}D)`, () => this.duplicate(els)),
        this.opBtn(ICONS.trash, `${t('Delete')} (⌫)`, () => this.deleteEls(els)),
      )
    }
    this.host.querySelector(':scope > .ed-tabs-band')!.after(bar, how)
  }

  /** Same width/height for the whole selection — first selected is the reference. */
  private matchSize(els: SlideElement[], dim: 'w' | 'h') {
    if (els.length < 2) return
    const ref = els[0][dim]
    this.edit(() => { for (const el of els) el[dim] = ref }, true)
  }

  /** Single element aligns to the slide; a multi-selection aligns to its own bounds. */
  private align(els: SlideElement[], edge: 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom') {
    const { width, height } = this.store.doc.size
    const box = els.length === 1
      ? { x0: 0, y0: 0, x1: width, y1: height }
      : {
          x0: Math.min(...els.map((e) => e.x)),
          y0: Math.min(...els.map((e) => e.y)),
          x1: Math.max(...els.map((e) => e.x + e.w)),
          y1: Math.max(...els.map((e) => e.y + e.h)),
        }
    this.edit(() => {
      for (const el of els) {
        if (edge === 'left') el.x = box.x0
        if (edge === 'right') el.x = box.x1 - el.w
        if (edge === 'centerX') el.x = (box.x0 + box.x1) / 2 - el.w / 2
        if (edge === 'top') el.y = box.y0
        if (edge === 'bottom') el.y = box.y1 - el.h
        if (edge === 'middleY') el.y = (box.y0 + box.y1) / 2 - el.h / 2
      }
    }, true)
  }

  /** Even gaps between elements, first and last stay put. */
  private distribute(els: SlideElement[], axis: 'x' | 'y') {
    if (els.length < 3) return
    const size = axis === 'x' ? 'w' : 'h'
    const sorted = [...els].sort((a, b) => a[axis] - b[axis])
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const span = last[axis] + last[size] - first[axis]
    const total = sorted.reduce((s, e) => s + e[size], 0)
    const gap = (span - total) / (sorted.length - 1)
    this.edit(() => {
      let cursor = first[axis] + first[size] + gap
      for (const el of sorted.slice(1, -1)) {
        el[axis] = cursor
        cursor += el[size] + gap
      }
    }, true)
  }

  /** Move the selection one step up/down the paint order (adjacent swap). */
  private step(els: SlideElement[], dir: 1 | -1) {
    const ids = new Set(els.map((e) => e.id))
    this.store.commit(() => {
      const arr = this.store.slide.elements
      const idxs = arr.map((e, i) => (ids.has(e.id) ? i : -1)).filter((i) => i >= 0)
      const ordered = dir > 0 ? [...idxs].reverse() : idxs
      for (const i of ordered) {
        const j = i + dir
        if (j < 0 || j >= arr.length || ids.has(arr[j].id)) continue
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
    })
  }

  group(els: SlideElement[]) {
    if (els.length < 2) return
    const gid = `grp-${uid()}`
    // A group is one block in the stack, as in every design tool: the members
    // gather where the topmost of them was, keeping their own order, so the
    // layer list can show the group as one row with its members under it.
    // One undo step with the tagging.
    this.edit(() => {
      const ids = new Set(els.map((e) => e.id))
      const all = this.store.slide.elements
      const members = all.filter((e) => ids.has(e.id))
      let top = -1
      all.forEach((e, i) => { if (ids.has(e.id)) top = i })
      const rest = all.filter((e) => !ids.has(e.id))
      const at = all.slice(0, top + 1).filter((e) => !ids.has(e.id)).length
      this.store.slide.elements = [...rest.slice(0, at), ...members, ...rest.slice(at)]
      for (const el of members) { el.groupId = gid; delete el.groupName }
    }, true)
  }

  // --- reveal verbs (editor/reveal.ts decides, this applies) ---------------

  /** Number the selection in reading order: top-to-bottom, then left-to-right. */
  revealInOrder(els: SlideElement[]) { this.applySteps(revealInOrder(this.store.slide.elements, els)) }

  /** The whole selection on one step, after everything else on the slide. */
  revealTogether(els: SlideElement[]) { this.applySteps(revealTogether(this.store.slide.elements, els)) }

  /** Shown with the slide again. */
  removeReveal(els: SlideElement[]) { this.applySteps(removeReveal(els)) }

  private applySteps(patches: StepPatch[]) {
    if (!patches.length) return
    this.edit(() => {
      for (const { id, step } of patches) {
        const el = this.store.element(id)
        if (!el) continue
        const fx = { ...(el.fx ?? {}), step: step > 0 ? step : undefined }
        if (!fx.enter && !fx.countUp && !fx.ambient && !fx.loop && !fx.step && !fx.typeWriter) delete el.fx
        else el.fx = fx
      }
    }, true)
  }

  /** The three reveal verbs as a captioned button row (multi panel + Presenting). */
  private revealRow(els: SlideElement[]) {
    const stepped = els.some((e) => stepOf(e) > 0)
    const row = document.createElement('div')
    row.className = 'ed-reveal-row'
    const cap = document.createElement('span')
    cap.className = 'ed-arrange-cap'
    cap.textContent = t('Reveal')
    row.appendChild(cap)
    const btn = (label: string, title: string, run: () => void, enabled = true) => {
      const b = document.createElement('button')
      b.className = 'ed-btn'
      b.textContent = label
      b.title = title
      b.disabled = !enabled
      b.addEventListener('click', run)
      row.appendChild(b)
    }
    btn(t('In order'), t('Hide until → is pressed, one after another in reading order — top to bottom, then left to right'), () => this.revealInOrder(els))
    btn(t('Together'), t('Hide until → is pressed, all at once'), () => this.revealTogether(els))
    btn(t('Remove'), t('Show with the slide again'), () => this.removeReveal(els), stepped)
    this.host.appendChild(row)
    const hint = document.createElement('p')
    hint.className = 'ed-hint'
    hint.textContent = t('Numbered badges on the canvas show the order; click one for the next step.')
    this.host.appendChild(hint)
  }

  ungroup(els: SlideElement[]) {
    const gids = new Set(els.map((e) => e.groupId).filter(Boolean))
    this.edit(() => {
      for (const el of this.store.slide.elements) {
        if (el.groupId && gids.has(el.groupId)) { delete el.groupId; delete el.groupName }
      }
    }, true)
  }

  duplicate(els: SlideElement[]) {
    // clones of grouped elements get fresh group ids (kept consistent within
    // the batch) so a duplicated group is its own group, not the original's
    const gidMap = new Map<string, string>()
    const clones = els.map((el) => ({
      ...JSON.parse(JSON.stringify(el)),
      id: `${el.id.replace(/-copy\d*$/, '')}-copy${Math.floor(Math.random() * 1000)}`,
      x: el.x + 24,
      y: el.y + 24,
      ...(el.groupId
        ? { groupId: gidMap.get(el.groupId) ?? gidMap.set(el.groupId, `grp-${uid()}`).get(el.groupId)! }
        : {}),
    }))
    this.store.commit(() => this.store.slide.elements.push(...clones))
    this.store.select(clones.map((c) => c.id))
  }

  deleteEls(els: SlideElement[]) {
    const ids = new Set(els.map((e) => e.id))
    this.store.commit(() => {
      this.store.slide.elements = this.store.slide.elements.filter((e) => !ids.has(e.id))
    })
    this.store.select([])
  }

  /** Also driven by the canvas context menu (editor.ts). */
  reorder(els: SlideElement[], where: 'front' | 'back') {
    const ids = new Set(els.map((e) => e.id))
    this.store.commit(() => {
      const slide = this.store.slide
      const picked = slide.elements.filter((e) => ids.has(e.id))
      const rest = slide.elements.filter((e) => !ids.has(e.id))
      slide.elements = where === 'front' ? [...rest, ...picked] : [...picked, ...rest]
    })
  }

  // --- tiny DOM helpers -----------------------------------------------------------

  private mutate(id: string, fn: (el: SlideElement) => void, final: boolean) {
    const el = this.store.element(id)
    if (el) this.edit(() => fn(el), final)
  }

  private setNum(id: string, key: 'x' | 'y' | 'w' | 'h' | 'rotation' | 'opacity', v: number, final = true) {
    if (Number.isNaN(v)) return
    this.mutate(id, (el) => { (el as any)[key] = v }, final)
  }

  /** A section header. `action` puts Penpot's + or − on the header line: an
   *  optional property (stroke, shadow, blur) is added from its header and
   *  removed from it, instead of a 'none' in a dropdown. */
  private section(title: string, action?: { add: boolean; hint: string; run: () => void }) {
    const h = document.createElement('h3')
    h.className = 'ed-section'
    h.dataset.key = title
    h.textContent = title
    if (action) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ed-sec-act'
      b.innerHTML = action.add ? ICONS.plus : ICONS.minus
      b.title = action.hint
      b.setAttribute('aria-label', action.hint)
      b.addEventListener('click', (ev) => { ev.stopPropagation(); action.run() })
      h.appendChild(b)
      if (action.add) h.classList.add('ed-sec-empty')
    }
    this.host.appendChild(h)
  }

  /** A control with no caption of its own — its section's title says what it is. */
  private field(...controls: HTMLElement[]): HTMLElement {
    const line = document.createElement('div')
    line.className = 'ed-line'
    line.append(...controls)
    this.host.appendChild(line)
    return line
  }

  private row(label: string, input: HTMLElement): HTMLElement {
    // A segmented control is a group of buttons, and a <label> hands a click on
    // its caption to the first of them: clicking the word "Align" would align left.
    const row = document.createElement(input.classList.contains('ed-seg') ? 'div' : 'label')
    row.className = 'ed-row'
    const span = document.createElement('span')
    span.textContent = t(label)
    // real help on hover (label + control): looked up by the RAW English label;
    // rows without an entry get no tooltip — never a useless label echo
    const tip = ROW_TIPS[label]
    if (tip && !input.title) row.title = t(tip)
    if (input instanceof HTMLInputElement && input.type === 'number') scrub(span, input)
    row.append(span, input)
    this.host.appendChild(row)
    return row
  }

  /** A numeric field with its label inside it, Penpot's way. `icon` draws an
   *  icon there instead and makes the label the hint. */
  private mini(label: string, value: number, onChange: (v: number, final: boolean) => void, icon?: string, range?: { min?: number; max?: number }): HTMLElement {
    const wrap = document.createElement('label')
    wrap.className = 'ed-mini'
    const span = document.createElement('span')
    if (icon) {
      span.innerHTML = icon
      span.className = 'ed-mini-icon'
      wrap.title = label
      span.setAttribute('aria-label', label)
      wrap.style.setProperty('--lab', '13px')
    } else {
      span.textContent = label
      // the label sits inside the field (styles.css .ed-mini): pad the value past it
      const m = (PropsPanel.measure ??= document.createElement('canvas').getContext('2d')!)
      m.font = '11px system-ui, sans-serif'
      wrap.style.setProperty('--lab', `${Math.ceil(m.measureText(label).width)}px`)
    }
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(Math.round(value * 10) / 10)
    if (range?.min !== undefined) input.min = String(range.min)
    if (range?.max !== undefined) input.max = String(range.max)
    input.addEventListener('change', () => {
      const v = parseFloat(input.value)
      if (Number.isNaN(v)) return
      const held = bound(input, v) // a typed value past the limits is held to them, and shows so
      if (held !== v) input.value = String(held)
      onChange(held, true)
    })
    input.addEventListener(SCRUB, () => onChange(parseFloat(input.value), false))
    scrub(span, input)
    wrap.append(span, input)
    return wrap
  }

  private number(value: number, step: number, onEdit: (v: number, final: boolean) => void, range?: { min?: number; max?: number }): HTMLElement {
    const input = document.createElement('input')
    input.type = 'number'
    input.step = String(step)
    input.value = String(value)
    if (range?.min !== undefined) input.min = String(range.min)
    if (range?.max !== undefined) input.max = String(range.max)
    const send = (final: boolean) => {
      const v = parseFloat(input.value)
      if (Number.isNaN(v)) return
      const held = bound(input, v)
      if (final && held !== v) input.value = String(held)
      onEdit(held, final)
    }
    input.addEventListener('change', () => send(true))
    input.addEventListener(SCRUB, () => send(false))
    return input
  }

  private color(
    value: string,
    onEdit: (v: string, final: boolean) => void,
    /** when given, offer the deck's brand palette above the free picker.
     *  `id: null` means the property belongs to the slide, not an element. */
    ref?: { id: string | null; path: string; slide?: Slide },
  ): HTMLElement {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : parseColor(value).hex
    input.addEventListener('input', () => onEdit(input.value, false))
    // A colour chosen by hand must CLEAR any palette reference on this path.
    // Without that, the next theme edit silently overwrites a colour somebody
    // picked deliberately — which reads as the app changing their work.
    input.addEventListener('change', () => {
      onEdit(input.value, true)
      if (ref) this.setRef(ref, input.value, null)
    })
    const field = this.colorField(input)
    return ref ? this.themeLink(ref, input, field) : field
  }

  /**
   * The colour field as Penpot draws it: the swatch (the native picker), the
   * hex value to read and to type, and — when the colour has one — its
   * opacity, with '%' inside the field and scrubbable. Each part keeps THE
   * FIELD's own box (#729). A typed hex goes through the picker's own
   * 'change', so everything a picked colour does — the edit, clearing a
   * palette reference — a typed one does too.
   */
  private colorField(col: HTMLInputElement, alpha?: HTMLInputElement): HTMLElement {
    const box = document.createElement('div')
    box.className = 'ed-color'
    const hex = document.createElement('input')
    hex.type = 'text'
    hex.className = 'ed-color-hex'
    hex.spellcheck = false
    hex.maxLength = 7
    hex.setAttribute('aria-label', `${t('Color')} (hex)`)
    const show = () => { hex.value = col.value.slice(1) }
    show()
    col.addEventListener('input', show)
    hex.addEventListener('change', () => {
      const v = hex.value.trim().replace(/^#/, '')
      const full = /^[0-9a-f]{3}$/i.test(v) ? [...v].map((c) => c + c).join('') : v
      if (/^[0-9a-f]{6}$/i.test(full) && '#' + full.toLowerCase() !== col.value) {
        col.value = '#' + full.toLowerCase()
        col.dispatchEvent(new Event('input'))
        col.dispatchEvent(new Event('change'))
      }
      show()
    })
    box.append(col, hex)
    if (alpha) {
      const a = document.createElement('label')
      a.className = 'ed-mini ed-color-alpha'
      a.style.setProperty('--lab', '9px')
      a.append(unitHandle('%', alpha), alpha)
      box.append(a)
    }
    return box
  }

  /** Write a colour and its palette reference together, as one undoable edit. */
  private setRef(ref: { id: string | null; path: string; slide?: Slide }, literal: string, token: string | null) {
    this.edit(() => {
      const holder = ref.id ? this.store.element(ref.id) : (ref.slide ?? this.store.slide)
      if (holder) setColor(holder as never, ref.path, literal, token)
    }, true)
  }

  /**
   * The deck's theme colours, Penpot's library way. A palette button at the
   * end of the colour field opens them, each swatch with its name; a colour
   * taken from there shows the NAME in the field instead of a hex (it follows
   * the theme now), with a button to detach it back to a plain colour.
   *
   * Choosing one records WHERE the colour came from, so editing the theme later
   * re-derives it — that is the whole difference between a deck that can be
   * re-branded and one that has 400 hex literals in it.
   */
  private themeLink(ref: { id: string | null; path: string; slide?: Slide }, input: HTMLInputElement, field: HTMLElement): HTMLElement {
    const palette = paletteOf(this.store.doc)
    const holder = (ref.id ? this.store.element(ref.id) : (ref.slide ?? this.store.slide)) as never
    const linked = (holder ? refAt(holder, ref.path) : undefined)?.split(' ')[0] as (typeof PALETTE_SLOTS)[number] | undefined
    const outer = document.createElement('div')
    outer.className = 'ed-colorref'
    const list = document.createElement('div')
    list.className = 'ed-palette'
    list.hidden = true
    const cap = document.createElement('div')
    cap.className = 'ed-palette-cap'
    cap.textContent = t('Theme colors')
    list.appendChild(cap)
    for (const slot of PALETTE_SLOTS) {
      const base = palette[slot]
      if (!base) continue // hlink/folHlink are usually unset — don't show empties
      if (!slotIsSet(this.store.doc, slot)) continue // accent 2–6 unset: a copy of accent 1, not a choice
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'ed-palette-item'
      const chip = document.createElement('span')
      chip.className = 'ed-swatch'
      chip.style.background = cssColor(base, 'transparent') // a document colour: gated
      const name = document.createElement('span')
      name.textContent = slotLabel(slot) // the slot's name, not its id (bg1, tx1…)
      b.append(chip, name)
      if (slot === linked) b.classList.add('is-on')
      b.addEventListener('click', () => {
        input.value = /^#[0-9a-fA-F]{6}$/.test(base) ? base : parseColor(base).hex
        this.setRef(ref, base, slot)
      })
      list.appendChild(b)
    }
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'ed-btn ed-tool'
    open.innerHTML = ICONS.palette
    open.title = t('Theme colors')
    open.setAttribute('aria-label', t('Theme colors'))
    open.setAttribute('aria-expanded', 'false')
    open.addEventListener('click', () => {
      list.hidden = !list.hidden
      open.setAttribute('aria-expanded', String(!list.hidden))
    })
    if (linked) {
      const hex = field.querySelector<HTMLElement>('.ed-color-hex')
      const token = document.createElement('span')
      token.className = 'ed-color-token'
      token.textContent = slotLabel(linked)
      token.title = t('Follows the theme color “{name}”: change it under Theme and this changes with it.', { name: slotLabel(linked) })
      const detach = document.createElement('button')
      detach.type = 'button'
      detach.className = 'ed-color-detach'
      detach.innerHTML = ICONS.unlink
      detach.title = t('Detach from the theme')
      detach.setAttribute('aria-label', t('Detach from the theme'))
      detach.addEventListener('click', () => {
        const a = field.querySelector<HTMLInputElement>('.ed-color-alpha input')
        this.setRef(ref, a ? combineColor(input.value, Math.min(Math.max(parseFloat(a.value) / 100, 0), 1)) : input.value, null)
      })
      token.appendChild(detach)
      hex?.replaceWith(token)
    }
    field.appendChild(open)
    outer.append(field, list)
    return outer
  }

  /**
   * Deck-wide brand colours. Editing one re-derives every colour in the deck
   * that points at it (editor.syncThemeRefs), which is what makes a Bento deck
   * re-brandable rather than a pile of literals.
   */
  private buildThemeProps() {
    this.section(t('Theme'))
    const hint = document.createElement('p')
    hint.className = 'ed-hint'
    hint.textContent = t('Deck-wide brand colours. Anything using a theme colour follows when you change it here.')
    this.host.appendChild(hint)
    const theme = this.store.doc.theme
    const slot = (label: string, get: () => string, set: (v: string) => void) =>
      this.row(label, this.color(get(), (v, fin) => this.edit(() => set(v), fin)))
    slot('Background', () => theme.background, (v) => { this.store.doc.theme.background = v })
    slot('Text', () => theme.color, (v) => { this.store.doc.theme.color = v })
    slot('Accent', () => theme.accent, (v) => { this.store.doc.theme.accent = v })
    // Accent 2–6 rows only for slots the deck carries (palette.ts slotIsSet):
    // an unset one resolves to accent 1 and showed as a sixth identical swatch.
    for (const n of [2, 3, 4, 5, 6] as const) {
      const key = `accent${n}` as const
      if (!slotIsSet(this.store.doc, key)) continue
      slot(t('Accent {n}', { n: String(n) }), () => paletteOf(this.store.doc)[key], (v) => {
        const t2 = this.store.doc.theme
        ;(t2.palette ??= {})[key] = v
      })
    }
    // Code colours: theme.codePalette (#450), one row per token scope. Plain
    // literals, deliberately — the palette-swatch reference (themeRefs) is a
    // per-element/per-slide path resolved through resolveRef, and codePalette
    // is a doc-level map that code.ts reads as literals; wiring a second
    // reference shape for eight keys would be a mechanism, not a row. A deck
    // with no codePalette shows the built-in scheme as its starting values and
    // the field is written only when a colour is changed, so a deck without
    // one keeps rendering exactly as before.
    const codeHead = document.createElement('p')
    codeHead.className = 'ed-hint'
    codeHead.textContent = t('Code colours — one per kind of token in code snippets.')
    this.host.appendChild(codeHead)
    for (const scope of CODE_SCOPES) {
      slot(t(scope.label), () => this.store.doc.theme.codePalette?.[scope.key] ?? DEFAULT_CODE_COLORS[scope.key], (v) => {
        const t2 = this.store.doc.theme
        ;(t2.codePalette ??= {})[scope.key] = v
      })
    }
    if (this.store.doc.theme.codePalette) {
      const reset = document.createElement('button')
      reset.className = 'ed-btn ed-btn-block'
      reset.textContent = t('Use the built-in code colours')
      reset.title = t('Removes the deck’s code palette; snippets render with the standard scheme again')
      reset.addEventListener('click', () => this.edit(() => { delete this.store.doc.theme.codePalette }, true))
      this.host.appendChild(reset)
    }
  }

  /** Color swatch + opacity %. Native color inputs have no alpha channel, so
   *  the pair round-trips rgba()/#rrggbbaa strings losslessly. */
  private colorAlpha(
    value: string,
    onEdit: (v: string, final: boolean) => void,
    ref?: { id: string | null; path: string; slide?: Slide },
  ): HTMLElement {
    const parsed = parseColor(value)
    const col = document.createElement('input')
    col.type = 'color'
    col.value = parsed.hex
    const alpha = document.createElement('input')
    alpha.type = 'number'
    alpha.min = '0'
    alpha.max = '100'
    alpha.step = '1'
    alpha.value = String(Math.round(parsed.a * 100))
    alpha.title = t('Opacity %')
    const emit = (final: boolean) => {
      const raw = parseFloat(alpha.value)
      const a = Number.isFinite(raw) ? Math.min(Math.max(raw / 100, 0), 1) : 1
      onEdit(combineColor(col.value, a), final)
    }
    col.addEventListener('input', () => emit(false))
    // picking by hand clears the palette reference — see color() for why
    col.addEventListener('change', () => {
      emit(true)
      if (ref) this.setRef(ref, combineColor(col.value, parseFloat(alpha.value) / 100 || 1), null)
    })
    alpha.addEventListener('change', () => emit(true))
    alpha.addEventListener(SCRUB, () => emit(false))
    const wrap = this.colorField(col, alpha)
    return ref ? this.themeLink(ref, col, wrap) : wrap
  }

  /** Weight picker with the familiar named weights; stores the numeric value. */
  private weightSelect(el: TextElement): HTMLElement {
    const WEIGHTS: Array<[number, string]> = [
      [100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'],
      [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black'],
    ]
    const sel = document.createElement('select')
    const current = el.fontWeight ?? 400
    if (!WEIGHTS.some(([n]) => n === current)) {
      const o = document.createElement('option')
      o.value = String(current)
      o.textContent = t('Custom ({n})', { n: current })
      o.selected = true
      sel.appendChild(o)
    }
    for (const [n, name] of WEIGHTS) {
      const o = document.createElement('option')
      o.value = String(n)
      o.textContent = t(name)
      o.style.fontWeight = String(n)
      if (n === current) o.selected = true
      sel.appendChild(o)
    }
    sel.addEventListener('change', () =>
      this.mutate(el.id, (e) => { (e as TextElement).fontWeight = parseInt(sel.value) }, true))
    return sel
  }

  private select(options: string[], value: string, onChange: (v: string) => void): HTMLElement {
    const sel = document.createElement('select')
    for (const opt of options) {
      const o = document.createElement('option')
      o.value = opt
      o.textContent = t(opt)
      if (opt === value) o.selected = true
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => onChange(sel.value))
    return sel
  }

  /** A choice among a few options, every one visible, one click — where a
   *  <select> hid them behind two. Same call shape as select(). Options with a
   *  SEG_ICONS entry show the icon, with the word as its tooltip; otherwise the
   *  words show and the control takes the row's full width. */
  private segmented(options: string[], value: string, onChange: (v: string) => void, labels?: Record<string, string>): HTMLElement {
    const say = (o: string) => labels?.[o] ?? t(o)
    const wrap = document.createElement('div')
    wrap.className = 'ed-seg'
    wrap.setAttribute('role', 'radiogroup')
    const icons = !labels && options.every((o) => SEG_ICONS[o])
    if (!icons) wrap.classList.add('ed-seg-text')
    for (const opt of options) {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(opt === value))
      if (icons) {
        b.innerHTML = SEG_ICONS[opt]
        b.title = say(opt)
        b.setAttribute('aria-label', say(opt))
      } else b.textContent = say(opt)
      b.addEventListener('click', () => { if (opt !== value) onChange(opt) })
      wrap.appendChild(b)
    }
    return wrap
  }

  private toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.className = 'ed-toggle'
    cb.checked = value
    cb.addEventListener('change', () => onChange(cb.checked))
    return cb
  }

  private opBtn(icon: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button')
    btn.className = 'ed-btn ed-btn-icon'
    btn.title = title
    btn.innerHTML = icon
    btn.addEventListener('click', onClick)
    return btn
  }
}

type PanelTab = 'format' | 'animate' | 'interact'

/** A palette slot as the author knows it. */
function slotLabel(slot: string): string {
  switch (slot) {
    case 'bg1': return t('Background')
    case 'tx1': return t('Text')
    case 'bg2': return t('Background 2')
    case 'tx2': return t('Text 2')
    case 'hlink': return t('Link')
    case 'folHlink': return t('Visited link')
    default: return t('Accent {n}', { n: slot.replace('accent', '') })
  }
}

/** Fired on a numeric field while its label is being scrubbed: a live,
 *  non-final edit. The release fires an ordinary `change`. */
const SCRUB = 'ed-scrub'

/**
 * Drag a numeric field's label to change its value, the gesture every design
 * tool has: 2px per step, Shift ×10, Alt ×0.1. A press that does not move is
 * an ordinary label click and focuses the field for typing.
 *
 * The field holds focus for the length of the drag. That is what makes this
 * work at all: the panel defers its rebuild while a field is focused
 * (isActiveEditFocus), so the label being dragged is not torn out from under
 * the pointer, and edit()'s burst stays open, so the whole drag is ONE undo
 * step. Blurring on release lets the deferred rebuild catch up.
 */
function scrub(handle: HTMLElement, input: HTMLInputElement) {
  handle.classList.add('ed-scrub')
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || input.disabled) return
    let cur = parseFloat(input.value) || 0
    const step = parseFloat(input.step) || 1
    const x0 = ev.clientX
    let last = x0 // where the value was last stepped from
    let moved = false
    const move = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientX - x0) < 3) return
      if (!moved) { moved = true; input.focus(); document.body.classList.add('ed-scrubbing') }
      // Stepped from the LAST position, not the press: held at a limit, the
      // drag does not bank the overshoot, so turning back moves the value at
      // once instead of after a dead zone as long as the overshoot was.
      const steps = Math.trunc((e.clientX - last) / 2)
      if (!steps) return
      last += steps * 2
      const k = step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)
      const digits = Math.max(0, Math.ceil(-Math.log10(k) - 1e-9))
      cur = bound(input, cur + steps * k) // never past the field's own min/max
      const v = cur.toFixed(digits)
      cur = parseFloat(v) // no float drift across a long drag
      if (v === input.value) return
      input.value = v
      input.dispatchEvent(new Event(SCRUB))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) return
      document.body.classList.remove('ed-scrubbing')
      input.dispatchEvent(new Event('change'))
      // The click that ends a drag is not a label click: it must not refocus
      // the field (focus would keep ⌘Z in the field's own text undo). Caught
      // on window, because a press on the label released over the field is
      // dispatched to their common ancestor, the <label>, not to the handle.
      const swallow = (c: Event) => c.preventDefault()
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      input.blur()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}

/** A value held to a numeric field's min and max, where it has them. */
function bound(input: HTMLInputElement, v: number): number {
  const lo = input.min === '' ? -Infinity : parseFloat(input.min)
  const hi = input.max === '' ? Infinity : parseFloat(input.max)
  return Math.min(hi, Math.max(lo, v))
}

/** The scrub handle for a numeric field with no label of its own: its unit,
 *  or the word that names it, beside it. */
function unitHandle(text: string, input: HTMLInputElement): HTMLElement {
  const s = document.createElement('span')
  s.className = 'ed-unit'
  s.textContent = text
  scrub(s, input)
  return s
}

/** Segmented options that read better as a glyph (keyed by option value). */
const SEG_ICONS: Record<string, string> = {
  left: ICONS.alignLeft, center: ICONS.alignCenter, right: ICONS.alignRight,
  top: ICONS.valignTop, middle: ICONS.valignMiddle, bottom: ICONS.valignBottom,
}

/** Any CSS color → {hex, a}. Handles #rgb/#rrggbb/#rrggbbaa/rgb()/rgba()/transparent. */
export function parseColor(v: string): { hex: string; a: number } {
  if (!v || v === 'transparent' || v === 'none') return { hex: '#000000', a: 0 }
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).map((s) => parseFloat(s))
    const [r, g, b] = parts
    const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      const hex = '#' + [r, g, b].map((n) => Math.round(Math.min(Math.max(n, 0), 255)).toString(16).padStart(2, '0')).join('')
      return { hex, a: Math.min(Math.max(a, 0), 1) }
    }
  }
  let hex = v.trim()
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('')
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) return { hex: hex.slice(0, 7), a: parseInt(hex.slice(7), 16) / 255 }
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return { hex, a: 1 }
  return { hex: '#1E2A3A', a: 1 }
}

/** {hex, a} → the shortest CSS color that keeps the alpha. */
export function combineColor(hex: string, a: number): string {
  if (a >= 1) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`
}

/** Aesthetic shadow presets offered in the panel (custom values stay 'custom'). */
/** the presets' names on screen (the keys are stored in no file, but read as words) */
const SHADOW_NAMES: Record<string, string> = { subtle: 'Subtle', soft: 'Soft', elevated: 'Elevated', glow: 'Glow' }

const SHADOW_PRESETS: Record<string, { x?: number; y?: number; blur: number; color: string }> = {
  subtle: { y: 2, blur: 10, color: 'rgba(10,16,28,0.25)' },
  soft: { y: 10, blur: 28, color: 'rgba(10,16,28,0.32)' },
  elevated: { y: 24, blur: 56, color: 'rgba(8,12,22,0.45)' },
  glow: { blur: 40, color: 'rgba(255,238,214,0.55)' },
}

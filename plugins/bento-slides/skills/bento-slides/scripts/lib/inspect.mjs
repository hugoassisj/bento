// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The design-system report: what a deck already defines, so an edit reuses it
// instead of writing literals. Theme slots, tokens by type with their value in
// every mode, how much of the deck's styling is bound to them, components,
// layouts, fonts, the literals nobody bound, and the slide list. Pure
// functions over the document JSON.

import { slotsSet, paletteOf, parseColour } from './colour.mjs'

/** Style properties counted for the binding share; slides count `background`. */
export const STYLE_KEYS = ['color', 'fill', 'stroke', 'fontFamily', 'fontSize', 'strokeWidth', 'radius', 'opacity', 'shadow']
const COLOUR_KEYS = new Set(['color', 'fill', 'stroke'])
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'math', 'emoji'])

/** A value that says "nothing here" rather than a choice someone made. */
function trivial(key, v) {
  if (v === undefined || v === null || v === '') return true
  if (key === 'opacity') return v === 1
  if (key === 'strokeWidth' || key === 'radius') return v === 0
  if (key === 'fill' || key === 'stroke' || key === 'color' || key === 'background') return typeof v === 'string' && (/^none$/i.test(v.trim()) || parseColour(v)?.a === 0)
  return false
}

const isBound = (refs, key) => !!refs && Object.keys(refs).some((p) => p === key || p.startsWith(key + '.'))

/** Every (holder, key, value) style literal, with whether a reference binds it. */
export function styleValues(doc) {
  const out = []
  for (const [si, s] of (doc.slides ?? []).entries()) {
    if (!trivial('background', s.background)) out.push({ slide: s.id, slideIndex: si, key: 'background', value: s.background, bound: isBound(s.themeRefs, 'background') })
    for (const el of s.elements ?? []) {
      for (const k of STYLE_KEYS) {
        if (!Object.hasOwn(el, k) || trivial(k, el[k])) continue
        out.push({ slide: s.id, slideIndex: si, element: el.id, type: el.type, key: k, value: el[k], bound: isBound(el.themeRefs, k) })
      }
    }
  }
  return out
}

/** The first family of a font stack, unquoted. */
export const firstFamily = (stack) => String(stack ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')

function histogram(values, top = 12) {
  const m = new Map()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, top).map(([value, count]) => ({ value, count }))
}

const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

export function inspectDoc(doc) {
  const theme = doc.theme ?? {}
  const tk = theme.tokens ?? {}
  const set = tk.set ?? {}
  const modes = Array.isArray(tk.modes) && tk.modes.length ? tk.modes : ['default']
  const tokensByType = {}
  for (const [name, tok] of Object.entries(set)) {
    const type = tok?.type ?? 'color'
    ;(tokensByType[type] ??= []).push({ name, values: tok?.values ?? {} })
  }
  const pal = paletteOf(doc)
  const slots = slotsSet(doc).map((s) => ({ slot: s, value: pal[s], from: { bg1: 'theme.background', tx1: 'theme.color', accent1: 'theme.accent' }[s] ?? `theme.palette.${s}` }))

  const values = styleValues(doc)
  let refCount = 0
  const refKinds = { palette: 0, token: 0 }
  for (const s of doc.slides ?? []) for (const h of [s, ...(s.elements ?? [])]) {
    for (const ref of Object.values(h.themeRefs ?? {})) { refCount++; refKinds[String(ref).startsWith('$') ? 'token' : 'palette']++ }
  }
  const unbound = values.filter((v) => !v.bound)
  const share = refCount + unbound.length ? refCount / (refCount + unbound.length) : 0

  // components: the main set, its copies (one per group), what copies override
  const comps = new Map()
  for (const s of doc.slides ?? []) for (const el of s.elements ?? []) {
    const c = el.component
    if (!c?.id) continue
    const info = comps.get(c.id) ?? { id: c.id, name: '', mainSlide: null, mainMembers: 0, copies: new Set(), overridden: new Set(), copiesWithoutSig: new Set() }
    if (c.main) {
      if (!info.mainSlide || info.mainSlide === s.id) { info.mainSlide = s.id; info.mainMembers++; info.name ||= el.groupName ?? el.name ?? '' }
    } else {
      const g = `${s.id}|${el.groupId ?? el.id}`
      info.copies.add(g)
      for (const k of c.over ?? []) info.overridden.add(k)
      if (!c.sig) info.copiesWithoutSig.add(g)
    }
    comps.set(c.id, info)
  }
  const components = [...comps.values()].map((c) => ({ id: c.id, name: c.name, mainSlide: c.mainSlide, mainMembers: c.mainMembers, copies: c.copies.size, overriddenKeys: [...c.overridden].sort(), copiesWithoutSig: c.copiesWithoutSig.size }))

  const layouts = (doc.layouts ?? []).map((l) => ({ id: l.id, name: l.name ?? null, roles: [...new Set((l.elements ?? []).map((e) => e.role).filter(Boolean))] }))

  const fontEntries = doc.fonts ?? []
  const embedded = fontEntries.filter((f) => !String(f.asset ?? '').startsWith('builtin:')).map((f) => ({ family: f.family, weight: f.weight ?? null, asset: f.asset, bytes: doc.assets?.[f.asset] ? Buffer.byteLength(doc.assets[f.asset]) : null }))
  const builtin = fontEntries.filter((f) => String(f.asset ?? '').startsWith('builtin:')).map((f) => ({ family: f.family, weight: f.weight ?? null, face: f.asset }))
  const known = new Set(fontEntries.map((f) => String(f.family).toLowerCase()))
  const used = new Map()
  const use = (stack, where) => {
    const fam = firstFamily(stack)
    if (!fam) return
    const k = fam.toLowerCase()
    if (known.has(k) || GENERIC_FONTS.has(k)) return
    const u = used.get(fam) ?? { family: fam, uses: 0, where: new Set() }
    u.uses++; u.where.add(where)
    used.set(fam, u)
  }
  use(theme.fontFamily, 'theme.fontFamily')
  use(theme.codeFontFamily, 'theme.codeFontFamily')
  for (const [name, tok] of Object.entries(set)) if (tok?.type === 'fontFamily') for (const v of Object.values(tok.values ?? {})) use(v, `token ${name}`)
  for (const s of doc.slides ?? []) for (const el of s.elements ?? []) if (el.fontFamily) use(el.fontFamily, 'elements')
  const missing = [...used.values()].map((u) => ({ family: u.family, uses: u.uses, where: [...u.where] }))

  const W = doc.size?.width ?? 1280
  const texts = (doc.slides ?? []).flatMap((s) => (s.elements ?? []).filter((e) => e.type === 'text' && typeof e.x === 'number'))
  const slides = (doc.slides ?? []).map((s, i) => {
    const t = (s.elements ?? []).find((e) => e.role === 'title' && e.type === 'text') ?? (s.elements ?? []).find((e) => e.type === 'text' && plain(e.html))
    return {
      n: i + 1, id: s.id, name: s.name ?? null, title: t ? plain(t.html).slice(0, 60) : null,
      stateOf: s.stateOf ?? null, hidden: !!s.hidden, layout: s.layout ?? null, elements: (s.elements ?? []).length,
    }
  })

  return {
    title: doc.title ?? null,
    size: doc.size ?? null,
    theme: {
      slots,
      fontFamily: theme.fontFamily ?? null,
      codeFontFamily: theme.codeFontFamily ?? null,
      chartPalette: theme.chartPalette ?? null,
    },
    tokens: { count: Object.keys(set).length, modes, mode: tk.mode && modes.includes(tk.mode) ? tk.mode : modes[0], byType: tokensByType },
    binding: { styleValues: refCount + unbound.length, bound: refCount, palette: refKinds.palette, tokens: refKinds.token, unbound: unbound.length, share: Math.round(share * 1000) / 1000 },
    components,
    layouts,
    fonts: { embedded, builtin, missing },
    unbound: {
      colours: histogram(unbound.filter((v) => COLOUR_KEYS.has(v.key) || v.key === 'background').map((v) => String(v.value).toLowerCase())),
      fontSizes: histogram(unbound.filter((v) => v.key === 'fontSize').map((v) => v.value)),
      leftMargins: histogram(texts.map((e) => Math.round(e.x))),
      rightMargins: histogram(texts.map((e) => Math.round(W - (e.x + (e.w ?? 0))))),
    },
    slides,
  }
}

/** A short human summary of inspectDoc's report. */
export function formatInspect(r) {
  const lines = []
  lines.push(`bento inspect — ${r.title ?? '(untitled)'}  ${r.size ? `${r.size.width}×${r.size.height}` : ''}`)
  lines.push(`\n  theme slots (${r.theme.slots.length}): ${r.theme.slots.map((s) => `${s.slot} ${s.value}`).join(', ')}`)
  if (r.theme.fontFamily) lines.push(`  theme font: ${r.theme.fontFamily}`)
  lines.push(`\n  tokens (${r.tokens.count}), modes: ${r.tokens.modes.join(', ')} (active: ${r.tokens.mode})`)
  for (const [type, list] of Object.entries(r.tokens.byType)) {
    const show = list.slice(0, 12).map((t) => {
      const vals = Object.entries(t.values).map(([m, v]) => (r.tokens.modes.length > 1 ? `${m}=` : '') + (typeof v === 'object' ? JSON.stringify(v) : v))
      return `$${t.name} ${vals.join(' / ')}`
    })
    lines.push(`    ${type} (${list.length}): ${show.join(', ')}${list.length > 12 ? `, +${list.length - 12} more` : ''}`)
  }
  const b = r.binding
  lines.push(`\n  bound style values: ${b.bound} of ${b.styleValues} (${Math.round(b.share * 100)}%) — ${b.palette} to palette slots, ${b.tokens} to tokens; ${b.unbound} literals`)
  lines.push(`\n  components (${r.components.length}):`)
  for (const c of r.components) lines.push(`    ${c.name || c.id} [${c.id}]: main on ${c.mainSlide} (${c.mainMembers} element${c.mainMembers === 1 ? '' : 's'}), ${c.copies} cop${c.copies === 1 ? 'y' : 'ies'}${c.overriddenKeys.length ? `, copies override ${c.overriddenKeys.join(' ')}` : ''}${c.copiesWithoutSig ? `, ${c.copiesWithoutSig} without sig` : ''}`)
  lines.push(`  layouts (${r.layouts.length})${r.layouts.length ? ': ' + r.layouts.map((l) => `${l.name ?? l.id} [${l.roles.join(' ')}]`).join(', ') : ' — the built-ins only'}`)
  lines.push(`  fonts: ${[...r.fonts.builtin.map((f) => `${f.family} (built-in)`), ...r.fonts.embedded.map((f) => `${f.family} (embedded)`)].join(', ') || 'none embedded'}`)
  if (r.fonts.missing.length) lines.push(`    not embedded (falls back where it is not installed): ${r.fonts.missing.map((f) => `${f.family} ×${f.uses}`).join(', ')}`)
  const h = (list) => list.slice(0, 6).map((x) => `${x.value} ×${x.count}`).join(', ') || '—'
  lines.push(`\n  unbound colours: ${h(r.unbound.colours)}`)
  lines.push(`  unbound font sizes: ${h(r.unbound.fontSizes)}`)
  lines.push(`  text left edges: ${h(r.unbound.leftMargins)}; right margins: ${h(r.unbound.rightMargins)}`)
  lines.push(`\n  slides (${r.slides.length}):`)
  for (const s of r.slides) lines.push(`    ${String(s.n).padStart(2)} ${s.id}${s.stateOf ? ` (state of ${s.stateOf})` : ''}${s.hidden ? ' (hidden)' : ''}  ${s.title ?? s.name ?? ''}`)
  return lines.join('\n')
}

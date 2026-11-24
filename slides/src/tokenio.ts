// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// A deck's design tokens as a design-tokens JSON file (the Design Tokens
// Community Group format Penpot, Tokens Studio and Figma read): the mapping
// table both ways, and the export. The import — a file from somewhere else,
// gated before it touches the deck — is tokenimport.ts; this half reads only
// the deck's own tokens and palette, so it stays importable by a plain node rig.
//
// THE SHAPE. One top-level group per mode, each holding the tokens nested by
// the dots in their names; every leaf `{ "$type", "$value" }`. A name that is
// also a group (`radius` beside `radius.md`) is the group's `$root` token, the
// DTCG spelling for it. The theme colours are a `theme` group of colour leaves
// (theme.background, theme.text, theme.accent1…) so a round trip restores them.
// What the DTCG types cannot say — a font size is a dimension, an opacity a
// number, `rgba(30,42,58,0.10)` exports as hex — rides in
// `$extensions["page.bento"]` on that leaf, and is believed on the way back
// only when it still agrees with `$value` (a file edited by hand keeps the edit).
//
// Nothing here is document content: no slide, no asset, no collab block. The
// root's `$description` names the deck and the Bento version.

import type { BentoDoc, ShadowSpec, TokenType, TokenValue } from './model.ts'
import { modesOf } from './tokens.ts'
import { PALETTE_SLOTS, paletteOf, slotIsSet, type PaletteSlot } from './palette.ts'
import { parseColor } from './editor/inspector/colorvalue.ts'

/** The vendor key in `$extensions` (DTCG asks for reverse-domain names). */
export const BENTO_EXT = 'page.bento'
/** Intake limits for a token file; the token and mode caps are restoregate's. */
export const TOKEN_FILE_LIMITS = { bytes: 1_000_000, tokens: 500, modes: 16, depth: 32 } as const

/** Bento type → DTCG `$type` on export. */
export const DTCG_TYPE: Record<TokenType, string> = {
  color: 'color', number: 'dimension', fontSize: 'dimension', opacity: 'number', fontFamily: 'fontFamily', shadow: 'shadow',
}

/** A file's `$type` → the Bento type it imports as. DTCG names, then the
 *  Tokens Studio / Penpot spellings. Anything else is listed as skipped. */
export const FILE_TYPE: Record<string, TokenType> = {
  color: 'color',
  dimension: 'number', spacing: 'number', sizing: 'number', borderRadius: 'number', borderWidth: 'number', letterSpacing: 'number', number: 'number',
  fontSize: 'fontSize', fontSizes: 'fontSize',
  opacity: 'opacity',
  fontFamily: 'fontFamily', fontFamilies: 'fontFamily',
  shadow: 'shadow', boxShadow: 'shadow',
}

/** The `theme` group's leaf names, per palette slot. */
export const THEME_GROUP = 'theme'
export const THEME_NAMES: Record<PaletteSlot, string> = {
  bg1: 'background', tx1: 'text', bg2: 'background2', tx2: 'text2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hlink: 'link', folHlink: 'followedLink',
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A colour as hex with alpha (`#rrggbbaa`); a hex stays as written, and a
 *  value that is neither hex nor rgb() is written as it is. */
function hexOf(c: string): string {
  if (/^#[0-9a-f]{3,8}$/i.test(c.trim())) return c.trim()
  if (!/^rgba?\(/i.test(c.trim())) return c
  const { hex, a } = parseColor(c)
  return a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex
}

/** A Bento token value as the DTCG `$value` of its type. */
export function dtcgValue(type: TokenType, v: TokenValue): unknown {
  if (type === 'color') return hexOf(String(v))
  if (type === 'number' || type === 'fontSize') return `${v}px`
  if (type === 'shadow') {
    const s = v as ShadowSpec
    return { offsetX: `${s.x ?? 0}px`, offsetY: `${s.y ?? 0}px`, blur: `${s.blur}px`, spread: '0px', color: hexOf(s.color) }
  }
  return v
}

/** Why a value is not one. A class, never a shape: a file's own
 *  `{ "error": … }` is a value, and must not pass for a refusal. */
export class Refusal {
  readonly error: string
  readonly detail?: string
  constructor(error: string, detail?: string) { this.error = error; this.detail = detail }
}
export const refuse = (error: string, detail?: string): Refusal => new Refusal(error, detail)
export const isRefusal = (v: unknown): v is Refusal => v instanceof Refusal

/** A length in px: a number, `"16"`, `"16px"`, or DTCG 2025's `{ value, unit }`. */
function px(v: unknown): number | Refusal {
  if (typeof v === 'number') return v
  if (isObj(v) && typeof v.value === 'number') return v.unit === undefined || v.unit === 'px' ? v.value : refuse('unit', String(v.unit).slice(0, 16))
  if (typeof v !== 'string') return refuse('value')
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v)
  if (!m) return refuse(/[{}*+/]/.test(v) ? 'expression' : 'value')
  if (m[2] && m[2] !== 'px') return refuse('unit', m[2].slice(0, 16))
  return Number(m[1])
}

/** A colour: a CSS colour string, or DTCG 2025's `{ colorSpace, components, alpha, hex }`. */
function colour(v: unknown): string | Refusal {
  if (typeof v === 'string') return /^\s*url\s*\(/i.test(v) ? refuse('value') : v.trim()
  if (!isObj(v)) return refuse('value')
  const a = typeof v.alpha === 'number' ? v.alpha : 1
  if (typeof v.hex === 'string' && /^#[0-9a-f]{6}$/i.test(v.hex)) return a < 1 ? v.hex + Math.round(Math.max(a, 0) * 255).toString(16).padStart(2, '0') : v.hex
  const c = v.components
  if (v.colorSpace === 'srgb' && Array.isArray(c) && c.length === 3 && c.every((n) => typeof n === 'number')) {
    const [r, g, b] = (c as number[]).map((n) => Math.round(Math.min(Math.max(n, 0), 1) * 255))
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`
  }
  return typeof v.colorSpace === 'string' ? refuse('colorSpace', v.colorSpace.slice(0, 32)) : refuse('value')
}

/** A font stack: a string, or a DTCG list of family names. */
function fontStack(v: unknown): string | Refusal {
  if (typeof v === 'string') return v.trim()
  if (!Array.isArray(v) || !v.length || !v.every((f) => typeof f === 'string' && f.trim())) return refuse('value')
  return (v as string[]).map((f) => (/^[\w-]+$/.test(f.trim()) ? f.trim() : `'${f.trim()}'`)).join(', ')
}

/** A DTCG `$value` as the Bento value of `type`, or why it cannot be one.
 *  Shape only: whether the value is SAFE is the gate's (tokenimport.ts). */
export function fromDtcg(type: TokenType, v: unknown): TokenValue | Refusal {
  if (type === 'color') return colour(v)
  if (type === 'number' || type === 'fontSize') return px(v)
  if (type === 'opacity') {
    if (typeof v === 'number') return v
    const m = typeof v === 'string' ? /^\s*(\d*\.?\d+)\s*(%?)\s*$/.exec(v) : null
    return m ? Number(m[1]) / (m[2] ? 100 : 1) : refuse(typeof v === 'string' && /[{}*+/]/.test(v) ? 'expression' : 'value')
  }
  if (type === 'fontFamily') return fontStack(v)
  // shadow: one layer, outer, no spread — what a Bento shadow is
  let s = v
  if (Array.isArray(s)) { if (s.length !== 1) return refuse('layers'); s = s[0] }
  if (!isObj(s)) return refuse('value')
  if (!['offsetX', 'offsetY', 'x', 'y', 'blur', 'color'].some((k) => Object.hasOwn(s as object, k))) return refuse('value')
  if (s.inset === true || s.type === 'innerShadow') return refuse('inset')
  const x = px(s.offsetX ?? s.x ?? 0), y = px(s.offsetY ?? s.y ?? 0), blur = px(s.blur ?? 0), spread = px(s.spread ?? 0)
  const color = colour(s.color ?? '#000000')
  for (const part of [x, y, blur, spread, color]) if (isRefusal(part)) return part
  if (spread !== 0) return refuse('spread')
  return { x: x as number, y: y as number, blur: blur as number, color: color as string }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One token's leaf: `$type`, `$value`, and the extension only when the DTCG
 *  pair alone would not bring the same Bento token back. */
export function tokenLeaf(type: TokenType, v: TokenValue): Record<string, unknown> {
  const $value = dtcgValue(type, v)
  const leaf: Record<string, unknown> = { $type: DTCG_TYPE[type], $value }
  const ext: Record<string, unknown> = {}
  if (FILE_TYPE[DTCG_TYPE[type]] !== type) ext.type = type
  if (!same(fromDtcg(type, $value), v)) ext.value = v
  if (Object.keys(ext).length) leaf.$extensions = { [BENTO_EXT]: ext }
  return leaf
}

/** The key a mode's group is written under: its name, unless that would read
 *  as the theme group or a DTCG `$` key. */
function modeKeys(modes: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of modes) {
    let k = m === THEME_GROUP || m.startsWith('$') ? `mode-${m.replace(/^\$+/, '')}` : m
    while (Object.hasOwn(out, k) || (k !== m && modes.includes(k))) k += '-'
    out[k] = m
  }
  return out
}

/** Put `leaf` at `path` in `group`, a name that is also a group becoming its `$root`. */
function place(group: Record<string, unknown>, path: string[], leaf: Record<string, unknown>) {
  let g = group
  for (const seg of path.slice(0, -1)) {
    const at = g[seg]
    if (!isObj(at)) g[seg] = {}
    else if ('$value' in at) g[seg] = { $root: at }
    g = g[seg] as Record<string, unknown>
  }
  const last = path[path.length - 1]
  if (isObj(g[last]) && !('$value' in (g[last] as object))) (g[last] as Record<string, unknown>).$root = leaf
  else g[last] = leaf
}

/**
 * The deck's tokens and theme colours as a design-tokens file. `version` is
 * the shell's (update.ts APP_VERSION), passed in so this stays DOM-free.
 */
export function exportTokens(doc: BentoDoc, version: string): Record<string, unknown> {
  const tk = doc.theme.tokens
  const modes = modesOf(tk)
  const keys = modeKeys(modes)
  const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title.trim() : 'Untitled'
  const out: Record<string, unknown> = {
    $description: `Design tokens of “${title}”, exported by Bento Slides ${version}`,
    $extensions: { [BENTO_EXT]: { modes: keys } },
  }
  for (const [key, m] of Object.entries(keys)) {
    const group: Record<string, unknown> = {}
    for (const [name, tok] of Object.entries(tk?.set ?? {})) {
      if (Object.hasOwn(tok.values, m)) place(group, name.split('.'), tokenLeaf(tok.type, tok.values[m]))
    }
    out[key] = group
  }
  const palette = paletteOf(doc)
  const theme: Record<string, unknown> = {}
  for (const slot of PALETTE_SLOTS) if (palette[slot] && slotIsSet(doc, slot)) theme[THEME_NAMES[slot]] = tokenLeaf('color', palette[slot]!)
  out[THEME_GROUP] = theme
  return out
}

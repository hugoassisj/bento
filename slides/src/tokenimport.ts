// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Importing a design-tokens JSON file (Penpot, Tokens Studio, Figma, or a
// Bento export — tokenio.ts has the shape and the type table) into a deck,
// in two steps: planImport reads the file and says, token by token, what would
// happen (new / changed / unchanged / skipped and why); applyImport writes only
// what the person ticked, inside the caller's one store.commit.
//
// THE FILE IS UNTRUSTED INPUT. It is parsed, never evaluated; a URL in it is
// never fetched; and every value that would reach the deck passes the SAME rule
// a token meets when a file opens (restoregate.ts tokens(), reused as
// gateTokens — not a second validator). The theme colours meet that rule as
// colour tokens, and the background the slide-background rule besides. Limits:
// 1 MB of JSON, 500 tokens in the deck, 16 modes, 32 levels of nesting.
//
// What it never does: change a token's type (a binding would stop fitting and
// be dropped on the next edit), delete or rename a token, touch a binding.
// Existing bindings follow the token names they already follow.
//
// Aliases (`{group.name}`) resolve to the literal they point at, inside the
// file; the plan counts them. Keeping them is DS-12's.
//
// Deliberately DOM-free, so the node rig runs it.

import type { BentoDoc, TokenType, TokenValue } from './model'
import { TOKEN_TYPES, activeMode, modesOf, protoName, tokenName } from './tokens'
import { PALETTE_SLOTS, paletteOf, type PaletteSlot } from './palette'
import { SLIDE_CHECKS, type Dropped } from './untrusted'
import { tokens as gateTokens } from './restoregate'
import { BENTO_EXT, FILE_TYPE, THEME_GROUP, THEME_NAMES, TOKEN_FILE_LIMITS, fromDtcg, isRefusal, tokenLeaf, type Refusal } from './tokenio'

/** Why a row is skipped: a code the review turns into words, and its detail. */
export type Reason =
  | 'type' | 'value' | 'unit' | 'expression' | 'colorSpace' | 'layers' | 'inset' | 'spread'
  | 'name' | 'proto' | 'kind' | 'alias' | 'loop' | 'modes' | 'depth' | 'notToken' | 'unsafe'

export interface ImportRow {
  /** the name it lands as in the deck ('' when there is none) */
  name: string
  /** where it is in the file: the group path, behind its set */
  source: string
  type?: TokenType
  status: 'new' | 'changed' | 'unchanged' | 'skipped'
  /** per mode it writes */
  values: Record<string, TokenValue>
  /** the deck's values in those modes, for a changed row */
  old?: Record<string, TokenValue>
  reason?: Reason
  detail?: string
  /** aliases flattened into this row's values */
  aliases: number
}

export interface ImportPlan {
  /** the whole file was refused: 'size' | 'json' | 'empty' */
  error?: 'size' | 'json' | 'empty'
  rows: ImportRow[]
  /** theme colours the file carries, gated; applied only when asked */
  theme: Array<{ slot: PaletteSlot; value: string; old?: string }>
  /** tokens past the deck's limit of 500, counted not listed */
  overLimit: number
  aliases: number
  /** the top level reads as sets, so "each set is a mode" is offered */
  setsLike: boolean
  eachSetIsMode: boolean
  /** the modes the rows write, in file order */
  modes: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: unknown, k: string) => isObj(o) && Object.hasOwn(o, k)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A token in a file: `$value`, or the older Tokens Studio `value` + `type`. */
const isLeaf = (o: unknown): o is Obj => isObj(o) && (own(o, '$value') || (own(o, 'value') && typeof o.type === 'string'))
const leafValue = (o: Obj) => (own(o, '$value') ? o.$value : o.value)
const leafType = (o: Obj): string | undefined => (typeof o.$type === 'string' ? o.$type : typeof o.type === 'string' ? o.type : undefined)
const bentoExt = (o: Obj): Obj => (isObj(o.$extensions) && isObj(o.$extensions[BENTO_EXT]) ? o.$extensions[BENTO_EXT] as Obj : {})

interface Leaf { set: string; path: string[]; node: Obj; inherited?: string }

/** Every token under `node`, with the `$type` its groups hand down. */
function walk(node: Obj, set: string, path: string[], inherited: string | undefined, depth: number, out: Leaf[], bad: ImportRow[], skip?: string) {
  if (depth > TOKEN_FILE_LIMITS.depth) { bad.push(skipped(set, path, 'depth')); return }
  for (const [k, v] of Object.entries(node)) {
    if (k === skip) continue
    if (k === '$root' && isLeaf(v)) out.push({ set, path, node: v, inherited })
    else if (k.startsWith('$')) continue
    else if (isLeaf(v)) out.push({ set, path: [...path, k], node: v, inherited })
    else if (isObj(v)) walk(v, set, [...path, k], typeof v.$type === 'string' ? v.$type : inherited, depth + 1, out, bad)
    else bad.push(skipped(set, [...path, k], 'notToken'))
  }
}

const sourceOf = (set: string, path: string[]) => (set ? `${set} / ` : '') + path.join('.')
function skipped(set: string, path: string[], reason: Reason, detail?: string, name = ''): ImportRow {
  return { name, source: sourceOf(set, path), status: 'skipped', values: {}, reason, detail, aliases: 0 }
}

/** A group path as a token name: `[\w.-]`, a letter first, 64 at most. */
function nameOf(path: string[]): string | Refusal {
  if (path.some((s) => s === '__proto__') || protoName(path.join('.'))) return { error: 'proto' }
  let n = path.map((s) => s.replace(/[^\w-]/g, '-')).join('.')
  if (!/^[A-Za-z]/.test(n)) n = `t${n}`
  n = n.slice(0, 64)
  return tokenName(`$${n}`) ? n : { error: protoName(n) ? 'proto' : 'name' }
}

const modeNameOk = (m: string) => m.length > 0 && m.length <= 64 && m !== '+' && !protoName(m)

/** Infer a type from a value when the file names none. */
function shapeType(v: unknown): string | undefined {
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return /^\s*(#|rgba?\(|hsla?\()/i.test(v) ? 'color' : /^\s*-?[\d.]+px\s*$/.test(v) ? 'dimension' : undefined
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? 'fontFamily' : v.every(isObj) ? 'shadow' : undefined
  if (isObj(v)) return 'colorSpace' in v ? 'color' : 'blur' in v || 'offsetX' in v ? 'shadow' : undefined
  return undefined
}

/** Read a file into its root object, or say why not. */
export function readTokenFile(text: string): Obj | 'size' | 'json' {
  if (text.length > TOKEN_FILE_LIMITS.bytes || new TextEncoder().encode(text).length > TOKEN_FILE_LIMITS.bytes) return 'size'
  try {
    const v = JSON.parse(text)
    return isObj(v) ? v : 'json'
  } catch { return 'json' }
}

/** The palette group in a file: `theme`, holding colour leaves named as Bento names them. */
function paletteShaped(g: unknown): boolean {
  if (!isObj(g)) return false
  const names = new Set(Object.values(THEME_NAMES))
  const keys = Object.keys(g).filter((k) => !k.startsWith('$'))
  return keys.length > 0 && keys.every((k) => names.has(k) && isLeaf(g[k]))
}

/**
 * What importing `text` into `doc` would do. `eachSetIsMode` picks how a
 * file of sets lands (undefined = the default for this file).
 */
export function planImport(doc: BentoDoc, text: string, opts: { eachSetIsMode?: boolean } = {}): ImportPlan {
  const plan: ImportPlan = { rows: [], theme: [], overLimit: 0, aliases: 0, setsLike: false, eachSetIsMode: false, modes: [] }
  const root = readTokenFile(text)
  if (typeof root === 'string') return { ...plan, error: root }
  const tk = doc.theme.tokens

  // --- the top level: sets (modes), or one tree of groups
  const ext = bentoExt(root)
  const extModes = isObj(ext.modes)
    ? new Map(Object.entries(ext.modes).filter(([k, m]) => typeof m === 'string' && modeNameOk(m) && isObj(root[k])) as Array<[string, string]>)
    : null
  const top = Object.keys(root).filter((k) => !k.startsWith('$'))
  const themeKey = top.includes(THEME_GROUP) && (extModes ? !extModes.has(THEME_GROUP) : paletteShaped(root[THEME_GROUP])) ? THEME_GROUP : undefined
  let sets = top.filter((k) => k !== themeKey)
  const order = isObj(root.$metadata) && Array.isArray(root.$metadata.tokenSetOrder) ? root.$metadata.tokenSetOrder.filter((s) => typeof s === 'string') as string[] : []
  if (order.length) sets = [...order.filter((s) => sets.includes(s)), ...sets.filter((s) => !order.includes(s))]
  const groupsOnly = sets.length > 0 && sets.every((k) => isObj(root[k]) && !isLeaf(root[k]))
  const leavesOf = (k: string) => { const out: Leaf[] = []; walk(root[k] as Obj, k, [], undefined, 1, out, []); return out.map((l) => l.path.join('.')).sort().join('\n') }
  const sameShape = groupsOnly && sets.length >= 2 && sets.every((k) => leavesOf(k) === leavesOf(sets[0]))
  plan.setsLike = !!extModes || (groupsOnly && (own(root, '$themes') || own(root, '$metadata') || sameShape))
  plan.eachSetIsMode = plan.setsLike && (opts.eachSetIsMode ?? (!!extModes || sameShape))
  if (extModes) sets = sets.filter((k) => extModes.has(k))

  const leaves: Leaf[] = []
  const bad: ImportRow[] = []
  if (plan.setsLike) for (const k of sets) walk(root[k] as Obj, k, [], typeof (root[k] as Obj).$type === 'string' ? (root[k] as Obj).$type as string : undefined, 1, leaves, bad)
  else walk(root, '', [], undefined, 0, leaves, bad, themeKey)

  // --- aliases: the file's own tokens by their dotted path, per set
  const index = new Map<string, Map<string, Leaf>>()
  for (const l of leaves) {
    if (!index.has(l.set)) index.set(l.set, new Map())
    index.get(l.set)!.set(l.path.join('.'), l)
  }
  const setOrder = [...index.keys()]
  const lookup = (ref: string, set: string): Leaf | undefined => {
    const here = index.get(set)?.get(ref)
    if (here) return here
    for (let i = setOrder.length - 1; i >= 0; i--) { const l = index.get(setOrder[i])!.get(ref); if (l) return l }
    return undefined
  }
  /** `v` with every alias in it replaced by what it names; the first alias's type rides along. */
  const resolve = (v: unknown, set: string, seen: string[], n: { aliases: number; type?: string }): unknown => {
    if (typeof v === 'string') {
      const m = /^\s*\{([^{}]+)\}\s*$/.exec(v)
      if (!m) return v.includes('{') ? { error: 'expression' } : v
      const ref = m[1].trim()
      const key = `${set}\u0000${ref}`
      if (seen.includes(key) || seen.length >= 16) return { error: 'loop', detail: ref }
      const target = lookup(ref, set)
      if (!target) return { error: 'alias', detail: ref }
      n.aliases++
      n.type ??= leafType(target.node) ?? target.inherited
      return resolve(leafValue(target.node), target.set, [...seen, key], n)
    }
    if (Array.isArray(v)) {
      const out = v.map((x) => resolve(x, set, seen, n))
      return out.find(isRefusal) ?? out
    }
    if (isObj(v) && !isRefusal(v)) {
      const out: Obj = {}
      for (const [k, x] of Object.entries(v)) {
        if (k === '__proto__') continue
        const r = resolve(x, set, seen, n)
        if (isRefusal(r)) return r
        out[k] = r
      }
      return out
    }
    return v
  }

  /** One leaf as a gated Bento token value of a known type, or why not. */
  const valueOf = (l: Leaf): { type: TokenType; value: TokenValue; aliases: number } | Refusal => {
    const n: { aliases: number; type?: string } = { aliases: 0 }
    const raw = leafValue(l.node)
    const resolved = resolve(raw, l.set, [], n)
    if (isRefusal(resolved)) return resolved
    const bext = bentoExt(l.node)
    const fileType = leafType(l.node) ?? l.inherited ?? n.type ?? shapeType(resolved)
    const type = TOKEN_TYPES.includes(bext.type as TokenType) ? bext.type as TokenType : fileType ? FILE_TYPE[fileType] : undefined
    if (!type) return { error: 'type', detail: fileType ?? '?' }
    // the extension's exact value, while it still agrees with `$value`
    let value: TokenValue | Refusal | undefined
    if (bext.value !== undefined && !n.aliases) {
      try { if (same(tokenLeaf(type, bext.value as TokenValue).$value, raw)) value = bext.value as TokenValue } catch { /* not a value of that type */ }
    }
    value ??= fromDtcg(type, resolved)
    if (isRefusal(value)) return value
    return { type, value, aliases: n.aliases }
  }
  /** The deck's own gate on one value: the gated value, or undefined. */
  const gate = (name: string, type: TokenType, mode: string, v: TokenValue): TokenValue | undefined => {
    const dropped: Dropped[] = []
    return gateTokens({ set: { [name]: { type, values: { [mode]: v } } } }, dropped)?.set[name]?.values[mode]
  }

  // --- modes: the active one, or one per set (16 at most in the deck)
  const deckModes = modesOf(tk)
  const deckEmpty = !tk || (!Object.keys(tk.set ?? {}).length && !tk.modes?.length)
  const modeOf = new Map<string, string | null>()
  const fresh: string[] = []
  for (const k of setOrder) {
    if (!plan.eachSetIsMode) { modeOf.set(k, activeMode(tk)); continue }
    const m = extModes?.get(k) ?? k
    if (!modeNameOk(m)) { modeOf.set(k, null); continue }
    if (!deckEmpty && !deckModes.includes(m) && !fresh.includes(m)) {
      if (deckModes.length + fresh.length >= TOKEN_FILE_LIMITS.modes) { modeOf.set(k, null); continue }
      fresh.push(m)
    }
    if (deckEmpty && !fresh.includes(m)) { if (fresh.length >= TOKEN_FILE_LIMITS.modes) { modeOf.set(k, null); continue } fresh.push(m) }
    modeOf.set(k, m)
  }

  // --- rows: one per deck name; refusals one per leaf
  const rows = new Map<string, ImportRow>()
  const claimed = new Map<string, string>() // deck name → the file path that took it
  const existing = (name: string) => (own(tk?.set, name) ? tk!.set[name] : undefined)
  const capacity = TOKEN_FILE_LIMITS.tokens - Object.keys(tk?.set ?? {}).length
  let added = 0
  for (const l of leaves) {
    const mode = modeOf.get(l.set)
    if (mode === null) { bad.push(skipped(l.set, l.path, 'modes')); continue }
    let name = nameOf(l.path)
    if (isRefusal(name)) { bad.push(skipped(l.set, l.path, name.error as Reason)); continue }
    // a different path that sanitised to the same name gets a suffix
    const path = l.path.join('.')
    for (let i = 2, base = name; claimed.has(name) && claimed.get(name) !== path; i++) name = `${base.slice(0, 60)}-${i}`
    claimed.set(name, path)
    const ex = existing(name)
    if (!ex && !rows.has(name) && added >= capacity) { plan.overLimit++; continue }
    const v = valueOf(l)
    if (isRefusal(v)) { bad.push(skipped(l.set, l.path, v.error as Reason, v.detail, name)); continue }
    if (ex && ex.type !== v.type) { bad.push(skipped(l.set, l.path, 'kind', ex.type, name)); continue }
    const prior = rows.get(name)
    if (prior && prior.type !== v.type) { bad.push(skipped(l.set, l.path, 'kind', prior.type, name)); continue }
    const safe = gate(name, v.type, mode!, v.value)
    if (safe === undefined) { bad.push(skipped(l.set, l.path, 'unsafe', undefined, name)); continue }
    const row = prior ?? { name, source: sourceOf(plan.eachSetIsMode ? '' : l.set, l.path), type: v.type, status: 'new' as const, values: {}, aliases: 0 }
    if (!prior) { rows.set(name, row); if (!ex) added++ }
    row.values[mode!] = safe
    row.aliases += v.aliases
  }
  for (const row of rows.values()) {
    const ex = existing(row.name)
    if (!ex) continue
    row.old = Object.fromEntries(Object.keys(row.values).filter((m) => Object.hasOwn(ex.values, m)).map((m) => [m, ex.values[m]]))
    row.status = Object.entries(row.values).some(([m, v]) => !Object.hasOwn(ex.values, m) || !same(ex.values[m], v)) ? 'changed' : 'unchanged'
  }
  plan.rows = [...rows.values(), ...bad]
  plan.aliases = [...rows.values()].reduce((s, r) => s + r.aliases, 0)
  plan.modes = plan.eachSetIsMode ? [...new Set([...modeOf.values()].filter((m): m is string => !!m))] : [activeMode(tk)]

  // --- the theme colours, gated as colour tokens (and the background as a slide background)
  if (themeKey) {
    const palette = paletteOf(doc)
    const slotOf = new Map(PALETTE_SLOTS.map((s) => [THEME_NAMES[s], s]))
    for (const [k, node] of Object.entries(root[themeKey] as Obj)) {
      if (k.startsWith('$')) continue
      const slot = slotOf.get(k)
      if (!slot || !isLeaf(node)) { plan.rows.push(skipped(THEME_GROUP, [k], 'name')); continue }
      const v = valueOf({ set: themeKey, path: [k], node, inherited: 'color' })
      if (isRefusal(v)) { plan.rows.push(skipped(THEME_GROUP, [k], v.error as Reason, v.detail)); continue }
      const safe = v.type === 'color' ? gate('theme', 'color', 'default', v.value) : undefined
      if (typeof safe !== 'string' || (slot === 'bg1' && SLIDE_CHECKS.background(safe) === undefined)) { plan.rows.push(skipped(THEME_GROUP, [k], 'unsafe')); continue }
      plan.aliases += v.aliases
      plan.theme.push({ slot, value: safe, old: palette[slot] })
    }
  }
  if (!plan.rows.length && !plan.theme.length && !plan.overLimit) plan.error = 'empty'
  return plan
}

/**
 * Write the ticked rows (by deck name) and, with `withTheme`, the theme
 * colours. Call inside one store.commit: it is one undo step. Returns how many
 * tokens it wrote.
 */
export function applyImport(doc: BentoDoc, plan: ImportPlan, ticked: ReadonlySet<string>, withTheme = false): number {
  const rows = plan.rows.filter((r) => (r.status === 'new' || r.status === 'changed') && ticked.has(r.name) && r.type)
  if (rows.length) {
    const tk = (doc.theme.tokens ??= { set: {} })
    if (plan.eachSetIsMode) {
      const used = plan.modes.filter((m) => rows.some((r) => Object.hasOwn(r.values, m)))
      const empty = !Object.keys(tk.set).length && !tk.modes?.length
      if (empty) { if (!(used.length === 1 && used[0] === 'default')) tk.modes = used }
      else {
        const missing = used.filter((m) => !modesOf(tk).includes(m))
        if (missing.length) tk.modes = [...modesOf(tk), ...missing]
      }
    }
    for (const r of rows) {
      if (Object.hasOwn(tk.set, r.name)) { if (tk.set[r.name].type === r.type) Object.assign(tk.set[r.name].values, r.values) }
      else tk.set[r.name] = { type: r.type!, values: { ...r.values } }
    }
  }
  if (withTheme) {
    const th = doc.theme
    for (const { slot, value } of plan.theme) {
      if (slot === 'bg1') th.background = value
      else if (slot === 'tx1') th.color = value
      else if (slot === 'accent1') th.accent = value
      else (th.palette ??= {})[slot as 'accent2'] = value
    }
  }
  return rows.length
}

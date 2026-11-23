// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Switching a chart's type: what the inspector's Type control writes.
//
// A chart the user has filled in is CONVERTED, never replaced: bar ⇄ line
// retypes every series in place; pie takes the categories and the first
// series; scatter pairs two series as x and y. Only a chart that is still a
// type's untouched sample switches to the target type's sample. Pure: JSON in,
// JSON out, no DOM, the input never mutated. The keys each type may carry come
// from validate.ts, so a conversion can never leave a key validate() reports
// as chart-key-ignored.
import { type BentoDoc, applyChartPalette } from './model'
import { CHART_PRESETS } from './charts'
import { CHART_KEYS } from './validate'

type Opt = Record<string, any>

/** Something the switch could not carry over, for the inspector to say. */
export type ChartSwitchNote = { kind: 'pie'; series: string } | { kind: 'scatter' }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const list = (v: unknown): any[] => (Array.isArray(v) ? v : v ? [v] : [])
const isObj = (v: unknown): v is Opt => !!v && typeof v === 'object' && !Array.isArray(v)
const canon = (v: unknown) => JSON.stringify(v, (_k, x) =>
  isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)
/** a plain number from a datum: `12`, `"12"` or `{ value: 12 }` */
const num = (v: unknown): number => {
  const x = isObj(v) ? v.value : v
  const n = typeof x === 'number' ? x : typeof x === 'string' ? parseFloat(x) : NaN
  return Number.isFinite(n) ? n : 0
}
const omit = (o: unknown, keys: string[]): Opt =>
  Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k]) => !keys.includes(k)))
const isCategory = (k: string) => k === 'bar' || k === 'line'

/** What a chart option draws as: the type the Type control should show. */
export function chartKind(option: Opt): string {
  const ss = list(option?.series)
  if (ss.some((s) => s?.type === 'pie')) return 'pie'
  if (ss.some((s) => s?.type === 'scatter')) return 'scatter'
  if (ss.length && ss.every((s) => s?.type === 'line')) return 'line'
  return 'bar'
}

/** Still one of the presets' samples, colours aside: a palette baked before
 *  a theme change does not make a sample the user's data. */
export function isUntouchedSample(option: Opt): boolean {
  const key = canon(omit(option, ['color']))
  return Object.values(CHART_PRESETS).some((make) => canon(omit(make(), ['color'])) === key)
}

/** The target preset's per-series look that is not data (`smooth` on a line,
 *  `symbolSize` on scatter, `radius`/`label` on pie). Several translucent
 *  areas would hide each other, so `areaStyle` only comes with one series. */
function seriesDefaults(to: string, many: boolean): Opt {
  const first = list(CHART_PRESETS[to]?.().series)[0]
  const skip = ['type', 'name', 'data', 'itemStyle', 'lineStyle', ...(many ? ['areaStyle'] : [])]
  return omit(first, skip)
}

/** One series as type `to`: its colour moves to where that type reads it,
 *  keys only its old type understood go, the new type's defaults come in.
 *  A series already of type `to` is returned as it is. */
function retype(s: Opt, to: string, many: boolean): Opt {
  const from = typeof s.type === 'string' ? s.type : 'bar'
  if (from === to) return s
  const out: Opt = { ...s, type: to }
  // a line draws in lineStyle.color; bar, scatter and the legend read itemStyle.color
  if (to === 'line' && out.itemStyle?.color !== undefined && out.lineStyle?.color === undefined) {
    out.lineStyle = { ...(isObj(out.lineStyle) ? out.lineStyle : {}), color: out.itemStyle.color }
    const rest = omit(out.itemStyle, ['color'])
    if (Object.keys(rest).length) out.itemStyle = rest
    else delete out.itemStyle
  } else if (from === 'line' && out.lineStyle?.color !== undefined && out.itemStyle?.color === undefined) {
    out.itemStyle = { ...(isObj(out.itemStyle) ? out.itemStyle : {}), color: out.lineStyle.color }
  }
  const allowed = [...CHART_KEYS.series, ...(CHART_KEYS.seriesByType[to] ?? [])]
  for (const k of CHART_KEYS.seriesByType[from] ?? []) if (!allowed.includes(k)) delete out[k]
  for (const [k, v] of Object.entries(seriesDefaults(to, many))) if (!(k in out)) out[k] = clone(v)
  return out
}

/** The chart as categories × series of plain numbers, whatever it draws as. */
function tableOf(o: Opt, from: string): { cats: string[]; rows: Array<{ base: Opt; data: number[] }> } {
  const ss = list(o.series).filter(isObj)
  if (from === 'pie') {
    const p = ss.find((s) => s.type === 'pie') ?? {}
    const slices = list(p.data)
    return {
      cats: slices.map((d, i) => String(isObj(d) && d.name !== undefined ? d.name : i + 1)),
      rows: [{ base: p, data: slices.map(num) }],
    }
  }
  if (from === 'scatter') {
    const n = Math.max(0, ...ss.map((s) => list(s.data).length))
    return {
      cats: Array.from({ length: n }, (_, i) => String(i + 1)),
      rows: ss.map((s) => ({ base: s, data: list(s.data).map((d) => (Array.isArray(d) ? num(d[1]) : num(d))) })),
    }
  }
  const cats = list(list(o.xAxis)[0]?.data)
  const rows = ss.map((s) => ({ base: s, data: list(s.data).map(num) }))
  const n = Math.max(cats.length, ...rows.map((r) => r.data.length))
  return { cats: Array.from({ length: n }, (_, i) => String(cats[i] ?? i + 1)), rows }
}

/**
 * Convert a chart option from type `from` to type `to`, keeping its data.
 * Returns a new option; `note` says what the target type cannot show.
 */
export function convertChart(option: Opt, from: string, to: string): { option: Opt; note?: ChartSwitchNote } {
  const out = clone(option)
  if (from === to || !CHART_PRESETS[to]) return { option: out }

  // bar ⇄ line: the same axes, so every series just changes type
  if (isCategory(from) && isCategory(to)) {
    const ss = list(out.series)
    out.series = ss.map((s) => (isObj(s) ? retype(s, to, ss.length > 1) : s))
    return { option: out }
  }

  const preset = CHART_PRESETS[to]() as Opt
  const { cats, rows } = tableOf(out, from)
  const many = rows.length > 1
  let note: ChartSwitchNote | undefined
  if (from === 'scatter' || to === 'scatter') {
    if (cats.length || rows.some((r) => r.data.length)) note = { kind: 'scatter' }
  } else if (to === 'pie' && many) {
    note = { kind: 'pie', series: String(rows[0].base.name ?? '') }
  }
  const tooltip = (trigger: string) => ({ ...(isObj(out.tooltip) ? out.tooltip : {}), trigger })
  const keep = (key: string) => { if (out[key] === undefined && preset[key] !== undefined) out[key] = preset[key] }

  if (to === 'pie') {
    const first = rows[0] ?? { base: {}, data: [] }
    const s = retype(omit(first.base, ['data', 'yAxisIndex']), 'pie', false)
    const n = Math.max(cats.length, first.data.length)
    s.data = Array.from({ length: n }, (_, i) => ({ name: cats[i] ?? String(i + 1), value: first.data[i] ?? 0 }))
    out.series = [s]
    delete out.xAxis
    delete out.yAxis
    delete out.dataZoom
    out.tooltip = tooltip('item')
    return { option: out, note }
  }

  if (to === 'scatter') {
    const [a, b] = rows
    const data = b
      ? Array.from({ length: Math.max(a.data.length, b.data.length) }, (_, i) => [a.data[i] ?? 0, b.data[i] ?? 0])
      : a ? a.data.map((v, i) => [i + 1, v]) : []
    const s = retype(omit(a?.base, ['data', 'yAxisIndex']), 'scatter', false)
    s.data = data
    out.series = [s]
    const x = list(out.xAxis)[0], y = list(out.yAxis)[0]
    out.xAxis = x ? { ...omit(x, ['data', 'type']), type: 'value' } : preset.xAxis
    out.yAxis = y ? { ...omit(y, ['data', 'type']), type: 'value' } : preset.yAxis
    keep('grid')
    keep('dataZoom')
    out.tooltip = tooltip('item')
    return { option: out, note }
  }

  // pie or scatter → bar or line: categories on fresh axes
  const x = list(out.xAxis)[0]
  out.xAxis = { ...omit(x ?? preset.xAxis, ['data', 'type', 'min', 'max']), type: 'category', data: cats }
  if (!list(out.yAxis).length) out.yAxis = preset.yAxis
  keep('grid')
  keep('dataZoom')
  out.tooltip = tooltip('axis')
  out.series = rows.map((r) => {
    const s = retype(omit(r.base, ['data']), to, many)
    s.data = r.data
    return s
  })
  return { option: out, note }
}

/**
 * The option a chart gets when its type is switched to `to` — the one entry
 * point the inspector's Type control uses. An untouched sample becomes the
 * target type's sample (in the chart's own colours, or the deck's); anything
 * else is converted with its data kept.
 */
export function switchChartType(
  option: Opt, to: string, theme: BentoDoc['theme'],
): { option: Opt; note?: ChartSwitchNote } {
  if (CHART_PRESETS[to] && isUntouchedSample(option)) {
    const seeded = CHART_PRESETS[to]() as Opt
    if (Array.isArray(option.color) && option.color.length) seeded.color = clone(option.color)
    return { option: applyChartPalette(seeded, theme) }
  }
  return convertChart(option, chartKind(option), to)
}

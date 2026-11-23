#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Switching a chart's type keeps its data.
//
// BUNDLED, not run directly — model.ts and the charts facade import
// extensionless — and run from the repo root (it reads chartconvert.ts):
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-chart-convert.ts --bundle \
//     --platform=node --format=esm --outfile="$TMPDIR/test-slides-chart-convert.mjs" \
//     && node "$TMPDIR/test-slides-chart-convert.mjs"
//
// WHAT THIS PROVES. The inspector's Type control calls switchChartType and
// writes what it returns, so every row here goes through that one entry point.
// Before this rig the control replaced the option with the target type's
// sample ("Trend, Jan–Jun"), throwing away the user's series.
//   1. bar ⇄ line converts in place: names, values, order and colours of
//      every series survive a round trip exactly.
//   2. bar/line → pie keeps the categories and the first series (and says
//      which series the pie shows when there were more); pie → bar/line
//      gives them back on fresh axes.
//   3. scatter pairs series 0 (x) with series 1 (y), or index with value;
//      from scatter the y values come back over categories 1…n. Both say
//      the data was simplified.
//   4. A chart that is still a type's untouched sample switches to the
//      target type's sample, as before.
//   5. No conversion introduces a key validate() reports as chart-key-ignored,
//      the input option is never mutated, and the helper touches no DOM.
//   6. A table-linked chart converted to any category type still takes the
//      table's next values through syncLinkedChart.

import { readFileSync } from 'node:fs'
import { switchChartType } from '../slides/src/chartconvert.ts'
import { CHART_PRESETS } from '../slides/src/charts.ts'
import { applyChartPalette, defaultChart, defaultTable, newDoc, syncLinkedChart, type BentoDoc } from '../slides/src/model.ts'
import { validateDoc } from '../slides/src/validate.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

type Opt = Record<string, any>
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
/** key-order-insensitive JSON, so "identical" means the same data */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)
const same = (a: unknown, b: unknown) => canon(a) === canon(b)

const theme: BentoDoc['theme'] = newDoc().theme
const KINDS = Object.keys(CHART_PRESETS)
const sample = (k: string) => applyChartPalette(CHART_PRESETS[k](), theme) as Opt
const sw = (o: Opt, to: string) => {
  const before = canon(o)
  const r = switchChartType(o, to, theme)
  ok(canon(o) === before, `  ${to}: the input option is not mutated`)
  return r as { option: Opt; note?: any }
}
const series = (o: Opt): Opt[] => Array.isArray(o.series) ? o.series : o.series ? [o.series] : []
const ignoredKeys = (o: Opt): string[] => {
  const doc = newDoc()
  doc.slides[0].elements.push(defaultChart(o))
  return validateDoc(doc, { measure: false }).findings
    .filter((f) => f.code === 'chart-key-ignored').map((f) => f.path ?? '?')
}

// A bar chart the user has filled in: five named series, real values, one
// series recoloured from the panel (bar colour = itemStyle.color).
function userBar(): Opt {
  const o = sample('bar')
  o.xAxis.data = ['Q1', 'Q2', 'Q3', 'Q4']
  o.series = ['North', 'South', 'East', 'West', 'Online'].map((name, i) => ({
    type: 'bar', name, data: [101 + i, 201 + i, 301 + i, 401 + i],
  }))
  o.series[2].itemStyle = { color: '#123456' }
  return o
}

// ---------------------------------------------------------------- 1. bar ⇄ line
console.log('bar ⇄ line')
{
  const start = userBar()
  const line = sw(start, 'line')
  const ls = series(line.option)
  ok(ls.length === 5 && ls.every((s) => s.type === 'line'), `bar → line: five line series (got ${ls.length}: ${ls.map((s) => s.type).join(',')})`)
  ok(same(ls.map((s) => [s.name, s.data]), start.series.map((s: Opt) => [s.name, s.data])),
    `bar → line: names, values and order kept (got ${JSON.stringify(ls.map((s) => s.name))})`)
  ok(ls[2]?.lineStyle?.color === '#123456', `bar → line: the recoloured series draws its line in its colour (lineStyle.color ${ls[2]?.lineStyle?.color})`)
  ok(same(line.option.xAxis, start.xAxis) && same(line.option.yAxis, start.yAxis) && same(line.option.legend, start.legend) && same(line.option.grid, start.grid),
    'bar → line: axes, legend and grid kept')
  ok(ls.every((s) => s.smooth === true), 'bar → line: new line series get the line preset\'s smooth curve')
  ok(!line.note, 'bar → line: nothing to report')
  const back = sw(line.option, 'bar')
  ok(same(back.option, start), `bar → line → bar: the option is identical to the start${same(back.option, start) ? '' : ` (got ${canon(back.option).slice(0, 200)})`}`)

  // a line with line-only keys going to bar drops them
  const l2 = sample('line'); l2.series[0].data = [1, 2, 3, 4, 5, 6]; l2.series[0].lineStyle = { color: '#abcdef', width: 4 }; l2.series[0].symbol = 'none'
  const b2 = sw(l2, 'bar')
  const s0 = series(b2.option)[0] ?? {}
  ok(s0.type === 'bar' && same(s0.data, [1, 2, 3, 4, 5, 6]), 'line → bar: data kept')
  ok(!('smooth' in s0) && !('areaStyle' in s0) && !('lineStyle' in s0) && !('symbol' in s0), `line → bar: line-only keys dropped (has ${Object.keys(s0).join(',')})`)
  ok(s0.itemStyle?.color === '#abcdef', 'line → bar: the line colour becomes the bar colour')

  // dual axis survives bar → line
  const dual = userBar(); dual.yAxis = [{ type: 'value' }, { type: 'value', name: 'Axis 2' }]
  dual.series.forEach((s: Opt, i: number) => { s.yAxisIndex = i === 0 ? 0 : 1 })
  const dl = sw(dual, 'line')
  ok(Array.isArray(dl.option.yAxis) && dl.option.yAxis.length === 2 && series(dl.option).every((s, i) => s.yAxisIndex === (i === 0 ? 0 : 1)),
    'bar → line: a second axis and each series\' axis are kept')

  // a mixed chart (one series already a line) goes all-line, the existing line untouched
  const mixed = userBar(); mixed.series[1].type = 'line'
  const ml = sw(mixed, 'line')
  ok(series(ml.option).every((s) => s.type === 'line') && !('smooth' in (series(ml.option)[1] ?? { smooth: 1 })),
    'mixed → line: every series is a line; one that already was keeps its own look')
}

// ---------------------------------------------------------------- 2. pie
console.log('bar/line ⇄ pie')
{
  const start = userBar()
  const pie = sw(start, 'pie')
  const ps = series(pie.option)
  ok(ps.length === 1 && ps[0].type === 'pie', `bar → pie: one pie series (got ${ps.length})`)
  ok(same(ps[0]?.data, [{ name: 'Q1', value: 101 }, { name: 'Q2', value: 201 }, { name: 'Q3', value: 301 }, { name: 'Q4', value: 401 }]),
    `bar → pie: slices are the categories with the first series' values (got ${JSON.stringify(ps[0]?.data)})`)
  ok(!('xAxis' in pie.option) && !('yAxis' in pie.option) && !('dataZoom' in pie.option), 'bar → pie: axes and zoom removed')
  ok(pie.option.tooltip?.trigger === 'item', 'bar → pie: item tooltips')
  ok(pie.note?.kind === 'pie' && pie.note?.series === 'North', `bar → pie: reports the series the pie shows (${JSON.stringify(pie.note)})`)

  const back = sw(pie.option, 'bar')
  const bs = series(back.option)
  ok(same(back.option.xAxis?.data, ['Q1', 'Q2', 'Q3', 'Q4']), `bar → pie → bar: categories survive (got ${JSON.stringify(back.option.xAxis?.data)})`)
  ok(bs.length === 1 && bs[0].type === 'bar' && bs[0].name === 'North' && same(bs[0].data, [101, 201, 301, 401]),
    `bar → pie → bar: the first series survives (got ${JSON.stringify(bs)})`)
  ok(back.option.yAxis && back.option.grid && back.option.tooltip?.trigger === 'axis', 'pie → bar: value axis, grid and axis tooltips are back')
  ok(!back.note, 'pie → bar: nothing to report')

  const one = userBar(); one.series = [one.series[0]]
  ok(!sw(one, 'pie').note, 'bar with one series → pie: nothing to report')
  const unnamed = userBar(); delete unnamed.series[0].name
  const un = sw(unnamed, 'pie')
  ok(un.note?.kind === 'pie' && un.note.series === '', 'bar → pie, first series unnamed: the note carries an empty name for the panel to fill')

  // a user's pie (edited slices) → line
  const myPie = sample('pie'); myPie.series[0].data = [{ name: 'Rent', value: 1200 }, { name: 'Food', value: 400 }]
  const pl = sw(myPie, 'line')
  ok(same(pl.option.xAxis?.data, ['Rent', 'Food']) && same(series(pl.option)[0]?.data, [1200, 400]) && series(pl.option)[0]?.type === 'line',
    `pie → line: slice names become categories, values one series (got ${JSON.stringify(pl.option.xAxis?.data)} ${JSON.stringify(series(pl.option)[0]?.data)})`)
  ok(!('radius' in (series(pl.option)[0] ?? {})) && !('label' in (series(pl.option)[0] ?? {})), 'pie → line: pie-only keys dropped')

  // a pie with zero slices
  const empty = sample('pie'); empty.series[0].data = []
  for (const to of ['bar', 'line', 'scatter']) {
    const r = sw(empty, to)
    const s = series(r.option)
    ok(s.length === 1 && s[0].type === to && Array.isArray(s[0].data) && s[0].data.length === 0,
      `empty pie → ${to}: one empty ${to} series (got ${JSON.stringify(s)})`)
  }
  // a bar with no series at all
  const noSeries = sample('bar'); noSeries.series = []
  const np = sw(noSeries, 'pie')
  ok(series(np.option).length === 1 && series(np.option)[0].type === 'pie', 'bar with no series → pie: one pie series')
}

// ---------------------------------------------------------------- 3. scatter
console.log('scatter')
{
  const start = userBar()
  const sc = sw(start, 'scatter')
  const ss = series(sc.option)
  ok(ss.length === 1 && ss[0].type === 'scatter', `bar → scatter: one scatter series (got ${ss.length})`)
  ok(same(ss[0]?.data, [[101, 102], [201, 202], [301, 302], [401, 402]]), `bar → scatter: series 0 is x, series 1 is y (got ${JSON.stringify(ss[0]?.data)})`)
  ok(sc.option.xAxis?.type === 'value' && !('data' in (sc.option.xAxis ?? {})), 'bar → scatter: x is a value axis')
  ok(sc.note?.kind === 'scatter', 'bar → scatter: reports the simplification')

  const one = userBar(); one.series = [one.series[0]]
  ok(same(series(sw(one, 'scatter').option)[0]?.data, [[1, 101], [2, 201], [3, 301], [4, 401]]), 'one series → scatter: index against value')

  const myScatter = sample('scatter'); myScatter.series[0].data = [[3, 30], [5, 50], [9, 90]]
  for (const to of ['bar', 'line']) {
    const r = sw(myScatter, to)
    ok(same(r.option.xAxis?.data, ['1', '2', '3']) && same(series(r.option)[0]?.data, [30, 50, 90]) && r.option.xAxis?.type === 'category',
      `scatter → ${to}: categories 1…n over the y values (got ${JSON.stringify(r.option.xAxis)} ${JSON.stringify(series(r.option)[0]?.data)})`)
    ok(r.note?.kind === 'scatter', `scatter → ${to}: reports the simplification`)
  }
  const sp = sw(myScatter, 'pie')
  ok(same(series(sp.option)[0]?.data, [{ name: '1', value: 30 }, { name: '2', value: 50 }, { name: '3', value: 90 }]), 'scatter → pie: y values as slices')
}

// ---------------------------------------------------------------- 4. untouched samples
console.log('untouched samples')
for (const from of KINDS) for (const to of KINDS) {
  if (from === to) continue
  const r = sw(sample(from), to)
  ok(same(r.option, sample(to)) && !r.note, `untouched ${from} → ${to}: the ${to} sample`)
}
{
  // a sample whose palette predates a theme change is still untouched; its colours stay
  const stale = sample('bar'); stale.color = ['#111111', '#222222']
  const r = sw(stale, 'line')
  const want = { ...sample('line'), color: ['#111111', '#222222'] }
  ok(same(r.option, want), 'untouched sample with an older palette → the target sample, in its own colours')
  // one value changed is not untouched
  const edited = sample('bar'); edited.series[0].data[0] = 13
  const e = sw(edited, 'line')
  ok(series(e.option).length === 2 && series(e.option)[0]?.name === 'Series A' && series(e.option)[0]?.data?.[0] === 13,
    `one edited value: converted, not replaced (got ${JSON.stringify(series(e.option).map((s) => s.name))})`)
}

// ---------------------------------------------------------------- 5. validate, purity
console.log('no ignored keys, every pair')
{
  const sources: Record<string, Opt> = {
    bar: userBar(),
    line: (() => { const o = sw(userBar(), 'line').option; o.series[0].lineStyle = { ...o.series[0].lineStyle, width: 3 }; o.series[0].symbol = 'circle'; return o })(),
    pie: (() => { const o = sample('pie'); o.series[0].data = [{ name: 'A', value: 1 }, { name: 'B', value: 2 }]; return o })(),
    scatter: (() => { const o = sample('scatter'); o.series[0].data = [[1, 2], [3, 4]]; o.series[0].symbol = 'circle'; return o })(),
  }
  for (const from of KINDS) {
    ok(ignoredKeys(sources[from]).length === 0, `source ${from} is itself clean`)
    for (const to of KINDS) {
      const r = sw(sources[from], to)
      const bad = ignoredKeys(r.option)
      ok(bad.length === 0, `${from} → ${to}: no chart-key-ignored${bad.length ? ` (${bad.join(', ')})` : ''}`)
      ok(series(r.option).every((s) => s.type === to), `${from} → ${to}: every series is a ${to}`)
    }
  }
  const src = readFileSync('slides/src/chartconvert.ts', 'utf8').replace(/\/\/.*$/gm, '')
  ok(!/\b(document|window|globalThis|navigator)\b/.test(src), 'chartconvert.ts touches no DOM or global (pure)')
}

// ---------------------------------------------------------------- 6. linked charts
console.log('linked charts')
{
  const cell = (html: string) => ({ html })
  const table = defaultTable({
    columns: [{ w: 1 }, { w: 1 }, { w: 1 }],
    rows: [
      { cells: [cell('Region'), cell('Sales'), cell('Cost')] },
      { cells: [cell('North'), cell('10'), cell('4')] },
      { cells: [cell('South'), cell('20'), cell('8')] },
    ],
  })
  const base = sample('bar')
  base.xAxis.data = ['North', 'South']
  base.series = [{ type: 'bar', name: 'Sales', data: [10, 20] }, { type: 'bar', name: 'Cost', data: [4, 8] }]
  for (const to of ['line', 'pie', 'bar']) {
    const chart = defaultChart(clone(base), { source: { tableId: table.id } })
    chart.option = sw(chart.option as Opt, to).option
    const t2 = clone(table); t2.rows[1].cells[1].html = '15'; t2.rows.push({ cells: [cell('East'), cell('30'), cell('9')] })
    const changed = syncLinkedChart(chart, t2)
    const s0 = series(chart.option as Opt)[0] ?? {}
    const values = to === 'pie' ? (s0.data ?? []).map((d: Opt) => d?.value) : s0.data
    ok(changed && same(values, [15, 20, 30]) && s0.type === to,
      `linked bar → ${to}: the next table edit still feeds it (got ${JSON.stringify(values)})`)
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}

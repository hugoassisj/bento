#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Make a chart from a table: real-world numbers, what was left out, and where
// the chart goes.
//
//   node scripts/test-slides-table-chart.ts
//
// WHAT THIS PROVES, against slides/src/model.ts (the code both the inspector's
// "Make a chart from this table" and the live table link run):
//   1. readCellNumber reads numbers the way finance writes them: currency
//      before or after (`$1,204`, `USD 3,000`, `9,4 €`), accounting brackets
//      `(300)` as negative, a Unicode minus, `%` with or without a space, and
//      a magnitude suffix (`€9.4M`, `1.2k`). Separators follow countnumber.ts
//      readNumber, the 2026-10-15 ruling on #584, so `1.2.3`, `192.168.1.1`,
//      `Q1` and `n/a` are not numbers.
//   2. tableChartColumns on Revenue `$1,204` / Costs `(300)` / Margin `27%`
//      gives three series with the right signs, says which columns it left
//      out (`skipped`), and carries a column's currency (`unit`).
//   3. syncLinkedChart, the live link, uses the same reader: editing `$1,204`
//      to `$2,000` reaches the chart, and a series follows its column by NAME
//      when a column that used to be skipped now charts. Charts made by the
//      previous release get, after an edit, exactly what that release gave:
//      a column the reader now skips (`12 apples`) keeps its series' data,
//      duplicate headers and a series renamed to another column's header map
//      by position.
//   4. chartBoxFor places the new chart inside the page: on a 16:9 deck with
//      the table at its default position and at the bottom, on 4:3 and 9:16.
//   5. there is one cell-to-number reader in slides/src: the inspector keeps
//      no copy of its own.
// On the parent commit 2 and 3 fail on the `$1,204` and `(300)` columns (only
// Margin charted), 1 and 4 fail because the functions do not exist, and 5
// fails on the inspector's own strip()/parseFloat.

import { register } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
register('./lib/ts-resolve-hooks.mjs', import.meta.url)
const model = await import('../slides/src/model.ts') as Record<string, any>
const { tableChartColumns, syncLinkedChart, defaultTable, defaultChart, starterDoc } = { ...model, ...(await import('../slides/src/starterdeck.ts')) } as Record<string, any>
const readCellNumber: ((s: string) => { value: number; unit?: string; pct?: boolean } | null) | undefined = model.readCellNumber
const chartBoxFor: ((t: { x: number; y: number; w: number; h: number }, s: { width: number; height: number }) => { x: number; y: number; w: number; h: number }) | undefined = model.chartBoxFor

let failures = 0, checks = 0
const ok = (cond: boolean, msg: string, extra = '') => { checks++; if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}${extra ? `  (${extra})` : ''}`) }
const H = (s: string) => console.log(`\n${s}\n`)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => readFileSync(join(root, f), 'utf8')

const tableOf = (rows: string[][], header = true) => defaultTable({
  id: 'tbl', header,
  columns: rows[0].map(() => ({ w: 1 })),
  rows: rows.map((r) => ({ cells: r.map((html) => ({ html })) })),
})
const FIXTURE = [
  ['Quarter', 'Revenue', 'Costs', 'Margin'],
  ['Q1', '$1,204', '(300)', '27%'],
  ['Q2', '$1,530', '(410)', '31%'],
  ['Q3', '$2,310', '(520)', '33%'],
]

H('1. readCellNumber reads real-world numbers')
if (typeof readCellNumber !== 'function') ok(false, 'model.ts exports readCellNumber', typeof readCellNumber)
else {
  const read1 = (s: string) => readCellNumber(s)
  const cases: Array<[string, { value: number; unit?: string; pct?: boolean } | null]> = [
    ['$1,204', { value: 1204, unit: '$' }],
    ['(300)', { value: -300 }],
    ['($1,204)', { value: -1204, unit: '$' }],
    ['-$300', { value: -300, unit: '$' }],
    ['27%', { value: 27, pct: true }],
    ['+222%', { value: 222, pct: true }],
    ['€9.4M', { value: 9400000, unit: '€' }],
    ['1.2k', { value: 1200 }],
    ['3bn', { value: 3000000000 }],
    ['−15', { value: -15 }],
    ['–15', { value: -15 }],
    ['.5', { value: 0.5 }],
    ['1,5', { value: 1.5 }],
    ['12 %', { value: 12, pct: true }],
    ['USD 3,000', { value: 3000, unit: 'USD' }],
    ['3,000 EUR', { value: 3000, unit: 'EUR' }],
    ['9,4 €', { value: 9.4, unit: '€' }],
    ['1.204,5', { value: 1204.5 }],
    ['1 204', { value: 1204 }],
    ['1&nbsp;204', { value: 1204 }],
    ['<b>1,204</b>', { value: 1204 }],
    ['12.500', { value: 12.5 }],
    ['1.250.000', { value: 1250000 }],
    ['0', { value: 0 }],
    ['1.2.3', null],
    ['192.168.1.1', null],
    ['Q1', null],
    ['n/a', null],
    ['—', null],
    ['', null],
    ['1,2,3', null],
    ['12 apples', null],
    ['(-300)', null],
    ['$1,204 USD', null],
    ['(300', null],
  ]
  for (const [input, want] of cases) {
    const got = read1(input)
    ok(same(got, want), `${JSON.stringify(input)} → ${JSON.stringify(want)}`, `got ${JSON.stringify(got)}`)
  }
}

H('2. tableChartColumns on the finance table')
{
  const r = tableChartColumns(tableOf(FIXTURE))
  ok(same(r.labels, ['Q1', 'Q2', 'Q3']), 'labels are the first column', JSON.stringify(r.labels))
  ok(same(r.cols.map((c: any) => c.name), ['Revenue', 'Costs', 'Margin']), 'three series: Revenue, Costs, Margin', JSON.stringify(r.cols.map((c: any) => c.name)))
  const col = (n: string) => r.cols.find((c: any) => c.name === n)
  ok(same(col('Revenue')?.data, [1204, 1530, 2310]), 'Revenue is [1204, 1530, 2310]', JSON.stringify(col('Revenue')?.data))
  ok(same(col('Costs')?.data, [-300, -410, -520]), 'Costs is [-300, -410, -520]', JSON.stringify(col('Costs')?.data))
  ok(same(col('Margin')?.data, [27, 31, 33]), 'Margin is [27, 31, 33]', JSON.stringify(col('Margin')?.data))
  ok(col('Revenue')?.unit === '$' && col('Costs')?.unit === undefined && col('Margin')?.unit === undefined, 'Revenue carries its unit ($); the others carry none',
    JSON.stringify(r.cols.map((c: any) => c.unit)))
  ok(col('Margin')?.isPct === true && col('Revenue')?.isPct === false, 'Margin reads as a percent column, Revenue does not')
  ok(same(r.skipped, []), 'nothing was skipped', JSON.stringify(r.skipped))

  const withNotes = tableChartColumns(tableOf([
    ['Quarter', 'Revenue', 'Notes', 'Margin'],
    ['Q1', '$1,204', 'launch', '27%'],
    ['Q2', '$1,530', 'n/a', '31%'],
    ['Q3', '$2,310', 'v1.2.3', '33%'],
  ]))
  ok(same(withNotes.cols.map((c: any) => c.name), ['Revenue', 'Margin']), 'a text column is not charted', JSON.stringify(withNotes.cols.map((c: any) => c.name)))
  ok(same(withNotes.skipped, ['Notes']), 'and is named in skipped', JSON.stringify(withNotes.skipped))

  const noHeader = tableChartColumns(tableOf([['a', '1', 'x'], ['b', '2', 'y']], false))
  ok(same(noHeader.skipped, ['C']), 'a headerless table names a skipped column by its letter', JSON.stringify(noHeader.skipped))
  const wide = tableChartColumns(tableOf([Array.from({ length: 30 }, (_, i) => (i ? 'x' : 'a')), Array.from({ length: 30 }, (_, i) => (i ? 'y' : 'b'))], false))
  ok(wide.skipped[24] === 'Z' && wide.skipped[25] === 'AA' && wide.skipped[28] === 'AD', 'past column Z the letters go on AA, AB…', JSON.stringify(wide.skipped.slice(23)))

  const mixed = tableChartColumns(tableOf([['K', 'V'], ['a', '$1'], ['b', '€2']]))
  ok(mixed.cols[0]?.unit === undefined, 'two currencies in one column give no unit', String(mixed.cols[0]?.unit))
}

H('3. the live link uses the same reader')
{
  const table = tableOf(FIXTURE)
  const chart = defaultChart({
    xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3'] }, yAxis: { type: 'value' },
    series: [
      { type: 'bar', name: 'Revenue', data: [0, 0, 0] },
      { type: 'bar', name: 'Costs', data: [0, 0, 0] },
      { type: 'bar', name: 'Margin', data: [0, 0, 0] },
    ],
  }, { source: { tableId: 'tbl' } })
  syncLinkedChart(chart, table)
  ok(same(chart.option.series.map((s: any) => s.data), [[1204, 1530, 2310], [-300, -410, -520], [27, 31, 33]]), 'the link fills all three series',
    JSON.stringify(chart.option.series.map((s: any) => s.data)))
  table.rows[1].cells[1].html = '$2,000'
  const changed = syncLinkedChart(chart, table)
  ok(changed && same(chart.option.series[0].data, [2000, 1530, 2310]), 'editing $1,204 to $2,000 reaches the chart', JSON.stringify(chart.option.series[0].data))

  // A chart made before this change from the same table charted Margin alone,
  // in series slot 0. Revenue and Costs now chart too; by position slot 0
  // would turn into Revenue. It follows its column by name instead.
  const old = defaultChart({ xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [{ type: 'bar', name: 'Margin', data: [27, 31, 33] }] })
  syncLinkedChart(old, tableOf(FIXTURE))
  ok(same(old.option.series[0].data, [27, 31, 33]), 'an existing Margin-only chart keeps showing Margin', JSON.stringify(old.option.series[0].data))
  const unnamed = defaultChart({ xAxis: { type: 'category', data: [] }, series: [{ type: 'bar', name: 'Custom', data: [] }, { type: 'bar', data: [] }] })
  syncLinkedChart(unnamed, tableOf(FIXTURE))
  ok(same(unnamed.option.series.map((s: any) => s.data), [[1204, 1530, 2310], [-300, -410, -520]]), 'series whose name matches no column still map by position',
    JSON.stringify(unnamed.option.series.map((s: any) => s.data)))

  // Charts made by the previous release, synced after one cell edit. The
  // expected arrays are what that release's syncLinkedChart gives on the same
  // edit (checked by running these rows against origin/main): a deck that
  // opens in this shell must never show another column's data.
  const made = (series: Array<[string, number[]]>) => defaultChart({
    xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' },
    series: series.map(([name, data]) => ({ type: 'bar', name, data })),
  }, { source: { tableId: 'tbl' } })
  const dataOf = (c: any) => c.option.series.map((s: any) => [s.name, s.data])
  {
    // the previous reader charted "12 apples" (parseFloat read the 12); this
    // one does not. Stock must keep its own data, not take Price's.
    const t = tableOf([['Fruit', 'Stock', 'Price'], ['Apple', '12 apples', '6'], ['Banana', '30 apples', '4'], ['Cherry', '7 apples', '5']])
    const c = made([['Stock', [12, 30, 7]], ['Price', [6, 4, 5]]])
    t.rows[1].cells[2].html = '8'
    syncLinkedChart(c, t)
    ok(same(dataOf(c), [['Stock', [12, 30, 7]], ['Price', [8, 4, 5]]]), 'a column the reader now skips leaves its series alone; no neighbour\'s data moves in',
      JSON.stringify(dataOf(c)))
  }
  {
    const t = tableOf([['Q', 'Sales', 'Sales'], ['Q1', '10', '20'], ['Q2', '11', '21']])
    const c = made([['Sales', [10, 11]], ['Sales', [20, 21]]])
    t.rows[1].cells[2].html = '25'
    syncLinkedChart(c, t)
    ok(same(dataOf(c), [['Sales', [10, 11]], ['Sales', [25, 21]]]), 'two columns with the same header map by position, each to its own',
      JSON.stringify(dataOf(c)))
  }
  {
    // the Revenue series renamed in the inspector to "Costs"
    const t = tableOf([['Q', 'Revenue', 'Costs'], ['Q1', '100', '40'], ['Q2', '120', '50']])
    const c = made([['Costs', [100, 120]], ['Costs', [40, 50]]])
    t.rows[1].cells[1].html = '130'
    syncLinkedChart(c, t)
    ok(same(dataOf(c), [['Costs', [130, 120]], ['Costs', [40, 50]]]), 'a series renamed to another column\'s header keeps its column (the name is not unique among series)',
      JSON.stringify(dataOf(c)))
  }

  // the starter deck's linked chart renders the same data it ships with
  const doc = starterDoc()
  const all = doc.slides.flatMap((s: any) => s.elements)
  const st = all.find((e: any) => e.id === 'sd-table'), sc = all.find((e: any) => e.id === 'sd-tbl-chart')
  const shipped = JSON.stringify(sc.option)
  const moved = syncLinkedChart(sc, st)
  ok(!moved && JSON.stringify(sc.option) === shipped, 'the starter deck\'s linked chart is unchanged by a sync', moved ? JSON.stringify(sc.option.series.map((s: any) => s.data)) : '')
}

H('4. chartBoxFor keeps the chart on the page')
if (typeof chartBoxFor !== 'function') ok(false, 'model.ts exports chartBoxFor', typeof chartBoxFor)
else {
  const inside = (b: { x: number; y: number; w: number; h: number }, s: { width: number; height: number }) =>
    b.x >= 0 && b.y >= 0 && b.x + b.w <= s.width && b.y + b.h <= s.height && b.w >= 200 && b.h >= 120
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const tbl = defaultTable({})
  const box = (b: any) => `${b.x},${b.y} ${b.w}×${b.h}`
  const rows: Array<[string, { x: number; y: number; w: number; h: number }, { width: number; height: number }]> = [
    ['16:9, table at its default position', { x: tbl.x, y: tbl.y, w: tbl.w, h: tbl.h }, { width: 1280, height: 720 }],
    ['16:9, table at the bottom of the slide', { x: tbl.x, y: 720 - tbl.h - 20, w: tbl.w, h: tbl.h }, { width: 1280, height: 720 }],
    ['16:9, small table near the top', { x: 96, y: 96, w: 500, h: 160 }, { width: 1280, height: 720 }],
    ['16:9, narrow table on the left', { x: 60, y: 120, w: 400, h: 480 }, { width: 1280, height: 720 }],
    ['16:9, table filling the slide', { x: 0, y: 0, w: 1280, h: 720 }, { width: 1280, height: 720 }],
    ['4:3, table at its default position', { x: tbl.x, y: tbl.y, w: tbl.w, h: tbl.h }, { width: 960, height: 720 }],
    ['4:3, table at the bottom', { x: 80, y: 460, w: 800, h: 240 }, { width: 960, height: 720 }],
    ['9:16, table at its default position', { x: tbl.x, y: tbl.y, w: tbl.w, h: tbl.h }, { width: 1080, height: 1920 }],
    ['9:16, table at the bottom', { x: 140, y: 1600, w: 800, h: 300 }, { width: 1080, height: 1920 }],
    ['16:9, table dragged off the right edge', { x: 1500, y: 200, w: 400, h: 200 }, { width: 1280, height: 720 }],
    ['16:9, table dragged above the page', { x: 200, y: -600, w: 600, h: 200 }, { width: 1280, height: 720 }],
  ]
  for (const [name, t, size] of rows) {
    const b = chartBoxFor(t, size)
    const fill = t.w >= size.width && t.h >= size.height
    ok(inside(b, size) && (fill || !overlaps(b, t)), `${name}: the chart lies inside the ${size.width}×${size.height} page${fill ? '' : ' and clear of the table'}`, `table ${box(t)} → chart ${box(b)}`)
  }
  const b = chartBoxFor({ x: tbl.x, y: 96, w: tbl.w, h: 200 }, { width: 1280, height: 720 })
  ok(b.y === 96 + 200 + 24 && b.h === 300 && b.x === tbl.x, 'when it fits, the chart goes just below the table at full height, aligned with it', box(b))
}

H('5. one cell-to-number reader')
{
  const inspector = read('slides/src/editor/inspector/table.ts')
  ok(!/parseFloat|const strip\b/.test(inspector), 'the inspector\'s table→chart keeps no number reader of its own')
  ok(/tableChartColumns\(/.test(inspector) && /chartBoxFor\(/.test(inspector), 'it calls tableChartColumns and chartBoxFor from model.ts')
  const files: string[] = []
  const walk = (d: string) => { for (const f of readdirSync(join(root, d))) { const p = `${d}/${f}`; if (statSync(join(root, p)).isDirectory()) { if (f !== 'i18n') walk(p) } else if (/\.ts$/.test(f)) files.push(p) } }
  walk('slides/src')
  const readers = files.filter((f) => /parseFloat\(\s*strip/i.test(read(f)) || /function readCellNumber|readCellNumber\s*=/.test(read(f)))
  ok(same(readers, ['slides/src/model.ts']), 'readCellNumber is defined once, in model.ts, and nothing else strips a cell into parseFloat', JSON.stringify(readers))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) { console.log(`${failures} FAILED`); process.exit(1) }

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Tables, and turning one into a chart.
import type { PropsPanel } from '../panels'
import { type TableElement, tableStyleFor, applyChartPalette, defaultChart, tableChartColumns, chartBoxFor } from '../../model'
import { row, toggle, section, labeledSelect, mini, number } from './fields'
import { t } from '../../i18n'
import { colorAlpha } from './color'

export function buildTableProps(p: PropsPanel, el: TableElement) {
  // a count is a number field like any other: typed, stepped with ↑↓, or
  // worked out (+2); one undo step however far it moves
  const count = (label: string, n: number, min: number, grow: (tb: TableElement) => void, shrink: (tb: TableElement) => void) =>
    row(p, label, number(n, 1, (v, fin) => {
      if (!fin) return
      const want = Math.max(min, Math.min(Math.round(v), 64))
      p.mutate(el.id, (e) => {
        const tb = e as TableElement
        const now = () => label === 'Columns' ? tb.columns.length : tb.rows.length
        while (now() < want) grow(tb)
        while (now() > want) shrink(tb)
      }, true)
    }, { min, max: 64 }))
  count('Columns', el.columns.length, 1,
    (tb) => { tb.columns.push({ w: 1 }); tb.rows.forEach((r) => r.cells.push({ html: '' })) },
    (tb) => { tb.columns.pop(); tb.rows.forEach((r) => r.cells.pop()) })
  count('Rows', el.rows.length, el.header ? 2 : 1,
    (tb) => { tb.rows.push({ cells: tb.columns.map(() => ({ html: '' })) }) },
    (tb) => { tb.rows.pop() })

  row(p, 'Header row', toggle(el.header, (v) => p.mutate(el.id, (e) => {
    (e as TableElement).header = v
  }, true)))

  // one-tap looks that all work within the fixed-grid renderer
  const st = el.style
  const preset = st.borderWidth && st.zebra ? 'Boxed'
    : st.borderWidth ? 'Lined'
    : st.zebra ? 'Zebra'
    : 'Minimal'
  const themed = tableStyleFor(p.store.doc.theme)
  section(p, t('Style'))
  row(p, 'Preset', labeledSelect([['Lined', t('Lined')], ['Zebra', t('Striped')], ['Boxed', t('Boxed')], ['Minimal', t('Minimal')]], preset, (v) =>
    p.mutate(el.id, (e) => {
      const s = (e as TableElement).style
      s.borderWidth = v === 'Lined' || v === 'Boxed' ? Math.max(themed.borderWidth, 1) : 0
      s.zebra = v === 'Zebra' || v === 'Boxed' ? themed.zebra ?? 'rgba(30,42,58,0.05)' : undefined
      if (v === 'Minimal') { s.headerBg = 'transparent'; s.headerColor = s.color }
      else if (s.headerBg === 'transparent') {
        s.headerBg = themed.headerBg
        s.headerColor = themed.headerColor
      }
    }, true)))

  row(p, 'Header fill', colorAlpha(p, st.headerBg, (v, fin) =>
    p.mutate(el.id, (e) => { (e as TableElement).style.headerBg = v }, fin)))
  row(p, 'Header text', colorAlpha(p, st.headerColor, (v, fin) =>
    p.mutate(el.id, (e) => { (e as TableElement).style.headerColor = v }, fin)))
  row(p, 'Text', colorAlpha(p, st.color, (v, fin) =>
    p.mutate(el.id, (e) => { (e as TableElement).style.color = v }, fin)))
  row(p, 'Grid lines', colorAlpha(p, st.borderColor, (v, fin) =>
    p.mutate(el.id, (e) => { (e as TableElement).style.borderColor = v }, fin)))

  const grid = document.createElement('div')
  grid.className = 'ed-grid2'
  grid.append(
    mini(t('Font'), st.fontSize, (v, fin) => p.mutate(el.id, (e) =>
      { (e as TableElement).style.fontSize = Math.max(v, 6) }, fin), undefined, { min: 6 }),
    mini(t('Radius'), st.radius, (v, fin) => p.mutate(el.id, (e) =>
      { (e as TableElement).style.radius = Math.max(v, 0) }, fin), undefined, { min: 0 }),
    mini(t('Pad X'), st.cellPadX, (v, fin) => p.mutate(el.id, (e) =>
      { (e as TableElement).style.cellPadX = Math.max(v, 0) }, fin), undefined, { min: 0 }),
    mini(t('Pad Y'), st.cellPadY, (v, fin) => p.mutate(el.id, (e) =>
      { (e as TableElement).style.cellPadY = Math.max(v, 0) }, fin), undefined, { min: 0 }),
  )
  p.host.appendChild(grid)

  const hint = document.createElement('p')
  hint.className = 'ed-hint'
  hint.textContent = t('Double-click a cell to edit. Tab moves across, Enter down.')
  p.host.appendChild(hint)

  const toChart = document.createElement('button')
  toChart.className = 'ed-btn ed-btn-block'
  toChart.textContent = t('Make a chart from this table →')
  toChart.title = t('Create a bar chart from the numbers in this table (first column = labels)')
  toChart.addEventListener('click', () => tableToChart(p, el))
  p.host.appendChild(toChart)
}

/** Bridge: build a bar chart from a table's numeric columns and insert it. */
export function tableToChart(p: PropsPanel, el: TableElement) {
  // the same reader the live link uses: `$1,204`, `(300)`, `27%`, `€9.4M`
  const { labels, cols, skipped } = tableChartColumns(el)
  if (!cols.length) { p.toast(t('No numeric column found to chart')); return }
  // a currency the column wrote goes on its axis: a symbol before the value,
  // a code after it (`$1.2k` / `1.2k USD`)
  const unitFormat = (unit?: string) => unit ? (/^[A-Z]{3}$/.test(unit) ? `{value} ${unit}` : `${unit}{value}`) : undefined

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
    const primFmt = unitFormat(prim.unit), secFmt = sec.isPct ? '{value}%' : unitFormat(sec.unit)
    option.yAxis = [
      { type: 'value', name: prim.name || undefined, axisLabel: primFmt ? { formatter: primFmt } : undefined },
      { type: 'value', name: sec.name || undefined, axisLabel: secFmt ? { formatter: secFmt } : undefined },
    ]
    option.series = [
      { type: 'bar', name: prim.name, data: prim.data, yAxisIndex: 0 },
      { type: 'line', name: sec.name, data: sec.data, yAxisIndex: 1, smooth: true },
    ]
    option.legend = { bottom: 0 }
  } else {
    // one shared axis takes a unit only when every column charted on it has it
    const fmt = cols.every((c) => c.unit === cols[0].unit) ? unitFormat(cols[0].unit) : undefined
    option.yAxis = fmt ? { type: 'value', axisLabel: { formatter: fmt } } : { type: 'value' }
    option.series = cols.map((c) => ({ type: 'bar', name: c.name, data: c.data }))
    if (cols.length > 1) option.legend = { bottom: 0 }
  }
  applyChartPalette(option, p.store.doc.theme)
  const chart = defaultChart(option, {
    ...chartBoxFor(el, p.store.doc.size), preset: 'bar',
    // live binding: edits to the table flow into this chart
    source: { tableId: el.id },
  })
  p.store.commit(() => p.store.slide.elements.push(chart))
  p.store.select([chart.id])
  // a partial chart says what it left out; a silent one looks authoritative
  p.toast(skipped.length
    ? t('Charted {n} of {total} columns — not numeric: {names}', { n: cols.length, total: cols.length + skipped.length, names: skipped.join(', ') })
    : t('Chart created — it updates live with the table'))
}

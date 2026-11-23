// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Switching a chart's type: what the inspector's Type control writes.
import { type BentoDoc, applyChartPalette } from './model'
import { CHART_PRESETS } from './charts'

/** Something the switch could not carry over, for the inspector to say. */
export type ChartSwitchNote = { kind: 'pie'; series: string } | { kind: 'scatter' }

/** The option a chart gets when its type is switched to `to`. */
export function switchChartType(
  _option: Record<string, unknown>, to: string, theme: BentoDoc['theme'],
): { option: Record<string, unknown>; note?: ChartSwitchNote } {
  return { option: applyChartPalette(CHART_PRESETS[to](), theme) }
}

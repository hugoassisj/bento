// Tables placed inside a grid — the geometry every surface reads.
//
// docs/dash-unified.md: every sheet is a grid, and a table is an object that
// lives in one. A `TableSheet` with `placed = { on, r, c }` sits on the canvas
// sheet `on` with its HEADER row at (r, c), 0-based; without `placed` it fills
// its own sheet, which is every Dataset written before placement existed.
//
// This module is pure: no DOM, no store. The grid draws with it, formulas
// resolve A1 through it, and parseDoc repairs with it, so all three agree on
// where a table is by construction rather than by keeping three copies in step.

import type { CanvasSheet, DashDoc, Sheet, TableSheet } from './model.ts'

export interface Placement { on: string; r: number; c: number }

/** A rectangle in grid cells, inclusive at both ends. */
export interface Rect { r0: number; c0: number; r1: number; c1: number }

/** The part of a placed table a grid cell falls on. */
export type TablePart =
  | { part: 'header'; col: number }
  | { part: 'row'; row: number; col: number }
  | { part: 'totals'; col: number }

/** Rows the table holds, from its run-length encoded ids. */
export const tableRows = (t: TableSheet): number => t.rids.reduce((n, [, k]) => n + k, 0)

/** Whether the table draws a totals row: any column carries a total. */
export const hasTotals = (t: TableSheet): boolean => !!t.totals && Object.keys(t.totals).length > 0

/** The placement, if the table has a well-formed one. Shape only — whether the
 *  host exists is `validatePlacements`' question, asked once at parse. */
export function placementOf(t: TableSheet): Placement | null {
  const p = t.placed as unknown
  if (!p || typeof p !== 'object') return null
  const { on, r, c } = p as Record<string, unknown>
  if (typeof on !== 'string' || !on) return null
  if (!Number.isInteger(r) || !Number.isInteger(c) || (r as number) < 0 || (c as number) < 0) return null
  return { on, r: r as number, c: c as number }
}

/**
 * The cells a table covers when placed at `p`: header, every row, then the
 * totals row when it has one. Width is its column count — never less than one,
 * so a table whose last column was deleted still occupies (and can be found
 * at) its anchor instead of vanishing from the grid.
 */
export function tableRect(t: TableSheet, p: Pick<Placement, 'r' | 'c'>): Rect {
  const h = 1 + tableRows(t) + (hasTotals(t) ? 1 : 0)
  const w = Math.max(1, t.columns.length)
  return { r0: p.r, c0: p.c, r1: p.r + h - 1, c1: p.c + w - 1 }
}

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1

export const contains = (a: Rect, r: number, c: number): boolean =>
  r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1

/** Every table placed on `canvasId`, in sheet order, with its rectangle. */
export function placedOn(doc: DashDoc, canvasId: string): Array<{ table: TableSheet; at: Placement; rect: Rect }> {
  const out: Array<{ table: TableSheet; at: Placement; rect: Rect }> = []
  for (const s of doc.sheets) {
    if (s.kind !== 'table') continue
    const at = placementOf(s as TableSheet)
    if (at && at.on === canvasId) out.push({ table: s as TableSheet, at, rect: tableRect(s as TableSheet, at) })
  }
  return out
}

/** The table under grid cell (r, c) of `canvasId`, and which part of it. */
export function tableAt(doc: DashDoc, canvasId: string, r: number, c: number):
  { table: TableSheet; rect: Rect; hit: TablePart } | null {
  for (const p of placedOn(doc, canvasId)) {
    if (!contains(p.rect, r, c)) continue
    const col = c - p.rect.c0
    const rows = tableRows(p.table)
    const hit: TablePart = r === p.rect.r0 ? { part: 'header', col }
      : r - p.rect.r0 - 1 < rows ? { part: 'row', row: r - p.rect.r0 - 1, col }
      : { part: 'totals', col }
    return { table: p.table, rect: p.rect, hit }
  }
  return null
}

/**
 * Whether a sheet is a tab of its own: everything except a table placed on a
 * grid that exists. Asks for the host rather than trusting `placed`, because a
 * file from a NEWER build opens frozen and is never repaired — and a table
 * whose placement cannot be honoured must still show somewhere, as its own tab,
 * rather than vanish from both the tab strip and every grid.
 */
export function isTab(doc: DashDoc, s: Sheet): boolean {
  if (s.kind !== 'table') return true
  const at = placementOf(s as TableSheet)
  return !at || !isGrid(doc.sheets.find((h) => h.id === at.on))
}

/** Why a placement was dropped at parse — reported as a repair, never silent. */
export type PlacementProblem = 'malformed' | 'no-host' | 'host-not-grid' | 'overlap'

/**
 * Drop every placement that cannot be honoured, IN PLACE, and say which.
 *
 * A dropped placement does not lose the table: without `placed` it is a table
 * filling its own sheet, which is exactly what an older build shows for it
 * anyway. That is why dropping is the repair rather than refusing the file.
 * Overlap keeps the EARLIER table in sheet order — sheet order is document
 * order, so every replica and every reader picks the same survivor.
 */
export function validatePlacements(doc: DashDoc): Array<{ id: string; problem: PlacementProblem }> {
  const problems: Array<{ id: string; problem: PlacementProblem }> = []
  const byId = new Map(doc.sheets.map((s) => [s.id, s] as const))
  const kept = new Map<string, Rect[]>()
  for (const s of doc.sheets) {
    if (s.kind !== 'table' || !('placed' in s) || s.placed === undefined) continue
    const t = s as TableSheet
    const at = placementOf(t)
    const host = at ? byId.get(at.on) : undefined
    const problem: PlacementProblem | null =
      !at ? 'malformed'
      : !host ? 'no-host'
      : host.kind !== 'canvas' ? 'host-not-grid'
      : (kept.get(at.on) ?? []).some((k) => overlaps(k, tableRect(t, at))) ? 'overlap'
      : null
    if (problem) {
      delete t.placed
      problems.push({ id: t.id, problem })
      continue
    }
    const list = kept.get(at!.on) ?? []
    list.push(tableRect(t, at!))
    kept.set(at!.on, list)
  }
  return problems
}

/** Canvas sheet type guard for callers holding a bare `Sheet`. */
export const isGrid = (s: Sheet | undefined): s is CanvasSheet => !!s && s.kind === 'canvas'

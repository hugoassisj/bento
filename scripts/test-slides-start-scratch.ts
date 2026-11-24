#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// File ▸ Start from scratch: what each choice leaves of the deck (scratch.ts).
//
//   node scripts/test-slides-start-scratch.ts
//
// WHAT THIS PROVES, on the Showcase and on hand-built decks:
//   Keep this look — one slide from the built-in Title layout, its background,
//     text and bar bound to the palette (a slot edit recolours them), text in
//     the theme's faces; theme, tokens, fonts and saved layouts stay, and an
//     asset a saved layout or a font still uses stays with them.
//   Blank — one empty slide, the app's default theme, no tokens, no saved
//     layouts, no font nothing names, no asset (or blob pointer) nothing uses.
//   Both — docId, collab, size, meta and present untouched; the Showcase's
//     title (or the model default) becomes the localised untitled name and a
//     title someone chose is kept.
// The dialog, the undo and the live UI are test-slides-start-scratch-browser.mjs.

import { register } from 'node:module'
register('./lib/ts-resolve-hooks.mjs', import.meta.url)
const { starterDoc, STARTER_TITLE } = await import('../slides/src/starterdeck.ts')
const { startOver, unnamedTitle } = await import('../slides/src/scratch.ts')
const { newDoc } = await import('../slides/src/model.ts')
const { resolveThemeRefs } = await import('../slides/src/palette.ts')
const { referencedAssetKeys } = await import('../slides/src/assets.ts')
import type { BentoDoc } from '../slides/src/model.ts'

let failures = 0, checks = 0
const ok = (cond: boolean, msg: string, extra = '') => { checks++; if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}${extra ? `  (${extra})` : ''}`) }
const H = (s: string) => console.log(`\n${s}\n`)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const UNTITLED = 'Deck ohne Titel' // any localised name: the editor passes t('Untitled deck')

/** Identity and the keys neither choice may touch. */
const identity = (d: BentoDoc) => JSON.stringify([d.docId, d.collab ?? null, d.size, d.meta ?? null, d.present ?? null, d.format, d.version])
const unreferenced = (d: BentoDoc) => { const used = referencedAssetKeys(d); return Object.keys(d.assets ?? {}).filter((k) => !used.has(k)) }

// ---------------------------------------------------------------- Keep this look
H('Keep this look, on the Showcase')
{
  const d = starterDoc()
  d.collab = { v: 2, room: 'r-test', key: 'k', on: false } as unknown as BentoDoc['collab']
  d.meta = { author: 'Ana' }
  const before = clone(d)
  const r = startOver(d, 'keep', UNTITLED)
  ok(d.slides.length === 1, 'one slide is left', `${d.slides.length}`)
  const s = d.slides[0]
  ok(!before.slides.some((b) => b.id === s.id), 'it is a new slide, no demo slide remains')
  ok(s.elements.some((e) => e.role === 'title') && s.elements.some((e) => e.role === 'subtitle'), 'it is the Title layout (title + subtitle)')
  ok(s.background === d.theme.background && s.themeRefs?.background === 'bg1', 'its background is the theme Background, bound to it', `${s.background} ${JSON.stringify(s.themeRefs)}`)
  const texts = s.elements.filter((e) => e.type === 'text') as Array<{ color: string; fontFamily: string; themeRefs?: Record<string, string> }>
  ok(texts.every((e) => e.color === d.theme.color && e.themeRefs?.color === 'tx1'), 'its text is the theme Text colour, bound to it')
  ok(texts.every((e) => e.fontFamily === ''), 'its text is in the theme font (empty family)')
  const bar = s.elements.find((e) => e.type === 'shape') as { fill: string; themeRefs?: Record<string, string> } | undefined
  ok(!!bar && bar.fill === d.theme.accent && bar.themeRefs?.fill === 'accent1', 'its bar is Accent 1, bound to it')
  ok(s.elements.every((e) => e.x + e.w <= d.size.width && e.y + e.h <= d.size.height), 'the layout fits the deck size')
  ok(JSON.stringify(d.theme) === JSON.stringify(before.theme), 'theme and tokens untouched', `${Object.keys(d.theme.tokens?.set ?? {}).length} tokens`)
  ok(JSON.stringify(d.fonts) === JSON.stringify(before.fonts), 'fonts untouched')
  ok(identity(d) === identity(before), 'docId, collab, size, meta and present untouched')
  ok(unreferenced(d).length === 0, 'no asset nothing references', unreferenced(d).join(', '))
  ok(d.title === UNTITLED && r.renamed, 'the Showcase title becomes the untitled name', d.title)
  ok(!JSON.stringify(d.slides).includes('"main":true'), 'no component main survives')
  // a palette edit recolours it
  d.theme.background = '#102030'; d.theme.color = '#F0E0D0'; d.theme.accent = '#00AA55'
  resolveThemeRefs(d)
  ok(s.background.toLowerCase() === '#102030', 'changing Background recolours the slide', s.background)
  ok(texts.every((e) => e.color.toLowerCase() === '#f0e0d0'), 'changing Text recolours its text')
  ok(bar!.fill.toLowerCase() === '#00aa55', 'changing Accent 1 recolours the bar')
}

H('Keep this look keeps what saved layouts and fonts use')
{
  const d = newDoc()
  d.title = 'Board review'
  d.size = { width: 1920, height: 1080 }
  d.theme.headingFamily = 'Fraunces, serif'
  d.assets = { logo: 'data:image/png;base64,AA==', face: 'data:font/woff2;base64,AA==', demo: 'data:image/png;base64,BB==', big: 'x' }
  d.blobs = { big: { key: 'b', mime: 'image/png', size: 9 }, demo: { key: 'd', mime: 'image/png', size: 9 } }
  d.fonts = [{ family: 'Brand Sans', asset: 'face', weight: '400' }]
  d.layouts = [{ id: 'my', name: 'Cover', background: '#fff', transition: 'fade', notes: '', elements: [{ id: 'l1', type: 'image', src: 'asset:logo', x: 0, y: 0, w: 10, h: 10 } as never] }]
  d.slides[0].elements.push({ id: 'p', type: 'image', src: 'asset:demo', x: 0, y: 0, w: 10, h: 10 } as never)
  const r = startOver(d, 'keep', UNTITLED)
  ok(d.assets?.logo !== undefined && d.assets?.face !== undefined, 'an asset a saved layout or a font uses stays')
  ok(d.assets?.demo === undefined && d.assets?.big === undefined, 'an asset only the old slides used goes')
  ok(d.blobs === undefined, 'its blob pointers go with it')
  ok(d.layouts?.length === 1 && d.fonts?.length === 1, 'saved layouts and fonts stay')
  ok(d.title === 'Board review' && !r.renamed, 'a title someone chose is kept', d.title)
  const title = d.slides[0].elements.find((e) => e.role === 'title') as { fontFamily: string; x: number; w: number }
  ok(title.fontFamily === 'Fraunces, serif', 'the title takes the deck heading face')
  ok(title.x + title.w <= 1920 && title.x > 160, 'the layout is scaled to the deck size', `x ${title.x} w ${title.w}`)
}

// ---------------------------------------------------------------- Blank
H('Blank, on the Showcase')
{
  const d = starterDoc()
  d.layouts = [{ id: 'my', name: 'Mine', background: '#fff', transition: 'fade', notes: '', elements: [] }]
  const before = clone(d)
  const r = startOver(d, 'blank', UNTITLED)
  ok(d.slides.length === 1 && d.slides[0].elements.length === 0, 'one empty slide is left')
  ok(Object.keys(d.theme.tokens?.set ?? {}).length === 0, 'no tokens', `${Object.keys(before.theme.tokens?.set ?? {}).length} before`)
  ok((d.layouts ?? []).length === 0, 'no saved layouts')
  ok(JSON.stringify(d.theme) === JSON.stringify(newDoc().theme), 'the theme is the app default')
  ok(d.slides[0].background === '#FFFFFF' && d.slides[0].themeRefs?.background === 'bg1', 'the slide is white and follows the theme Background')
  ok(d.fonts === undefined, 'no font nothing names', `${before.fonts?.length} before`)
  ok(Object.keys(d.assets ?? {}).length === 0 && unreferenced(d).length === 0, 'no asset nothing references', `${Object.keys(before.assets ?? {}).length} before`)
  ok(identity(d) === identity(before), 'docId, size and the rest of identity untouched')
  ok(d.title === UNTITLED && r.renamed, 'the Showcase title becomes the untitled name')
}

H('Blank keeps a font the default theme still names')
{
  const d = newDoc()
  d.fonts = [{ family: 'Roboto', asset: 'builtin:x' }, { family: 'Brand Sans', asset: 'builtin:y' }]
  startOver(d, 'blank', UNTITLED)
  ok(d.fonts?.length === 1 && d.fonts[0].family === 'Roboto', 'a family in the default stack stays, the rest go', JSON.stringify(d.fonts))
}

H('Titles')
{
  ok(unnamedTitle(STARTER_TITLE) && unnamedTitle('Untitled'), 'the Showcase title and the model default are unnamed')
  ok(!unnamedTitle('Q3 review') && !unnamedTitle(''), 'anything else was named')
  const d = newDoc()
  d.title = UNTITLED
  ok(!startOver(d, 'blank', UNTITLED).renamed, 'an already-untitled deck is not renamed again')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)

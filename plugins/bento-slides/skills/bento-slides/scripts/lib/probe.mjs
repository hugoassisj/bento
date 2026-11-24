// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The probe: a module appended to the deck, run by the deck's OWN runtime in
// headless Chrome. It waits for window.bento, optionally loads a document
// (loadDoc — the same gate as "Replace from JSON…"), and reports:
//
//   mode 'check'   validate() findings, the load report, and with pages one
//                  PNG per shown slide through window.bento.render() — the
//                  pixels of Export slides as images — plus a contact sheet;
//   mode 'expand'  the full document after loadDoc (a compact document
//                  expanded by the shell that will open it);
//   mode 'compact' window.bento.read({ compact: true }).
//
// A shell from before window.bento.render() has no public rasteriser: a
// caller that can build one (scripts/bento-check.mjs in a repo checkout)
// appends a module that sets window.__bentoLegacyRaster first; otherwise the
// probe says the shell is too old to render. No imports: this file is the
// whole probe, so the skill folder needs no bundler.

/** The probe's source for `opts`: { mode, docJson, pages (1-based page numbers, or 'all', or null), bootMs }. */
export function probeSource({ mode = 'check', docJson = null, pages = null, bootMs = 30_000 }) {
  return `
const MODE = ${JSON.stringify(mode)}
const DOC_JSON = ${JSON.stringify(docJson)}
const PAGES = ${JSON.stringify(pages)}
const BOOT_MS = ${Math.max(500, Math.min(30_000, bootMs))}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = (body) => fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
// a beacon per step, so a run that never reports can say how far it got
const stage = (name) => fetch('/stage', { method: 'POST', body: name }).catch(() => {})

async function main() {
  stage('started')
  const t0 = performance.now()
  let bento
  for (let i = 0; i < BOOT_MS / 50 && !(bento = window.bento?.doc && window.bento); i++) await sleep(50)
  if (!bento) return post({ fatal: 'the shell did not boot within ' + (BOOT_MS / 1000) + ' s (the probe ran, but window.bento never appeared); open the file in a browser to see whether it starts, or raise --timeout', stage: 'boot' })
  stage('booted')
  if (document.fonts?.ready) await document.fonts.ready

  if (MODE === 'compact') {
    if (typeof bento.read !== 'function') return post({ fatal: 'this deck\\'s shell has no window.bento.read(), so it cannot write the compact form; update the deck to a newer bento/slides, or extract without --compact', stage: 'load' })
    return post({ doc: bento.read({ compact: true }) })
  }

  let load = null
  if (DOC_JSON !== null) {
    // A compact document on a shell that predates compact input (#484) is not
    // refused by the gate — it is accepted and then the editor throws on the
    // first missing field. Say so before that happens.
    let parsed = null
    try { parsed = JSON.parse(DOC_JSON) } catch {}
    if (parsed && parsed.compact === true && typeof bento.compact !== 'function') {
      return post({ fatal: 'this shell does not accept compact documents ("compact": true needs a shell built with #484 — window.bento.compact is absent); pass a full document, or --shell a newer build', stage: 'load' })
    }
    let r
    try { r = bento.loadDoc(DOC_JSON) } catch (e) { return post({ fatal: 'the shell threw while loading the document: ' + String(e && e.message || e) + '; run bento lint on the document to find the value it trips on', stage: 'load' }) }
    if (r === false) return post({ fatal: 'the shell refused the document: loadDoc() returned false (not valid bento/slides JSON, or a compact document on a shell without #484); run bento lint on it to see why', stage: 'load' })
    load = r && typeof r === 'object' ? r : { ok: true }
    // text fitted while a font was loading is fitted again once fonts settle
    if (document.fonts?.ready) await document.fonts.ready
    await sleep(50)
    stage('loaded the document')
  }
  if (MODE === 'expand') {
    const { findings, refit, stacks, ...rest } = load ?? {}
    return post({ doc: JSON.stringify(bento.doc), load: { ...rest, findings } })
  }

  const doc = bento.doc
  const v = bento.validate()
  stage('validated')
  const shown = doc.slides.filter((s) => !s.stateOf && !s.hidden)
  const renderer = typeof bento.render === 'function' ? 'window.bento.render'
    : typeof window.__bentoLegacyRaster === 'function' ? 'bundled probe' : null
  const pages = []
  let contact = null
  if (PAGES !== null) {
    if (!renderer) return post({ fatal: 'this deck\\'s shell predates window.bento.render(), so it cannot draw its slides; update the deck to a newer bento/slides (its own update button, or apply the document to a fresh app file), or run without --png', stage: 'render' })
    const want = PAGES === 'all' ? shown.map((_, i) => i + 1) : PAGES
    const bad = want.find((n) => n > shown.length)
    if (bad) return post({ fatal: 'there is no page ' + bad + ': the deck shows ' + shown.length + ' slide(s); pick pages from 1 to ' + shown.length, stage: 'render' })
    for (const n of want) {
      const slide = shown[n - 1]
      stage('rendering slide ' + n + ' of ' + shown.length)
      let url
      if (renderer === 'window.bento.render') {
        const r = await bento.render(slide.id, { format: 'png', scale: 1 })
        if (!r.ok) return post({ fatal: 'window.bento.render could not draw slide ' + slide.id + ': ' + r.err + ' (' + r.detail + '); run without --png for the findings, and check that slide in a browser', stage: 'render' })
        url = r.dataUrl
      } else {
        url = await window.__bentoLegacyRaster(doc, slide)
      }
      pages.push({ n, url })
    }
    // contact sheet: up to 4 across, 320 px wide each, the deck's aspect
    if (pages.length) {
      const { width: w, height: h } = doc.size
      const tw = 320, th = Math.round(320 * h / w), gap = 12, cols = Math.min(4, Math.max(1, pages.length))
      const rows = Math.ceil(pages.length / cols)
      const c = document.createElement('canvas')
      c.width = cols * tw + (cols + 1) * gap
      c.height = rows * (th + 22) + (rows + 1) * gap
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#e9ecef'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#334'; ctx.font = '12px system-ui, sans-serif'
      for (let i = 0; i < pages.length; i++) {
        const img = new Image(); img.src = pages[i].url; await img.decode()
        const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + 22 + gap)
        ctx.drawImage(img, x, y, tw, th)
        ctx.fillText(String(pages[i].n).padStart(2, '0'), x, y + th + 15)
      }
      contact = c.toDataURL('image/png')
    }
  }
  return post({
    ok: v.ok,
    title: doc.title,
    size: doc.size,
    slides: doc.slides.length,
    shown: shown.length,
    counts: v.counts,
    measured: v.measured,
    findings: v.findings,
    load,
    pages,
    contact,
    renderer: PAGES !== null ? renderer : null,
    ms: Math.round(performance.now() - t0),
  })
}
main().catch((e) => post({ fatal: 'the probe failed: ' + String(e && e.stack || e) + '; rerun with BENTO_CHECK_DEBUG=1 and report it' }))
`
}

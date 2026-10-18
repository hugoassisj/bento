// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Every text field, select and textarea in spaces' chrome wears the ONE field look.
//
//   npm run build:single --prefix spaces && node scripts/test-spaces-fields-browser.mjs
//
// A port of scripts/test-slides-fields-browser.mjs: the same measurement, the
// same assertions and the same planted check, on spaces' shell and surfaces.
// The rule under test is the `THE FIELD` block, copied as it stands from
// slides/src/styles.css into spaces/src/styles.css.
//
// WHY. The page inspector's "Also known as" field shipped in the browser's own
// dress — a 2px INSET grey border, square corners, the UA fill. Its class
// (sp-insp-text) missed the panel's sp-insp-txt by a letter and had no rule;
// the template-name field had no class at all; and in dark theme the Replace
// from JSON box was a hard-coded white well under light ink.
//
// WHAT THIS PROVES, measured in the packaged document, in light, dark and
// OS-dark (no stored choice — the @media path):
//   1. every visible field — the page inspector (incl. "Also known as") and a
//      link block's, About, Customise (the design panel), Replace from JSON,
//      Encrypt with password, Import Markdown, the two page exports, Save as
//      template, Add property, search, find & replace, a view's filter →
//      Add condition, the link card, the page picker, the callout icon, the
//      format bar's link field, a comment reply, Share, a DESIGNED space (#559
//      designs re-point the chrome tokens inside the page surface), and the
//      password gate of an encrypted copy — has a 1px SOLID border in the
//      --line colour, a --field fill, a 6px radius, and (single-line fields) a
//      26px height. Tokens are resolved BESIDE each field, so a field inside a
//      design's surface is held to that design's values;
//   2. a focused field shows the amber ring: a 2px solid --accent-ink outline,
//      on every kind of field the walk meets (text, number, select, textarea);
//   3. each surface really opened — a floor on how many fields it shows inside
//      its own container — so a surface that silently failed to open cannot
//      pass by having no fields;
//   4. the check itself works: a field with its author styles reverted (the
//      browser's dress) is planted in the page and must be flagged.
// Native widgets (checkbox, radio, range, file) keep the platform look and are
// skipped. The one deliberate exception is the ghost space name in the bar.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const SHELL = new URL('../spaces/dist-single/Bento_Spaces.bento.html', import.meta.url).href

// Every visible field on the page, with what the rule governs.
function measure(scope) {
  const probeAt = (parent) => {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden'
    parent.appendChild(probe)
    const resolve = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color }
    const tok = { line: resolve('--line'), field: resolve('--field'), ring: resolve('--accent-ink') }
    probe.remove()
    return tok
  }
  const words = (n) => {
    const c = n.cloneNode(true)
    for (const x of c.querySelectorAll('input, select, textarea, output')) x.remove()
    return c.textContent.trim().replace(/\s+/g, ' ')
  }
  const nameOf = (f) => {
    const aria = f.getAttribute('aria-label')
    if (aria) return aria
    if (f.labels?.length && words(f.labels[0])) return words(f.labels[0])
    const row = f.closest('.sp-insp-row')?.querySelector('.sp-insp-lbl')
    if (row) return row.textContent.trim()
    const lbl = f.closest('.sp-field')?.querySelector('.sp-field-lbl')
    if (lbl) return lbl.textContent.trim()
    if (f.placeholder) return `"${f.placeholder}"`
    const near = f.closest('.sp-ab-field, .sp-dsg-row, .sp-row, label')
    if (near && words(near)) return words(near).slice(0, 40)
    return ''
  }
  const rootTok = probeAt(document.body)
  const out = []
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    if (!r.width || !r.height || s.visibility === 'hidden') continue
    const type = el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase()
    if (['checkbox', 'radio', 'range', 'file', 'hidden'].includes(type)) continue
    // the deliberate exception: the ghost space name (boxless at rest)
    if (el.matches('.sp-doctitle')) continue
    const sides = ['Top', 'Right', 'Bottom', 'Left']
    const cls = el.className && `.${String(el.className).trim().split(/\s+/).join('.')}`
    out.push({
      id: `${type}${cls || ''} ${nameOf(el)}`.trim(),
      type,
      styles: sides.map((x) => s[`border${x}Style`]),
      widths: sides.map((x) => s[`border${x}Width`]),
      colors: sides.map((x) => s[`border${x}Color`]),
      bg: s.backgroundColor,
      radius: s.borderTopLeftRadius,
      h: +r.height.toFixed(1),
      tok: el.parentElement ? probeAt(el.parentElement) : rootTok,
      planted: el.hasAttribute('data-planted'),
      inScope: !scope || !!el.closest(scope),
    })
  }
  return { tok: rootTok, fields: out }
}

function problems(f) {
  const tok = f.tok
  const p = []
  if (f.styles.some((x) => x === 'inset' || x === 'outset')) p.push(`${f.styles[0]} border (browser default)`)
  else if (f.styles.some((x) => x !== 'solid')) p.push(`border ${f.styles.join('/')}`)
  if (f.widths.some((w) => w !== '1px')) p.push(`border ${f.widths.join('/')}`)
  if (f.colors.some((c) => c !== tok.line)) p.push(`border ${f.colors[0]} ≠ --line ${tok.line}`)
  if (f.bg !== tok.field) p.push(`fill ${f.bg} ≠ --field ${tok.field}`)
  if (f.radius !== '6px') p.push(`radius ${f.radius}`)
  if (f.type !== 'textarea' && Math.abs(f.h - 26) > 0.5) p.push(`height ${f.h}`)
  return p
}

// ————— driving the shell —————
const visible = (p, sel) => p.locator(sel).filter({ visible: true }).first()
async function menu(p, trigger, label) {
  await visible(p, trigger).click()
  await p.getByRole('menuitem', { name: label }).filter({ visible: true }).first().click()
}
const saveAs = (p, label) => menu(p, 'button[aria-label^="Save as"]', label)
async function openPage(p, title) {
  await p.locator('.sp-treelink', { hasText: title }).first().click()
  await p.waitForTimeout(250)
}
async function showInspector(p) {
  const show = p.locator('button[aria-label^="Show properties"]').filter({ visible: true })
  if (await show.count()) await show.first().click()
  await visible(p, '.sp-insp').waitFor()
}
async function addCondition(p) {
  await openPage(p, 'Tracker')
  await visible(p, '[data-view-filter]').click()
  await p.getByRole('menuitem', { name: /Add condition/ }).first().click()
  await visible(p, '.sp-pop select').waitFor()
}

// each surface gets a fresh page; `open` brings it up, and `min` is the floor
// on how many fields it shows INSIDE `scope` — proof the surface opened at all
const SURFACES = [
  { name: 'page inspector', scope: '.sp-insp', min: 2, must: 'Also known as', open: showInspector },
  { name: 'inspector: link block', scope: '.sp-insp', min: 5, open: async (p) => {
    await openPage(p, 'Tables, pictures and clips')
    await showInspector(p)
    await p.locator('.sp-page [data-block-type="link"], .sp-page .sp-linkcard').first().click()
    await visible(p, '.sp-insp .sp-insp-txt').waitFor()
  } },
  { name: 'inspector: image block', scope: '.sp-insp', min: 2, open: async (p) => {
    await openPage(p, 'Tables, pictures and clips')
    await showInspector(p)
    await p.locator('.sp-page [data-block-id] img').first().click()
    await visible(p, '.sp-insp .sp-insp-num').waitFor()
  } },
  { name: 'About', scope: '[role=dialog]', min: 2, open: async (p) => { await p.locator('.sp-mark').click(); await visible(p, '[role=dialog] select').waitFor() } },
  { name: 'Customise (design panel)', scope: '.sp-dsg-panel', min: 20, open: async (p) => {
    await p.locator('.sp-mark').click()
    await p.getByRole('button', { name: 'Customise…' }).click()
    await visible(p, '.sp-dsg-panel select').waitFor()
  } },
  { name: 'Replace from JSON', scope: '[role=dialog]', min: 1, open: async (p) => { await saveAs(p, /^Replace from JSON/); await visible(p, '[role=dialog] textarea').waitFor() } },
  { name: 'Encrypt with password', scope: '[role=dialog]', min: 2, open: async (p) => { await saveAs(p, /^Encrypt with password/); await visible(p, '[role=dialog] input[type=password]').waitFor() } },
  { name: 'Import Markdown', scope: '[role=dialog]', min: 1, open: async (p) => { await saveAs(p, /^Import Markdown/); await visible(p, '[role=dialog] select').waitFor() } },
  { name: 'Export page as a space', scope: '[role=dialog]', min: 1, open: async (p) => { await saveAs(p, /^Export page as a space/); await visible(p, '[role=dialog] select').waitFor() } },
  { name: 'Export page as slides', scope: '[role=dialog]', min: 1, open: async (p) => { await saveAs(p, /^Export page as slides/); await visible(p, '[role=dialog] select').waitFor() } },
  { name: 'Save as template', scope: '[role=dialog]', min: 1, open: async (p) => { await menu(p, '.sp-rowmore', /^Save as template/); await visible(p, '#sp-tpl-name').waitFor() } },
  { name: 'Add property', scope: '.sp-newprop', min: 2, open: async (p) => {
    await showInspector(p)
    await p.locator('.sp-insp button', { hasText: 'Add property' }).first().click()
    await visible(p, '.sp-newprop input').waitFor()
  } },
  { name: 'search', scope: '[role=dialog]', min: 1, open: async (p) => { await p.locator('button[aria-label^="Search all pages"]').click(); await visible(p, '.sp-find').waitFor() } },
  { name: 'find & replace', scope: '.sp-findbar', min: 2, open: async (p) => {
    await p.locator('.sp-page [contenteditable="true"]').first().click()
    await p.keyboard.press('ControlOrMeta+f')
    await visible(p, '.sp-findbar .sp-find').waitFor()
  } },
  { name: 'view: filter → Add condition', scope: '.sp-pop', min: 3, open: addCondition },
  { name: 'link card', scope: '[role=dialog]', min: 5, open: async (p) => { await menu(p, 'button[aria-label^="Add an image"]', /^Link card/); await visible(p, '[role=dialog] input').waitFor() } },
  { name: 'page picker', scope: '[role=dialog]', min: 1, open: async (p) => { await menu(p, 'button[aria-label^="Add an image"]', /^Link to page/); await visible(p, '.sp-find').waitFor() } },
  { name: 'callout icon', scope: '.sp-tonerow', min: 1, open: async (p) => {
    await openPage(p, 'Writing')
    await visible(p, '.sp-callout-chip').click()
    await visible(p, '.sp-toneicon').waitFor()
  } },
  { name: 'format bar link', scope: '.sp-fmt', min: 1, open: async (p) => {
    // select a paragraph's words, then ⌘K: with a selection it is "link", not "search"
    const para = p.locator('.sp-page [data-block-id] [contenteditable="true"]').first()
    await para.click()
    await para.evaluate((n) => { const r = document.createRange(); r.selectNodeContents(n); getSelection().removeAllRanges(); getSelection().addRange(r) })
    await p.waitForTimeout(150)
    await p.keyboard.press('ControlOrMeta+k')
    await visible(p, '.sp-fmt-url').waitFor()
  } },
  { name: 'comment reply', scope: '.sp-cm-pop', min: 1, open: async (p) => {
    await menu(p, '.sp-rowmore', /^Comment on this page/)
    await visible(p, '.sp-cm-mark').click()
    await visible(p, '.sp-cm-reply').waitFor()
  } },
  { name: 'Share', scope: '.sp-share-name', min: 1, open: async (p) => { await p.locator('.sp-live').first().click(); await visible(p, '.sp-share-name input').waitFor() } },
  // a designed space re-points --field/--line/--accent-ink inside the page
  // surface (designs.css); the chrome around it keeps the app's
  { name: 'designed space (Ledger): filter → Add condition', scope: '.sp-pop', min: 3, open: async (p) => {
    await p.locator('.sp-mark').click()
    await p.locator('[role=dialog] [data-design="ledger"]').click()
    await p.keyboard.press('Escape')
    await p.waitForFunction(() => document.querySelector('[data-sp-design]'))
    await addCondition(p)
  } },
]

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const work = mkdtempSync(join(tmpdir(), 'sp-fields-'))
try {
  // 'os-dark' stores no choice and lets the OS scheme decide: the @media path
  for (const theme of ['light', 'dark', 'os-dark']) {
    console.log(`\n${theme} theme\n`)
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme === 'light' ? 'light' : 'dark' })
    if (theme !== 'os-dark') {
      await ctx.addInitScript((th) => { try { localStorage.setItem('bento-theme', th) } catch {} }, theme)
    }
    await ctx.route(/^https?:/, (r) => r.abort())
    const fresh = async (url = SHELL) => {
      const p = await ctx.newPage()
      // a prompt (the comment author and text) gets an answer; anything else is declined
      p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Field probe') : d.dismiss()))
      p.on('pageerror', (e) => ok(false, `no page error (${e.message})`))
      await p.goto(url)
      await p.waitForFunction(() => window.bento?.doc && document.querySelector('.sp-mark'))
      await p.waitForTimeout(200)
      return p
    }

    const p0 = await fresh()
    const dark = await p0.evaluate(() => {
      const probe = document.createElement('span'); probe.style.color = 'var(--field)'; document.body.append(probe)
      const c = getComputedStyle(probe).color; probe.remove(); return c !== 'rgb(255, 255, 255)'
    })
    ok(dark === (theme !== 'light'), `the page is in ${theme} theme (--field ${dark ? 'dark' : 'white'})`)
    await p0.close()

    let total = 0
    const ringDone = new Set()
    const ring = async (p, scope) => {
      for (const sel of ['input[type="text"]', 'input[type="number"]', 'input[type="url"]', 'input[type="password"]', 'select', 'textarea']) {
        if (ringDone.has(sel)) continue
        const r = await p.evaluate(([sel, scope]) => {
          const el = [...document.querySelectorAll(`${scope} ${sel}`)].find((e) => e.getBoundingClientRect().width && !e.matches('.sp-doctitle'))
          if (!el) return null
          el.focus({ focusVisible: true })
          const s = getComputedStyle(el)
          const probe = document.createElement('span')
          probe.style.color = 'var(--accent-ink)'
          el.parentElement.appendChild(probe)
          const want = getComputedStyle(probe).color
          probe.remove()
          return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, want, focusVisible: el.matches(':focus-visible') }
        }, [sel, scope])
        if (!r) continue
        ringDone.add(sel)
        ok(r.focusVisible && r.style === 'solid' && r.width === '2px' && r.color === r.want,
          `focused ${sel} shows the amber ring (${r.width} ${r.style} ${r.color}, want ${r.want})`)
      }
    }
    for (const s of SURFACES) {
      const p = await fresh()
      let res
      try {
        await s.open(p)
        await p.waitForTimeout(250)
        // measure the resting look, not a field the surface focused itself
        await p.evaluate(() => { const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) a.blur() })
        res = await p.evaluate(measure, s.scope)
      } catch (e) {
        ok(false, `${s.name}: opens (${e.message.split('\n')[0]})`)
        await p.close()
        continue
      }
      const bad = res.fields.map((f) => [f, problems(f)]).filter(([, pr]) => pr.length)
      total += res.fields.length
      const own = res.fields.filter((f) => f.inScope)
      ok(own.length >= s.min && bad.length === 0,
        `${s.name}: ${own.length} field(s) of its own (floor ${s.min}), all ${res.fields.length} on the page in the field look` +
        own.map((f) => `\n          · ${f.id}`).join('') +
        bad.map(([f, pr]) => `\n          ${f.id}: ${pr.join('; ')}`).join(''))
      if (s.must) ok(own.some((f) => f.id.endsWith(` ${s.must}`)), `${s.name}: the "${s.must}" field is among them`)
      await ring(p, s.scope)
      await p.close()
    }

    // THE PASSWORD GATE: an encrypted copy boots into a password card, and
    // its field is chrome too. Encrypt through the dialog, then open the bytes.
    {
      const p = await fresh()
      try {
        await saveAs(p, /^Encrypt with password/)
        const pw = p.locator('[role=dialog] input[type=password]')
        for (let i = 0; i < await pw.count(); i++) await pw.nth(i).fill('correct horse battery')
        await pw.last().press('Enter')
        await pw.first().waitFor({ state: 'detached' })
        const html = await p.evaluate(async () => await window.bento.serializeAuto())
        const file = join(work, `enc-${theme}.bento.html`)
        writeFileSync(file, html)
        const gate = await ctx.newPage()
        gate.on('pageerror', (e) => ok(false, `no page error on the gate (${e.message})`))
        await gate.goto(pathToFileURL(file).href)
        await gate.locator('.sp-gate-card input[type=password]').filter({ visible: true }).first().waitFor({ timeout: 15000 })
        const res = await gate.evaluate(measure, '.sp-gate-card')
        const own = res.fields.filter((f) => f.inScope)
        const bad = res.fields.map((f) => [f, problems(f)]).filter(([, pr]) => pr.length)
        total += res.fields.length
        ok(own.length >= 1 && bad.length === 0, `password gate: ${own.length} field(s) of its own (floor 1), all in the field look` +
          bad.map(([f, pr]) => `\n          ${f.id}: ${pr.join('; ')}`).join(''))
        await gate.close()
      } catch (e) { ok(false, `password gate: opens (${e.message.split('\n')[0]})`) }
      await p.close()
    }
    ok(total >= 90, `${total} fields measured across ${SURFACES.length + 1} surfaces`)
    for (const sel of ['input[type="text"]', 'input[type="number"]', 'select', 'textarea']) {
      ok(ringDone.has(sel), `the focus ring was checked on a ${sel}`)
    }

    // 4. the check catches the browser's dress: plant a field whose author
    //    styles are reverted, and it must come back with problems
    const p = await fresh()
    await showInspector(p)
    const planted = await p.evaluate(() => {
      const el = document.createElement('input')
      el.setAttribute('data-planted', '')
      el.style.all = 'revert'
      document.querySelector('.sp-insp, body').appendChild(el)
      return true
    }) && (await p.evaluate(measure))
    const pf = planted.fields.find((f) => f.planted)
    const pr = pf ? problems(pf) : []
    ok(pf && pr.some((x) => /browser default|fill|radius/.test(x)), `a browser-dressed field is flagged (${pr.join('; ') || 'not flagged'})`)
    await p.close()
    await ctx.close()
  }
} finally {
  await browser.close()
  rmSync(work, { recursive: true, force: true })
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)

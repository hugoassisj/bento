// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Find and replace opens from the toolbar button, ⌘F and Ctrl+F.
//
//   npm run build:single --prefix type && node scripts/test-type-find-browser.mjs
//
// WHY. The find box lives in the Navigate tab's Results view. find.ts opened
// it by clicking `.t-tabs button[data-tab="find"]`, a tab that no longer
// existed: the selector matched nothing, nothing threw, and the button and ⌘F
// did nothing at all. Find was reachable only by opening Navigate → Results
// by hand. A node rig cannot see that, so this one uses the packaged editor
// and real input.
//
// WHAT THIS PROVES, for each way of opening find, from each starting state
// (side panel hidden, the Review tab showing, the Pages view showing): the
// find box ends up on screen, it has the keyboard focus, and typing in it
// really searches (the count reports matches).
//
// Mutation (run, judged by exit code): restore the old `data-tab="find"`
// selector in find.ts showPanel → every opening row goes red.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0, failures = 0
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`  FAIL  ${m}`) } else console.log(`  ok    ${m}`) }

const SHELL = new URL('../type/dist-single/Bento_Type.bento.html', import.meta.url).href
const OPENERS = {
  'the toolbar button': (p) => p.click('#tool-find'),
  '⌘F': (p) => p.keyboard.press('Meta+f'),
  'Ctrl+F': (p) => p.keyboard.press('Control+f'),
}
const STARTS = {
  'the editor as it opens': async () => {},
  'the side panel hidden': async (p) => {
    await p.click('#sidebar')
    await p.waitForFunction(() => document.querySelector('.t-main').classList.contains('t-side-off'))
  },
  'the Review tab showing': (p) => p.click('.t-tabs button[data-tab="review"]'),
  'the Pages view showing': (p) => p.click('#navSeg button[data-view="pages"]'),
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const [startName, start] of Object.entries(STARTS)) {
    for (const [openName, open] of Object.entries(OPENERS)) {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(SHELL)
      await p.waitForFunction(() => window.bento?.doc && document.querySelector('#paper p[data-kind=para]'))
      // the caret in the document, where a person is when they reach for ⌘F
      const bb = await p.locator('#paper p[data-kind=para]').first().boundingBox()
      await p.mouse.click(bb.x + 4, bb.y + bb.height / 2)
      await start(p)
      const hiddenBefore = await p.evaluate(() => !document.querySelector('.t-find-q').getBoundingClientRect().width)
      await open(p)
      await p.waitForTimeout(200)
      const s = await p.evaluate(() => {
        const q = document.querySelector('.t-find-q'), r = q.getBoundingClientRect()
        return { shown: r.width > 0 && r.height > 0, focused: document.activeElement === q }
      })
      await p.keyboard.type('Payment')
      await p.waitForTimeout(300)
      const count = await p.evaluate(() => document.querySelector('.t-find-count')?.textContent?.trim() ?? '')
      ok(hiddenBefore && s.shown && s.focused && /[1-9]/.test(count),
        `from ${startName}, ${openName} opens find: the box was hidden, is now on screen (${s.shown}) and focused (${s.focused}), and typing searches ("${count}")`)
      await p.close()
    }
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)

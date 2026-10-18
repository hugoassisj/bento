#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The bento/id privacy notice and web account-deletion page.
//
//   node scripts/test-id-pages-browser.mjs
//
// Build rules: a publishing build refuses any page that still carries a
// __PLACEHOLDER__ (a privacy notice reading "__CONTROLLER__" must never go
// live), and the deletion page carries exactly one CSP whose hashes match its
// inline script and style, with connect-src the directory alone.
// In Chromium, with the directory API mocked: the deletion flow (start →
// code → done), its refusals, that it never says whether an address exists,
// and that the CSP really blocks every other origin.
import { build, FACT_KEYS } from './build-id-pages.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
let fails = 0, passes = 0
const ok = (c, n) => { if (c) passes++; else { fails++; console.log('FAIL ' + n) } }
const FACTS = Object.fromEntries(FACT_KEYS.map((k) => [k, `fact-${k.toLowerCase()}`]))
FACTS.CONTACT_EMAIL = 'privacy@bento.page'

// ---- build rules ----
let refused = ''
try { build({ facts: {} }) } catch (e) { refused = e.message }
ok(/__[A-Z_]+__/.test(refused), `a publishing build with no facts is refused (${refused.slice(0, 60)})`)
for (const k of FACT_KEYS) {
  const partial = { ...FACTS }; delete partial[k]
  let r = ''
  try { build({ facts: partial }) } catch (e) { r = e.message }
  ok(r.includes(`__${k}__`), `missing ${k} → refused`)
}
let bad = ''
try { build({ facts: { ...FACTS, CONTROLLER: '__X__' } }) } catch (e) { bad = e.message }
ok(/CONTROLLER/.test(bad), 'a fact that is itself a placeholder → refused')
let http = ''
try { build({ facts: FACTS, api: 'http://id.bento.page' }) } catch (e) { http = e.message }
ok(/https/.test(http), 'a non-https API → refused')
const pages = build({ facts: FACTS })
ok(!/__[A-Z0-9_]+__/.test(pages.privacy + pages.delete), 'a complete build leaves no placeholder')
ok(pages.privacy.includes('privacy@bento.page') && pages.privacy.includes('fact-controller'), 'facts are substituted into the notice')
ok(build({ facts: { ...FACTS, CONTROLLER: '<b>x</b>' } }).privacy.includes('&lt;b&gt;x&lt;/b&gt;'), 'facts are HTML-escaped')
ok(/connect-src https:\/\/id\.bento\.page;/.test(pages.csp) && /default-src 'none'/.test(pages.csp) && /form-action 'none'/.test(pages.csp), `CSP: default none, connect only to the directory, no form posts (${pages.csp.slice(0, 50)}…)`)
const prev = build({ preview: true })
ok(prev.privacy.includes('__CONTROLLER__'), 'a preview build keeps placeholders visible')
for (const must of ['What the directory stores', 'What it never stores', 'Amazon SES', '/id/delete', '13 months']) {
  ok(pages.privacy.includes(must), `notice says: ${must}`)
}

// ---- the deletion page in Chromium ----
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const page = await browser.newPage()
const seen = []
const bodies = []
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('request', (r) => seen.push(r.url()))
await page.route('https://bento.page/id/delete', (r) => r.fulfill({ contentType: 'text/html', body: pages.delete }))
await page.route('https://id.bento.page/**', async (r) => {
  const req = r.request()
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } })
  const b = JSON.parse(req.postData() || '{}')
  bodies.push({ path: new URL(req.url()).pathname, b })
  const cors = { 'access-control-allow-origin': '*' }
  if (req.url().endsWith('/v1/delete/start')) return r.fulfill({ status: 202, headers: cors, contentType: 'application/json', body: '{"ok":true}' })
  if (req.url().endsWith('/v1/delete/complete')) {
    return b.code === 'ABCDEFGH' ? r.fulfill({ status: 204, headers: cors }) : r.fulfill({ status: 400, headers: cors, contentType: 'application/json', body: '{"error":"invalid"}' })
  }
  return r.fulfill({ status: 404, headers: cors })
})
await page.route('https://evil.example/**', (r) => r.fulfill({ status: 200, body: 'reached' }))
await page.goto('https://bento.page/id/delete')

const status = () => page.textContent('#status')
await page.fill('#email', 'not-an-address')
await page.click('#send')
ok(/Enter the email/.test(await status()), 'a malformed address is refused before any request')
ok(bodies.length === 0, 'no request for a malformed address')

await page.fill('#email', 'Someone@Example.com')
await page.click('#send')
await page.waitForSelector('#step-code:not([hidden])')
ok(bodies[0]?.path === '/v1/delete/start' && JSON.stringify(bodies[0].b) === '{"email":"Someone@Example.com"}', 'start sends exactly {email}')
ok(/If Someone@Example\.com has a bento\/id, we’ve sent it a code/.test(await page.textContent('#sent')), 'the page never says whether the address exists')

await page.fill('#code', 'abc')
await page.click('#confirm')
ok(/8 letters and numbers/.test(await status()) && bodies.length === 1, 'a malformed code is refused before any request')
await page.fill('#code', 'ABCDEFGL') // L is not in the code alphabet
await page.click('#confirm')
ok(bodies.length === 1, 'a code outside the alphabet (L) is refused before any request')
await page.fill('#code', 'zzzzzzzz')
await page.click('#confirm')
await page.waitForFunction(() => /didn’t work/.test(document.getElementById('status').textContent))
ok(bodies[1]?.b.code === 'ZZZZZZZZ', 'the code is sent uppercased')
await page.fill('#code', 'abcdefgh')
await page.click('#confirm')
await page.waitForFunction(() => /Done/.test(document.getElementById('status').textContent))
ok(/removed from the directory/.test(await status()), 'the right code → done')
ok(JSON.stringify(bodies[2]?.b) === '{"email":"Someone@Example.com","code":"ABCDEFGH"}', 'complete sends exactly {email, code}')

const blocked = await page.evaluate(() => fetch('https://evil.example/x').then(() => 'reached', () => 'blocked'))
ok(blocked === 'blocked', 'the CSP blocks a request to any other origin')
const inline = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.body.appendChild(s); return window.__ran === 1 })
ok(!inline, 'the CSP blocks an injected inline script')
ok(seen.every((u) => u.startsWith('https://bento.page/id/delete') || u.startsWith('https://id.bento.page/')), `the page reached only itself and the directory (${[...new Set(seen.map((u) => new URL(u).host))]})`)
ok(errors.length === 0, `no page errors (${errors})`)

await browser.close()
console.log(`${passes} passed, ${fails} failed`)
process.exit(fails)

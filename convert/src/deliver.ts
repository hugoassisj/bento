// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Delivery: a converted document, into a verified shell, safely.
//
// Shared by the CLI (convert/cli.mjs) and the public import page
// (site-src/import/), so the two can never disagree about what makes a
// converted file safe to hand someone. Three steps, each refusing rather than
// degrading:
//
// 1. A SHELL WE CAN VOUCH FOR. The current slides release, fetched the way the
//    home hosts fetch one for a new document: the signed manifest verified with
//    `verifySigned` (kernel/src/update.ts — its own comment calls it the ONLY
//    release-channel crypto in the kernel, and a second implementation "a
//    second thing to get wrong", so this reuses it rather than mirroring it the
//    way the unbundled webext must), then the shell's bytes checked against the
//    signed sha256 pin by `fetchPinned`. A shell that fails anything is
//    REFUSED. There is no "use it anyway".
//
// 2. A DOCUMENT GATED LIKE ANY FOREIGN ONE. A .pptx is attacker-controlled
//    input — typeface names, text, slide names and notes all flow from it into
//    the document. The converted document meets the SAME gate slides applies to
//    every other foreign document, composed exactly as the existing intakes do:
//    slides through `sanitizeSlide` with the drop report (compactload.ts),
//    `sanitizeAssets` and `sanitizeFonts` (editor/clipboard.ts), then the top
//    level through `parseDoc` (compactload.ts again). No new rule is invented
//    here — a second copy of a security rule is how the two drift.
//
// 3. A SPLICE THAT HONOURS THE CONTRACT. The document goes into the shell's
//    empty #bento-doc block with every `<` escaped (`<`), exactly as
//    kernel/src/save.ts writes it, and the <title> is set the same way.
//
//    NOT `serializeWith`, and deliberately. serializeWith also renders a
//    first-page thumbnail, which needs slides' renderer and a DOM: the CLI has
//    no DOM, and dragging the renderer onto the public page would multiply the
//    code security has to review for a thumbnail. And it is what the hosts do
//    for a new document anyway — home/webext writes the raw verified shell
//    bytes, preview-less. The app writes the thumbnail on the first save, as it
//    does for every new document.

import { configureApp } from '../../kernel/src/app.ts'
import { verifySigned, fetchPinned, compareVersions } from '../../kernel/src/update.ts'
import { parseDoc, type BentoDoc, type Slide } from '../../slides/src/model.ts'
import {
  sanitizeAssets, sanitizeFonts, sanitizeSlide, withDropReport, withPathSegment, type Dropped,
} from '../../slides/src/untrusted.ts'

export const SLIDES_MANIFEST = 'https://bento.page/releases/slides/manifest.json'

/**
 * THE OLDEST SHELL A CONVERTED FILE MAY BE BUILT ON. A converted deck carries
 * its shell for good, so a shell with a fixed security hole must never be
 * handed out again, even by a validly signed manifest (a stale mirror or a
 * cached manifest still verifies). Bump this in the release that ships a
 * security fix, to that release's version. scripts/release.mjs refuses a
 * release older than this floor, so the page can never refuse its own release.
 */
export const MIN_SHELL_VERSION = '1.2.5'
const APP_ID = 'bento-slides'

/** Every Bento app, by the id its shells carry (`<meta name="generator">`)
 *  and its signed manifest declares: where its releases live, its name, and
 *  the document format it writes. An app with no published release yet has
 *  no manifest there, and a rescue onto it says so. */
export const APPS: Record<string, { key: string; name: string; format: string }> = {
  'bento-slides': { key: 'slides', name: 'bento/slides', format: 'bento/slides' },
  'bento-spaces': { key: 'spaces', name: 'bento/spaces', format: 'bento/spaces' },
  'bento-dash': { key: 'dash', name: 'bento/dash', format: 'bento/dash' },
  'bento-type': { key: 'type', name: 'bento/type', format: 'bento/type' },
}
/** The oldest release of each app that can OPEN a password-protected file.
 *  Slides 1.2.0–1.2.8 shipped a loader that refuses every path over the
 *  password gate, so moving an encrypted deck onto one of those would hand
 *  back a file exactly as broken as the one dropped. */
export const ENC_OPEN_MIN: Record<string, string> = { 'bento-slides': '1.2.9' }
export const opensEncrypted = (appId: string, version: string) =>
  !ENC_OPEN_MIN[appId] || compareVersions(version, ENC_OPEN_MIN[appId]) >= 0

/** The signed manifest's path for an app, relative to bento.page. */
export const manifestPath = (appId: string) => `/releases/${APPS[appId].key}/manifest.json`

// verifySigned reads the app identity (and a fork's key override) from
// configureApp. Calling it here makes this module self-sufficient; the values
// are the upstream slides identity, the same ones slides/src/main.ts sets.
configureApp({ appId: APP_ID, appName: 'bento/slides', manifestUrl: SLIDES_MANIFEST })

export interface VerifiedShell {
  version: string
  html: string
}

/**
 * The current slides shell, or an Error that says which link of the chain
 * failed. Signature over the pin, pin over the bytes — both, or nothing.
 */
export async function fetchVerifiedShell(
  manifestUrl = SLIDES_MANIFEST,
  net: typeof fetch = fetch,
  /**
   * Map the signed shell URL to the one actually fetched. The public page uses
   * this to fetch from its OWN origin, so its `connect-src 'self'` CSP holds.
   * Safe by construction: trust comes from the signature over the pin and the
   * pin over the bytes, never from the URL, so a resolved URL that serves
   * different bytes is refused by fetchPinned exactly as a tampered CDN would be.
   */
  resolve: (url: string) => string = (u) => u,
  /** the app whose shell this must be; the signed payload's app must match */
  appId: string = APP_ID,
): Promise<VerifiedShell> {
  const res = await net(manifestUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`could not reach the release server (${res.status})`)
  // The payload shape, restated from kernel/src/update.ts's (private)
  // verifyManifest. The CRYPTO is verifySigned's alone; this is only "is the
  // signed payload a slides release".
  const info = (await verifySigned(await res.text(), 'release manifest')) as Record<string, unknown>
  if (
    info?.app !== appId ||
    typeof info.version !== 'string' ||
    typeof info.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(info.sha256) ||
    typeof info.url !== 'string'
  ) throw new Error('the release manifest payload is malformed — refusing it')
  // Before the shell is fetched: an old release is refused without downloading
  // it. A version that is not plain dotted numbers is refused outright, because
  // compareVersions would read its non-numeric parts as 0.
  if (!/^\d+(\.\d+)*$/.test(info.version))
    throw new Error(`the release server offered a bento/slides version this converter does not recognise ("${info.version.slice(0, 40)}") — refusing it.`)
  const floor = appId === APP_ID ? MIN_SHELL_VERSION : undefined
  if (floor && compareVersions(info.version, floor) < 0)
    throw new Error(`the release server offered ${APPS[appId]?.name ?? appId} ${info.version}, which is older than ${floor}, the oldest version this converter will build on — refusing it. Try again later.`)
  const bytes = await fetchPinned(resolve(info.url), info.sha256)
  if (!bytes) throw new Error('the downloaded shell does not match its signed pin — refusing it')
  return { version: info.version, html: new TextDecoder().decode(bytes) }
}

export interface GateResult {
  doc: BentoDoc
  dropped: Dropped[]
}

/** The untrusted-input gate over a whole converted document (see header §2). */
export function gateDoc(raw: unknown): GateResult {
  if (!raw || typeof raw !== 'object') throw new Error('not a document')
  const src = raw as Record<string, unknown>
  const { result: slides, dropped } = withDropReport(() =>
    ((Array.isArray(src.slides) ? src.slides : []) as unknown[])
      .map((s, i) => withPathSegment('slides', () => withPathSegment(String(i), () => sanitizeSlide(s))))
      .filter((s): s is Slide => s !== null))
  const gated = { ...src, slides, assets: sanitizeAssets(src.assets), fonts: sanitizeFonts(src.fonts) }
  const doc = parseDoc(JSON.stringify(gated))
  if (!doc) throw new Error('the converted document did not pass the format check')
  return { doc, dropped }
}

const BLOCK_OPEN = '<script type="application/bento+json" id="bento-doc">'
// assembled so this source never contains the literal close tag (PLATFORM
// hard-won detail #4 — the same reason save.ts builds it by concatenation)
const SCRIPT_CLOSE = '</' + 'script>'

/**
 * Splice `doc` into a shell's #bento-doc block, the way save.ts writes it.
 * Refuses a shell without exactly one block, and verifies the result by
 * reading the block back.
 */
export function spliceIntoShell(shellHtml: string, doc: BentoDoc): string {
  const first = shellHtml.indexOf(BLOCK_OPEN)
  if (first < 0 || shellHtml.indexOf(BLOCK_OPEN, first + 1) >= 0)
    throw new Error('the shell does not carry exactly one #bento-doc block')
  const start = first + BLOCK_OPEN.length
  const end = shellHtml.indexOf(SCRIPT_CLOSE, start)
  if (end < 0) throw new Error('the #bento-doc block is not closed')
  const body = '\n' + JSON.stringify(doc).replace(/</g, '\\u003c') + '\n'
  let out = shellHtml.slice(0, start) + body + shellHtml.slice(end)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(doc.title)} — bento/slides</title>`)
  // Belt: the close-tag count must not change, and the block must read back
  // as exactly the document we wrote.
  if (out.split(SCRIPT_CLOSE).length !== shellHtml.split(SCRIPT_CLOSE).length)
    throw new Error('splice changed the script-close count — refusing the output')
  if (JSON.stringify(extractDoc(out)) !== JSON.stringify(doc))
    throw new Error('the spliced document does not read back identically')
  return out
}

/** Read the #bento-doc block of a saved file, parsed. */
export function extractDoc(html: string): unknown {
  const first = html.indexOf(BLOCK_OPEN)
  if (first < 0) throw new Error('not a Bento file (no #bento-doc block)')
  const start = first + BLOCK_OPEN.length
  const end = html.indexOf(SCRIPT_CLOSE, start)
  if (end < 0) throw new Error('the #bento-doc block is not closed')
  const text = html.slice(start, end).trim()
  if (!text) throw new Error('the #bento-doc block is empty — a fresh shell, not a deck')
  try { return JSON.parse(text) } catch { throw new Error('the #bento-doc block is not valid JSON') }
}

// --- rescue: the same document, in the latest shell of its own app ----------
//
// A file whose shell cannot boot cannot update itself (About → Update runs
// inside the app). The rescue does what the self-updater does, without the
// app: put the file's document into the newest signed shell of the SAME app.
// The document block is carried VERBATIM, byte for byte, never parsed into a
// document and never re-serialised. So an encrypted file's bento/enc envelope
// stays exactly as it was: no password is asked for, nothing is decrypted.
//
// What is carried: the #bento-doc block, and (for an unencrypted file only)
// the file's own <title>.
// What is not: anything else the old shell held. Language packs
// (application/bento+lang) are reported, and can be added again from About;
// a first-page preview is regenerated on the next save (and encrypted files
// never have one).

const DOC_ID_ATTR = ' id="bento-doc"'

/** The raw text of the one #bento-doc block, exactly as written, with where
 *  it sits. Found the way the kernel finds it (save.ts embeddedDocBlock: the
 *  exact id attribute with a leading space, then the next script close). */
function docBlock(html: string): { start: number; end: number; body: string } {
  const at = html.indexOf(DOC_ID_ATTR)
  if (at < 0) throw new Error('not a Bento file (no #bento-doc block)')
  if (html.indexOf(DOC_ID_ATTR, at + 1) >= 0) throw new Error('the file carries more than one #bento-doc block')
  const tagStart = html.lastIndexOf('<script', at)
  const gt = html.indexOf('>', at)
  if (tagStart < 0 || gt < 0 || !/type="application\/bento\+json"/.test(html.slice(tagStart, gt)))
    throw new Error('the #bento-doc block is not a Bento data block')
  const end = html.indexOf(SCRIPT_CLOSE, gt + 1)
  if (end < 0) throw new Error('the #bento-doc block is not closed')
  return { start: gt + 1, end, body: html.slice(gt + 1, end) }
}

/** Which app a saved file belongs to: its shell's generator, or, for an
 *  unencrypted file from a shell that predates the generator tag, the
 *  document's own format. Null when neither says. */
export function fileApp(html: string): string | null {
  const gen = /<meta\s+name="generator"\s+content="(bento-[a-z]+)"/i.exec(html.slice(0, 64 * 1024))?.[1]
  if (gen && APPS[gen]) return gen
  try {
    const fmt = (JSON.parse(docBlock(html).body.trim()) as { format?: unknown }).format
    for (const [id, a] of Object.entries(APPS)) if (a.format === fmt) return id
  } catch { /* fall through */ }
  return null
}

export interface Rescued {
  html: string
  /** the block held a bento/enc envelope: carried unopened */
  encrypted: boolean
  /** language-pack blocks the old file carried that the new one does not */
  packsLeft: number
}

/**
 * Put `fileHtml`'s document block, byte for byte, into `shellHtml`, a
 * verified shell of the same app. Refuses rather than guesses:
 * - the block must be in the form Bento writes, with no `<` at all (every
 *   Bento writer escapes it), so it cannot change how the new shell parses;
 * - it must be JSON naming a bento/ format;
 * - the shell must belong to `appId`, and so must the file.
 * The belts are the same as the other splice: the script-close count is
 * unchanged, and the block reads back exactly as it was.
 */
export function spliceVerbatim(shellHtml: string, fileHtml: string, appId: string): Rescued {
  const src = docBlock(fileHtml)
  if (!src.body.trim()) throw new Error('the file has an empty document block: a fresh app, not a saved document')
  if (src.body.includes('<')) throw new Error('the document block is not in the form Bento writes, so it is not carried')
  let fmt: unknown
  try { fmt = (JSON.parse(src.body.trim()) as { format?: unknown }).format } catch {
    throw new Error('the document block is not valid JSON')
  }
  if (typeof fmt !== 'string' || !fmt.startsWith('bento/')) throw new Error('the document block is not a Bento document')
  const encrypted = fmt === 'bento/enc'
  const own = fileApp(fileHtml)
  if (own !== appId) throw new Error(`this file belongs to ${own ? APPS[own].name : 'an unknown app'}, not ${APPS[appId]?.name ?? appId}`)
  if (!encrypted && fmt !== APPS[appId].format) throw new Error(`the document is ${fmt}, but the file's app is ${APPS[appId].name}`)
  const shellGen = /<meta\s+name="generator"\s+content="(bento-[a-z]+)"/i.exec(shellHtml.slice(0, 64 * 1024))?.[1]
  if (shellGen !== appId) throw new Error(`the downloaded shell is ${shellGen ?? 'unmarked'}, not ${appId}`)
  const dst = docBlock(shellHtml)
  let out = shellHtml.slice(0, dst.start) + src.body + shellHtml.slice(dst.end)
  // the file's own title, when it is plain text (a <title> is raw text, so
  // anything with < in it is left out rather than escaped into something else),
  // and NEVER for an encrypted body: builds before 1.2.9 wrote an encrypted
  // deck's real title into <title> in clear, so carrying it would re-publish
  // the very thing the password hides. Those keep the shell's neutral title.
  const title = encrypted ? undefined : /<title>([^<]*)<\/title>/.exec(fileHtml)?.[1]
  if (title !== undefined) out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
  if (out.split(SCRIPT_CLOSE).length !== shellHtml.split(SCRIPT_CLOSE).length)
    throw new Error('splice changed the script-close count — refusing the output')
  if (docBlock(out).body !== src.body) throw new Error('the document block does not read back byte for byte — refusing the output')
  const packs = (fileHtml.match(/<script[^>]*type="application\/bento\+lang"/g) ?? []).length
  return { html: out, encrypted, packsLeft: packs }
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Colours as the deck writes them: parse, resolve palette references, measure
// contrast. Plain functions over strings, no import from the app's sources, so
// the skill folder stands alone. The palette maths mirror slides/src/palette.ts
// (paletteOf, shiftLightness, keepAlpha); scripts/test-skill-cli.ts holds the
// two to the same answers on the starter deck.

const NAMED = Object.fromEntries((
  'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 ' +
  'blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 ' +
  'chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b ' +
  'darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b ' +
  'darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f ' +
  'darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 ' +
  'deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 ' +
  'fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f ' +
  'grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa ' +
  'lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff ' +
  'lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a ' +
  'lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 ' +
  'lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd ' +
  'mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a ' +
  'mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 ' +
  'navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 ' +
  'palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 ' +
  'peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f ' +
  'royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d ' +
  'silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f ' +
  'steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 ' +
  'white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32'
).split(' ').reduce((acc, w, i, all) => (i % 2 ? acc : [...acc, [w, all[i + 1]]]), []))

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const num = (s, scale) => {
  const t = s.trim()
  if (/^[-+]?(\d+\.?\d*|\.\d+)%$/.test(t)) return (parseFloat(t) / 100) * scale
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return parseFloat(t)
  return NaN
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v } }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255) }
}

function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6
  else if (max === G) h = ((B - R) / d + 2) / 6
  else h = ((R - G) / d + 4) / 6
  return { h, s, l }
}

/** A CSS colour → { r, g, b, a } (a in 0..1), or null when it is not one we can read. */
export function parseColour(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (Object.hasOwn(NAMED, s)) { const h = NAMED[s]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 } }
  let m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (m) {
    let h = m[1]
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s)
  if (!m) return null
  const parts = m[2].split(/\s*,\s*|\s*\/\s*|\s+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const a = parts.length === 4 ? num(parts[3], 1) : 1
  if (!(a >= 0 && a <= 1)) return null
  if (m[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255))
    if (![r, g, b].every((x) => x >= 0 && x <= 255)) return null
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a }
  }
  const h = parseFloat(parts[0].replace(/deg$/, '')), sat = num(parts[1], 1), l = num(parts[2], 1)
  if (!Number.isFinite(h) || !(sat >= 0 && sat <= 1) || !(l >= 0 && l <= 1)) return null
  return { ...hslToRgb((((h % 360) + 360) % 360) / 360, sat, l), a }
}

/** Is this a colour a style property may hold? Paint keywords count. */
export const isColour = (v) => parseColour(v) !== null || (typeof v === 'string' && /^(none|currentcolor|inherit)$/i.test(v.trim()))

// --- the palette (slides/src/palette.ts) -------------------------------------

export const PALETTE_SLOTS = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

/** The palette a document resolves against, as paletteOf builds it. */
export function paletteOf(doc) {
  const t = doc.theme ?? {}
  const p = t.palette ?? {}
  return {
    bg1: t.background, tx1: t.color, accent1: t.accent,
    bg2: p.bg2 ?? t.color, tx2: p.tx2 ?? t.background,
    accent2: p.accent2 ?? t.accent, accent3: p.accent3 ?? t.accent,
    accent4: p.accent4 ?? t.accent, accent5: p.accent5 ?? t.accent,
    accent6: p.accent6 ?? t.accent,
    hlink: p.hlink, folHlink: p.folHlink,
  }
}

/** The slots a deck actually carries (accent 2–6 and the links only when set). */
export function slotsSet(doc) {
  const p = doc.theme?.palette ?? {}
  return PALETTE_SLOTS.filter((s) => ['bg1', 'tx1', 'accent1'].includes(s) || !!p[s])
}

export function parseThemeRef(token) {
  const m = /^\s*([A-Za-z][A-Za-z0-9]*)\s*(?:([+-])\s*(\d{1,3})\s*%)?\s*(\/a)?\s*$/.exec(token ?? '')
  if (!m || !PALETTE_SLOTS.includes(m[1])) return null
  const n = m[2] ? Math.min(100, Number(m[3])) : 0
  return { slot: m[1], shift: m[2] === '-' ? -n : n }
}

const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(hex).trim())
  if (!m) return null
  let s = m[1]
  if (s.length <= 4) s = s.split('').map((c) => c + c).join('')
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: s.length === 8 ? s.slice(6, 8) : '' }
}

export function shiftLightness(hex, shift) {
  const c = parseHex(hex)
  if (!c || !shift) return hex
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b)
  const t = clamp(shift, -100, 100) / 100
  const nl = t > 0 ? l + (1 - l) * t : l + l * t
  const { r, g, b } = hslToRgb(h, s, clamp(nl, 0, 1))
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${c.a}`
}

/** A palette reference's literal, or null when it does not resolve. */
export function resolveRef(token, palette) {
  const ref = parseThemeRef(token)
  if (!ref) return null
  const base = palette[ref.slot]
  return base ? shiftLightness(base, ref.shift) : null
}

/** A reference names the hue; the property keeps its own opacity. */
export function keepAlpha(current, literal) {
  const c = parseHex(literal)
  if (!c || c.a || typeof current !== 'string') return literal
  const cur = current.trim()
  const aa = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(cur)?.[1]
  if (aa) return aa.toLowerCase() === 'ff' ? literal : literal + aa
  const m = /^rgba?\(([^)]+)\)$/i.exec(cur)
  const a = m ? Number(m[1].split(/[\s,/]+/)[3]) : NaN
  if (!(a >= 0 && a < 1)) return literal
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(a * 1000) / 1000})`
}

// --- contrast (WCAG 2.x) -------------------------------------------------------

const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
export const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

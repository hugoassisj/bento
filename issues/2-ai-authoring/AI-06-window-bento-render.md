---
id: AI-06
title: "`window.bento.render()`: a public slide rasteriser"
epic: 2-ai-authoring
type: enhancement
priority: P2
size: S
evidence: code
labels: [enhancement, "priority:P2", "size:S", "evidence:code", "area:ai"]
depends_on: []
related: [AI-04, AI-05, AS-08, AS-09]
upstream: []
---
## Summary

The app can already draw any slide to a PNG: *Export slides as images* does it. That function is not reachable from `window.bento`, so every outside tool that wants a picture of a slide has to bundle a probe against the repo's sources at build time, which is why `scripts/bento-check.mjs` needs a repo checkout and esbuild. Expose one call, `window.bento.render()`, so any harness that can open the file in a browser can see a slide.

## What the user experiences

An agent with a browser tool (Playwright, a Chrome tool server, the in-editor Assistant) opens a deck and wants to look at slide 3. Today it must enter the slideshow and screenshot, which shows show chrome, depends on window size, plays entrances, and cannot show a state slide or a single build step on demand. In the audit's trial the agent wrote a 60-line Playwright fallback to do this.

## Reproduce

In the running app's console:

```js
Object.keys(window.bento)
// format, doc, read, serialize, undo, redo, selection, anim, i18n, sync, loadDoc,
// compact, validate, measure, sandboxed, updates, schema, comments
```

There is no render, thumbnail or image entry.

## Evidence

Confirmed at `29b5c80`:

- `rasterizeSlide(doc, slide, format, scale, box?)` returns a `Blob` (`slides/src/editor/exportimages.ts:59`); it draws through `slideSvg` (`:84`), which calls the shared `renderSlide(slide, doc, { svgAsImage: true, hidePlaceholders: true })`, so the pixels are the real renderer's.
- It rejects with a `SecurityError` when the canvas is tainted (comment at `exportimages.ts:57-58`).
- The public surface is assembled in `slides/src/main.ts:308-496`; none of its entries rasterise.
- `scripts/bento-check.mjs:88-97` imports `rasterizeSlide`, `exportableSlides` and `pixelSize` from repo sources into a probe it bundles with esbuild: the cost of the missing public call.
- Formats and scales are typed in `slides/src/exportimages.ts:21-24` (`'png' | 'jpeg'`; scales 0.5 to 4).

Not verified: whether the editor's image-export module is already in the initial bundle or loaded on demand, which decides the byte cost.

## How others do it

- Figma's agent skill pairs every design step with a screenshot tool: "one screenshot after composition and one after a visual fix" (https://github.com/figma/mcp-server-guide, `skills/figma-use`).
- Anthropic's presentation skill converts slides to images and makes visual QA a required step.
- A published slide-agent study reports success falling from 95.0% to 74.6% without a rendered view (https://arxiv.org/html/2501.03936v3; figure from the research pass, paper not read during the audit).

## Proposed change

Add to the `window.bento` object in `slides/src/main.ts`:

```ts
render(target?: string | number, opts?: {
  format?: 'png' | 'jpeg'   // default 'png'
  scale?: number            // default 1; clamp to the existing ImageScale set
  step?: number             // build step to show; default = all steps revealed
  doc?: BentoDoc            // render a document that is not loaded, as validate() allows
}): Promise<{ ok: true, dataUrl: string, width: number, height: number, slideId: string }
          | { ok: false, err: 'no-such-slide' | 'tainted' | 'bad-option', detail: string }>
```

- `target` is a slide id or a 1-based index over `doc.slides` (state slides included, the same numbering the outline in AI-07 uses); omitted means the open slide.
- `step`: hide elements where `!shownAt(el, step)` using `slides/src/steps.ts`, so a caller can see each click of a build. The print path will want the same (MP-14).
- Add `renderAll(opts?)` returning the list for every slide in show order plus a contact sheet data URL, or leave the contact sheet to callers; decide by byte cost and say which.
- A tagged result, not a throw, in the style of the Spaces verbs (`docs/spaces-agents.md`, "Results are tagged").
- Read-only: it must not touch the store, the selection, undo, or the canvas.
- Document it in `docs/agents.md` and `site-src/llms.txt`'s verb list.
- Reduce `scripts/bento-check.mjs`'s probe to a call to this when the shell has it, keeping the bundled-probe path for older shells.

Alternatives rejected: a screenshot of the canvas (depends on zoom and chrome); entering the show (side effects, timing).

## Acceptance criteria

- [ ] `await window.bento.render(1)` returns a PNG data URL whose decoded size equals `doc.size` at scale 1.
- [ ] `render('missing-id')` resolves `{ ok: false, err: 'no-such-slide' }` and never throws.
- [ ] A state slide renders by id.
- [ ] With `step: 0` on a slide that has click builds, elements with a later step are absent from the image (compare pixel regions, not styles).
- [ ] Calling `render` changes neither `window.bento.doc`, the selection, nor the undo stack (deep-equal before and after).
- [ ] A slide whose image cannot be read back resolves `{ ok: false, err: 'tainted' }`.
- [ ] `bento-check` uses the public call on a shell that has it.

## Tests

Add `scripts/test-slides-render-api-browser.mjs` (headless Chromium against the built shell), registered in `.github/workflows/ci-slides.yml`. It loads a fixture with a known solid-colour region per slide and per build step, calls `render`, decodes the PNG and samples pixels. Measure decoded pixels; do not assert on DOM or style values.

## Out of scope

Rendering morph frames or animation mid-flight; video; a headless renderer with no browser.

## Notes for the implementer

- Slides zone, no format change, no new strings.
- Report the shell's byte cost. If the image-export module is loaded on demand today, keep it that way and make `render` await the import.
- The surface in `main.ts` sits inside the editor-mode block; say in the PR what a present-only (`readonly`) file exposes, and whether `render` should exist there.
- Charts are live canvases in the show; confirm what `renderSlide` with `svgAsImage` draws for a chart and say so in the docs.

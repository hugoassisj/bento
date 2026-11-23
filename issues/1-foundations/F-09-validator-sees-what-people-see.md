---
id: F-09
title: "Validator sees what people see: contrast, overlap, text outside its frame, clipped chart labels"
epic: 1-foundations
type: enhancement
priority: P1
size: M
evidence: seen
labels: [enhancement, "priority:P1", "size:M", "evidence:seen", "area:validator"]
depends_on: [F-08]
related: [F-07, F-10, AI-16, AS-09, FH-16]
upstream: []
---
## Summary

The validator checks structure and text overflow. It does not check any of the defects a person notices at a glance: unreadable contrast, text boxes on top of each other, text hanging out of the frame that contains it, and chart axis labels cut off. In the AI authoring trial, every visible defect in the agent's deck went unreported. Add those four findings, as advice, never as fixes.

## What the user experiences

- Cream text on a cream slide validates clean.
- Two text boxes overlapping each other validate clean (only their individual overflow, if any, is reported).
- An agent's chart rendered with its y-axis labels clipped to ") MWh"; nothing flagged it.
- A layout-by-role slide given a dark background rendered navy text on navy; zero warnings.

## Reproduce

Console of a fresh load, with `const base = window.bento.read(); const run = (els, bg) => window.bento.validate({ ...base, slides: [{ id: 's1', background: bg ?? '#F2F0EA', elements: els }] }).findings.map(f => f.severity + ':' + f.code)`:

1. Low contrast: `run([{ id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 60, html: '<p>hello</p>', color: '#F2F0EA', fontSize: 20 }])` → no contrast finding.
2. Overlap: `run([{ id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 80, html: '<p>hello there</p>', fontSize: 30 }, { id: 'b', type: 'text', x: 110, y: 110, w: 400, h: 80, html: '<p>overlapping</p>', fontSize: 30 }])` → no overlap finding.

## Evidence

- Observed in the running app during the audit: both probes above returned no relevant finding. The AI trial (its rendered contact sheets) showed clipped chart axis labels, half-empty cards and unreadable dark-on-dark text, all with zero corresponding findings.
- Confirmed in code now:
  - The complete list of codes in `slides/src/validate.ts` is: broken-link, broken-state-parent, chart-key-ignored, collab-secrets-present, dangling-connector, dash-march-no-dash, duplicate-id, embed-*, entrance-on-motion-path, font-not-embedded, inert-countup, missing-asset, morph-key-collision, out-of-canvas, overridden-enter-fx, past-margin, table-overflow, text-overflow, theme-ref-*, token-unknown, unknown-key, unreachable-hidden-slide. None is visual beyond overflow and geometry against the canvas.
  - A contrast reader already exists and is model-level: `slides/src/editor/inspector/contrast.ts:106` `measureContrast(el, slide, n, areas)` samples the element's colour against whatever is beneath it in z-order and the slide background, and returns the worst ratio. The Export section uses it (`editor/inspector/export.ts:185`), passing glyph areas measured from the DOM for text.
  - Frame membership is model data (`parentId`, `layout`), and the layout pass is in `slides/src/layout.ts`.
- Not verified: how chart label clipping can be detected. The chart engine lives in the kernel (`kernel/src/charts.ts`); whether it can report its own label overflow without a kernel change is unknown. Treat that check as a separate step (see below).

## How others do it

- PowerPoint: the Accessibility Checker reports hard-to-read text contrast per slide, with a jump to the object; Designer and Review Presentation flag crowded slides.
- Figma: plugins and Dev Mode report contrast as a ratio against the actual backdrop, not a guess.

## Proposed change

All findings are `warning` or `info`, carry `slide`, `element` and `path`, and state the measured number.

1. **`low-contrast`** (warning). For text elements (and shapes carrying text-like meaning only if cheap), call `measureContrast` with the element's slide. Without a DOM, measure against the whole box; with a DOM, pass the glyph areas the same way `export.ts` does (lift that area computation into a shared helper rather than copying it). Thresholds: below 3:1 always; below 4.5:1 when `fontSize` is under 24px (or under 18.66px bold). Message: "Text is 1.3:1 against what is behind it (needs 4.5:1 at 20px)". Skip elements with opacity under a small floor or marked decorative (see 5).
   - Move `contrast.ts` out of `editor/inspector/` or re-export it, so `validate.ts` (which is not editor code) does not import from the editor.
2. **`text-overlap`** (warning). Two text or table elements on one slide whose boxes intersect by more than a small fraction of the smaller box, when neither is the other's frame ancestor and they are not in the same group stacked deliberately. With a DOM, use measured glyph areas instead of boxes to avoid flagging a tall empty box. Report once per pair, on the upper element.
3. **`outside-frame`** (warning). An element with a `parentId` whose box, after layout, extends past its frame's box while the frame has `clip` set (content is cut), or past it at all (info). This needs the derived geometry: run on a derived copy (see AI-11 for the ordering problem) and say so.
4. **`chart-label-clipped`** (warning). Step one, no kernel change: with a DOM, render the chart the way the thumbnail path does and compare each axis-label text node's rect with the chart element's rect. If that cannot be done without touching `kernel/src/charts.ts`, split it into its own issue labelled `kernel-zone` and leave it out of this PR.
5. **Deliberate exceptions.** A ghost numeral at 5% opacity is not a contrast failure. Do not add a format key here: use heuristics that are stated in the message (opacity or alpha under 0.15 = decorative) and keep them conservative. A marker for deliberate bleed is SC-01's.
6. Document every new code where finding codes are listed.

## Acceptance criteria

- [ ] Probe 1 returns `warning:low-contrast` with the measured ratio in the message; the same text in `#0D1B2E` returns none.
- [ ] Probe 2 returns exactly one `text-overlap` finding; two text boxes side by side with a 1px gap return none.
- [ ] A frame child pushed outside a clipping frame returns `outside-frame`; a correctly laid-out frame returns none.
- [ ] The shipped starter deck gains no `low-contrast` or `text-overlap` warning (its 5%-opacity numerals and layered tiles must not trip the checks). If it does, the heuristics are wrong, not the deck.
- [ ] The four fixtures in `scripts/fixtures/agent-decks/` gain no new warnings, or each new one is a real defect shown in the PR with a screenshot.
- [ ] Without a DOM (`measured: false`), `low-contrast` still runs on whole boxes and the measured-only checks are skipped, as with overflow today.
- [ ] `validate()` remains read-only and its run time on the starter (19 slides, 336 elements) grows by less than 50 ms in headless Chromium; report the number.

## Tests

- `scripts/test-validate.ts`: DOM-free cases for `low-contrast` (thresholds, decorative exception, text over a dark shape on a light slide) and `text-overlap` (pairs, groups, frame ancestors).
- `scripts/test-slides-validate-visual-browser.mjs` (headless Chromium): glyph-area contrast, `outside-frame` after the real layout pass, the starter and fixture decks producing no false findings, and the chart check if included. Register the browser rig in `.github/workflows/ci-slides.yml`.

## Out of scope

- Fixing anything automatically. These are findings; the person or agent decides (the design-system-wins rule, AI-16).
- Advisory findings about values outside the deck's own tokens (AI-16).
- Screen-reader checks such as missing alt text (FH-16 and the Check deck panel can add them later).
- The Check deck UI (F-10).

## Notes for the implementer

- Zone: slides app, except possibly the chart check (kernel). No format change.
- False positives are the real risk: one wrong warning on the starter and people stop trusting the panel in F-10. Tune on the starter, the gallery decks under `scripts/` if available, and the agent fixtures before merging.
- `scripts/test-slides-contrast.ts` and `scripts/test-slides-accent-contrast.ts` already pin the contrast maths; reuse, do not fork.
- Published results on slide-generating agents report that image-only review misses overflow and that geometric checks reduce collisions substantially; a deterministic geometric check through the real renderer is the strong version of this. (Cited from the audit's research pass; the papers were not read first-hand.)

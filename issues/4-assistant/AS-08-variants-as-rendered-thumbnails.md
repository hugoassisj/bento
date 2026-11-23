---
id: AS-08
title: "Variants as rendered thumbnails"
epic: 4-assistant
type: enhancement
priority: P2
size: M
evidence: code
labels: [enhancement, "priority:P2", "size:M", "evidence:code", "area:assistant"]
depends_on: [AS-07, AI-06]
related: [AI-09, AS-03, DS-01]
upstream: ["nyblnet/bento#532"]
---
## Summary

"Make this slide better" has no single right answer. Instead of one patch the user must accept or reject, show three candidates as rendered pictures of the slide and let them click one. Bento renders slides locally from the model, so the pictures cost nothing but the model's tokens. A no-model version of the same control (cycle through the deck's layouts) keeps the feature useful with no AI at all.

## What the user experiences

Today (PR branch): one request, one patch, applied at once. If the result is not what they wanted they undo, rephrase and wait again. There is no way to compare alternatives, and nothing visual until the change has already landed.

## Reproduce

1. Run the port (AS-01) with a simulated extension.
2. Ask "lay this slide out better". One `assistant.done` frame arrives with one `ops` object; `AssistantPanel.apply()` commits it.

## Evidence

Nothing here was observed beyond the single-patch flow described in AS-07. This issue is a design built on code that exists.

Confirmed in code:

- PR branch `transport.ts`: a turn resolves to exactly one `TurnResult` (`mode: 'ask'` with text, or `mode: 'edit'` with one `ops` object). There is no notion of alternatives in the contract.
- PR branch `ops.ts`: `applyOps(compact, ops, focus)` patches a copy and returns the patched compact document without committing. `panel.ts`'s `check()` closure shows the full dry-run chain (`applyOps` → `mergeReply` → `parseDocInputReport`) that yields a real `BentoDoc` for a candidate.
- Main: `renderSlide(slide, doc, opts)` at `slides/src/render.ts:1045` draws any slide of any document object; `rasterizeSlide()` at `slides/src/editor/exportimages.ts:59` turns one into an image. Neither needs the slide to be in the store.
- PR branch `ops.ts`: `LAYOUTS` lists the built-in layouts an `add` may use; on main `applyLayout` re-places a slide's content by role.

Not verified: latency and token cost of three turns against one; whether a model produces usefully different candidates when asked.

## How others do it

- PowerPoint Designer is the reference: a strip of rendered alternatives for the current slide, one click applies (https://techcommunity.microsoft.com/t5/microsoft-365-blog/what-s-new-in-powerpoint-smarter-faster-ways-to-build-and-edit/ba-p/4469061).
- Figma Slides and Canva show template and layout choices as thumbnails, never as descriptions.
- A published slide-agent study found success fell sharply without a rendered view of the result (https://arxiv.org/html/2501.03936v3, as reported by the research pass in this audit; not read first-hand).

## Proposed change

**1. Candidates without a contract change.** The page asks for alternatives by running the same turn up to three times with a page-supplied suffix on the request ("Option 2 of 3. Make it clearly different from: <one-line summary of option 1's applied list>"). The request string is already the page's to write, so the bridge, the extension and the prompt are untouched. Run them one after another, showing each thumbnail as it arrives; Stop cancels the rest. Later, if the maintainer wants it, a `variants` field on `assistant.done` could carry several patches from one call; do not start there.

**2. Render each candidate.** For each returned `ops`: dry-run it to a `BentoDoc` (the chain AS-07 factors out as `propose`), then draw the affected slide with `renderSlide` into a thumbnail at the slide-list size. Candidates that the gate reduces to nothing, or that introduce new validator errors, are dropped and counted ("1 option was unusable").

**3. The strip.** In the drawer, under the request: the current slide first, labelled "Now", then the options. Hover or focus shows a larger preview on the canvas as AS-07's overlay. Click selects; "Apply" commits through AS-07's `commit`, one undo step. Arrow keys move along the strip; Enter applies.

**4. When to offer it.** Not on every turn: three turns cost three times the tokens. Offer it

- as an explicit action ("Show me options") on the slide's Ask menu (AS-06) and in `⌘K`;
- automatically only when the request is about arrangement and names no specific change, decided by the page from the action used, not by guessing from wording.

State the cost in the control: "Asks the model three times."

**5. The no-model version.** The same strip, filled without a model: apply each deck layout and built-in layout whose roles fit the slide's content (`applyLayout`), render, show. Label it "Layouts" and make it available whether or not a host exists. This is the deterministic "next layout" control; it also gives the model version something to fall back on when a host is missing.

**6. Design-system rule.** Candidates may rearrange, resize and re-role. They may not introduce colours, fonts or tokens the deck does not have (`issues/00-READ-FIRST.md` §6); with AS-03 in place the patch cannot, and the review rows say what each option changes.

## Acceptance criteria

- [ ] "Show me options" produces up to three thumbnails of the open slide, each rendered from a dry-run document, with nothing written to the store until Apply.
- [ ] Applying an option commits exactly that option as one undo step; the other candidates are discarded.
- [ ] A candidate that introduces a validator error or changes nothing is not shown, and the count of unusable options is stated.
- [ ] Stop cancels outstanding turns and keeps the options already shown.
- [ ] The strip is operable by keyboard (arrows, Enter, Escape) and each thumbnail has an accessible name ("Option 2: three columns, title moved up").
- [ ] With no host, the "Layouts" strip still works and offers at least the layouts whose roles the slide can fill.
- [ ] A rig asserts that no candidate changes `theme`, `theme.tokens` or a component main.
- [ ] Token use is visible: the control states that it asks three times.
- [ ] Strings in all eight catalogs; byte cost recorded.

## Tests

- Extend `scripts/test-slides-assistant.ts`: three sequential turns with distinct fixture replies; a failing candidate is dropped; Stop mid-way; commit applies one.
- Add `scripts/test-slides-assistant-variants-browser.mjs`: thumbnails have non-zero painted size (measure with `getBoundingClientRect`, and check pixels differ between options, not that a style was set), keyboard operation, the no-host Layouts strip.

## Out of scope

Variants across several slides at once. Generating images. Remembering which options a user tends to pick. A new bridge op for multi-candidate replies.

## Notes for the implementer

- Built on the maintainer's unmerged drawer; ask before proposing upstream. The page-driven approach was chosen so that nothing in `home/webext/` or the contract changes.
- Depends on AS-07 for propose and commit and on AI-06 for a clean public render call; if AI-06 has not landed, call `renderSlide` directly and note it.
- "AI is additive, never load-bearing": the Layouts strip is the proof. Build it first; the model version then reuses the whole surface.
- The page never holds a key; three turns go through whichever host is present.
- Reading a style back is not a measurement: the rig must compare rendered geometry or pixels between candidates.
- Size: this adds a strip, a preview and keyboard handling on top of a feature that is already 9.5 KB over its target (+24.5 KB against 15 KB). Measure against AS-02's baseline and be ready to ship the Layouts strip alone.
- Offline mode: the model version is unavailable; the Layouts strip stays.

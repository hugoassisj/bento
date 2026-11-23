---
id: AS-07
title: "Review before apply: before and after, per-change accept or reject, plain-language refusals"
epic: 4-assistant
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:assistant"]
depends_on: [AS-01]
related: [AI-07, F-10, AS-08, AS-03, AI-16]
upstream: ["nyblnet/bento#532"]
---
## Summary

On the PR branch a model's patch is committed the moment it arrives. The user learns what happened afterwards from a card that says "Applied 3 changes" and lists refusals as JSON paths. This issue puts the user in front of the change: a before-and-after of each affected slide, each change accepted or rejected on its own, and everything the gate refused explained in words that name the element.

## What the user experiences

They ask for a shorter title. The slide changes under them. A card appears:

> Applied 3 changes · Undo
> 2 fields dropped, 0 warnings
> /slides/0/elements/28/bogusKey — unknown key for a text element
> /slides/0/elements/28/onclick — unknown key for a text element

They cannot tell which three things changed without hunting for them, cannot keep two and discard the third, and cannot read the refusal lines. If the model also touched slide 9, they will not see it unless they go and look.

## Reproduce

1. Run the port (AS-01) with a simulated extension.
2. Send a turn whose `assistant.done` frame carries `ops: { edits: [{ id: "1/sd-title", text: "One file.<br>Zero installs." }], notes: [{ slide: 1, text: "…" }], set: [{ id: "1/sd-title", bogusKey: 1, onclick: "x" }] }` (after the `assistant.document` handshake).
3. Observe the slide change immediately and the card above.

## Evidence

Seen in this audit: exactly the card quoted above, plus the toast "Deck updated by the assistant — ⌘Z undoes". The title and notes had changed before any confirmation was possible. `Ctrl+Z` restored the slide.

Confirmed in code (PR branch, `slides/src/editor/assistant/panel.ts`):

- `submit()` calls `applyOps()` then `this.apply(index, r.doc, elided, r.applied, result.sources)` with no step in between.
- `apply()` runs `mergeReply` → `parseDocInputReport` → `cleanDoc` → `this.store.replaceDoc(next)`, then builds the card. The refusal lines are ``${d.path} — ${d.reason}`` taken straight from the load report's `dropped` list (up to four), followed by up to four new validator messages.
- The pieces a preview needs already exist: `applyOps()` (`ops.ts`) returns `{ doc, applied, skipped, structural }` on a copy without committing; the dry-run `check()` closure inside `submit()` already computes `applied`, `skipped`, the outline after, and the validator findings the patch would introduce, but only the extension's agent loop receives it; `remoteUrls()` already lists web addresses a patch would add.
- The patch is itemised by construction: each verb is an array (`edits`, `notes`, `cells`, `chart`, `style`, `add`, `remove`, `move`, `set`, `insert`, `delete`, `slide`).
- On main, `renderSlide()` (`slides/src/render.ts:1045`) draws a slide from the model; the slide list's thumbnails use it.

Not verified: how long a before-and-after render takes on a 50-slide deck; measure it.

## How others do it

- PowerPoint Designer shows the candidates as pictures and applies the one you click; Copilot's Review Presentation lists suggestions to accept (https://techcommunity.microsoft.com/t5/microsoft-365-blog/what-s-new-in-powerpoint-smarter-faster-ways-to-build-and-edit/ba-p/4469061).
- Figma Slides previews a rewrite beside the original before replacing it (https://www.figma.com/blog/how-teams-tap-into-the-power-of-design-with-figma-slides/).
- Canva's and Gamma's agent tools use an explicit transaction or card-scoped edit so a change is proposed, then committed (https://www.canva.dev/docs/mcp/tools/).

## Proposed change

**1. Propose, then commit.** Split `apply()` into `propose(ops)` and `commit(acceptedOps)`.

- `propose` splits the reply into single changes (one entry per array item), runs the existing dry run for the whole set, and renders a review card. Nothing is written to the store.
- `commit` re-runs `applyOps` with only the accepted items and takes the existing road (merge, gate, `cleanDoc`, one `replaceDoc`). One undo step, as now.
- Structural items that depend on each other (an `add` and an `edit` addressed to the added slide) are grouped and accepted or rejected together; `applyOps` already applies content first and structure second, so grouping is by slide address.

**2. The review card.** For each affected slide: a before and an after thumbnail side by side, drawn with `renderSlide` at the slide list's thumbnail size from the live document and from the proposed one. Under them, one row per change with a checkbox, in plain words built from the op and the element's name:

- "Title: reworded" (hover shows old and new text)
- "Slide 1 notes: replaced"
- "Card 2: fill follows Accent 1" (AS-03)
- "New slide after 4: Two columns"

Buttons: Apply selected, Discard. Clicking a row selects that element on the canvas. Changes on a slide other than the open one say so and link to it.

**3. On the canvas.** While a proposal is open, show the after-state on the canvas as a non-editable overlay with changed elements outlined, and a "Before / After" toggle. Escape discards.

**4. Refusals in words.** Replace the raw path lines with a mapper from a report entry to a sentence:

- `/slides/0/elements/28/bogusKey — unknown key …` becomes "Title: the model tried to set ‘bogusKey’, which is not a setting. Ignored."
- a skipped address becomes "The model named something that is not on slide 3. Skipped."
- a protected key (AS-03, AI-16) becomes "Left your theme colours alone."

Resolve `/slides/<i>/elements/<j>` to the slide number and the element's `name` or its type. Keep the full report in the console as now, and add a "Details" disclosure for people who want the paths.

**5. A fast lane.** A preference "Apply wording changes without asking" (stored with the other panel preferences, default off): when a reply contains only `edits` and `notes` on the focused selection, commit directly and show the card with Undo, as today.

**6. What is shown before any commit.** New web addresses (`remoteUrls`), new validator findings, and the count of dropped fields move from the after-card to the review card, so they inform the decision.

## Acceptance criteria

- [ ] A reply with ops changes nothing in the store until the user accepts; a rig asserts the serialized document is byte-identical between `done` and Apply.
- [ ] The review card shows before and after for every affected slide, including slides other than the open one.
- [ ] Accepting two of three changes applies exactly those two, as one undo step; one `Ctrl+Z` restores the original.
- [ ] Discard, Escape and starting a new turn all drop the proposal and leave the store untouched.
- [ ] No refusal line shown to the user contains a `/slides/…` path; each names the element by its layer name or type. The raw report is still available under Details and in the console.
- [ ] Web addresses a patch would introduce and validator findings it would introduce are listed on the review card before commit.
- [ ] With the fast-lane preference on, a wording-only reply commits directly and shows Undo.
- [ ] The #532 security cases (hostile payloads through the real apply) still pass against `commit()`, and the source assertion that `cleanDoc(` sits before `replaceDoc(` is updated to the new function, not removed.
- [ ] All new strings are in all eight catalogs; byte cost recorded.

## Tests

- Extend `scripts/test-slides-assistant.ts`: `propose` does not touch the store; partial accept; grouped structural changes; the sentence mapper for each `dropped` reason and each skip reason; the hostile-payload cases re-pointed at `commit`.
- Add `scripts/test-slides-assistant-review-browser.mjs`: thumbnails present for two affected slides, canvas overlay and toggle, Escape discards, one undo restores.

## Out of scope

Alternative proposals for the same request (AS-08). Editing a proposed change before accepting it. A persistent history of proposals. Changing what the gate accepts.

## Notes for the implementer

- This rewrites the centre of the maintainer's unmerged drawer. The security review of #512 pinned the call site of `cleanDoc` inside `apply(` with a source assertion; keep an equivalent pin on `commit(` and say so, or the port will fail its own rig.
- The propose-and-commit shape should be the same one AI-07 exposes to file agents as `window.bento.patch(ops, { dryRun })`. Build the function once in `ops.ts`/`material.ts` and let both callers use it.
- "AI is additive, never load-bearing", and the page never holds a key: nothing here touches either.
- The review is where the design-system rule becomes visible to the user (`issues/00-READ-FIRST.md` §6): a change that would touch theme, tokens or a component main must be called out on its own row, unticked by default.
- Rendering two thumbnails per affected slide costs time, not bytes; reuse the thumbnail path. The UI itself costs bytes against the 15 KB target (AS-02): record it.
- Offline mode: no turn can run, so no proposal can exist; nothing to add.

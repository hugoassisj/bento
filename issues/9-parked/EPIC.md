---
id: EPIC-9
title: "Parked: phone editing"
epic: 9-parked
type: epic
labels: [epic, parked]
---
## Why this is parked

The owner ranked phone editing low priority on 2026-11-23. Bento's own README says the same about the product: "editing is desktop-first (phones view and present well)". The audit still drove the editor on an emulated phone and tablet, and the findings are kept here so the analysis is not lost and so the two cheap safety problems do not get forgotten.

Everything in this folder was observed with **touch emulation in Chromium** (iPhone 13 and iPad Pro 11 profiles). None of it was checked on a real device. Emulation has no on-screen keyboard and differs from real hardware in tap timing and synthesized mouse events. Reproduce on a device before fixing anything here.

Presenting and viewing on touch is a different matter from editing and is not parked: see MP-19 in `6-motion-presenting/`.

## Two cheap safety fixes worth doing anyway

These are small, they protect people who only open the editor on a phone to fix one thing, and neither requires a redesign.

- [ ] **PK-01 · Touch: a one-finger swipe moves an unselected element** (bug, P2, S). A stray swipe displaces content with no notice. Fix: on touch, only an already selected element moves; show a "Moved … · Undo" toast.
- [ ] **PK-02 · Phone top bar: Undo and Format always visible** (P3, S). At 390 px the bar is 623 px wide and Undo, Format, Save and "⋯" are scrolled out of sight with nothing hinting that the bar scrolls. Fix: take the title out of the phone bar so the essential buttons fit.

Together they close the worst case the audit found: a title moved by accident five minutes before a talk, with Undo off-screen.

## The rest

- [ ] **PK-03 · Slide long-press menu: Move up and Move down** (P3, S). Reordering needs an HTML5 drag that touch does not deliver reliably. Two menu rows fix it, and they help mouse and keyboard users too. Fine to take alongside FH-11 (slide list keyboard support), since both need the same move function.
- [ ] **PK-04 · Phone: Format as a bottom sheet; horizontal slide strip** (P3, L). The redesign: a half-height Format sheet that leaves the slide visible, a horizontal slide strip (upstream issue #20), panels that start collapsed on touch tablets, larger handle hit areas. Depends on PK-02 and PK-03. Do not start it while the epic is parked.

## Order, if any of it is taken

1. PK-01, then PK-02 (independent of each other; both are small).
2. PK-03, ideally together with FH-11.
3. PK-04, split into its three parts, only after the epic is un-parked.

## What would un-park it

Any one of these, stated by the owner:

- Phone or tablet editing becomes a goal for the fork or for upstream (the README sentence about desktop-first editing would change with it).
- Upstream picks up issue #20 (horizontal slide list on mobile) or asks for help with it. It is listed as open and unowned in upstream's pinned "What's in flight" issue.
- Real-device testing shows PK-01 or PK-02 is worse than emulation suggested, for example an unintended move on nearly every scroll attempt. In that case PK-01 and PK-02 move to the first-hour epic as ordinary bugs.
- The mobile host apps in `home/` (the maintainer's area) start steering phone users into the editor in numbers.

## Shared notes for anyone working here

- Read `issues/00-READ-FIRST.md` first.
- Touch paths are separate code: the canvas tap recogniser and pinch handling (`slides/src/editor/canvas.ts`), the long-press menu (`slides/src/editor/editor.ts`), the phone tier of the top bar (`fitTopbar`, `applyPhoneChrome`) and the `max-width: 700px` blocks in `slides/src/styles.css`. Each carries long comments recording bugs that were hard to find; read them before editing.
- Rigs must use a touch-enabled browser context and real touch sequences. Synthetic `PointerEvent`s and `MouseEvent`s dispatched in the page do not exercise these paths.
- Every change must leave desktop behaviour with a mouse exactly as it is; add a desktop assertion to each rig.

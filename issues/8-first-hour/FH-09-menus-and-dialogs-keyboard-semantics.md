---
id: FH-09
title: "Menus and dialogs: keyboard and screen-reader semantics"
epic: 8-first-hour
type: bug
priority: P1
size: M
evidence: mixed
labels: [bug, "priority:P1", "size:M", "evidence:mixed", "area:a11y", "a11y", "needs-upstream-discussion"]
depends_on: []
related: [FH-10, FH-11, FH-17, F-05]
upstream: []
---
## Summary

The editor's dropdown menus (File, Save options, Help, the Slideshow pill, the phone menus and others) open only as a CSS class. Escape does not close them, arrow keys do not move through them, and they expose no menu roles or expanded state. While one is open every canvas shortcut is disabled, so a keyboard user is stuck. The right-click menu has roles but never takes focus. Several older dialogs are plain overlays with no dialog role and no focus trap. The repository already contains shared primitives that do all of this correctly; the slides editor mostly does not use them.

## What the user experiences

- Open Help with the keyboard, press Escape: the menu stays open. Press ArrowDown: nothing moves. The only ways out are a mouse click elsewhere or Tab-walking through every row.
- With a menu open, Delete, arrows, ⌘K and the rest do nothing.
- A screen reader announces the File menu trigger as a button with a popup, never says whether it is open, and reads the rows as unrelated buttons.
- Right-click → the menu appears; ArrowDown scrolls nothing and selects nothing; focus is still on the canvas.
- Replace from JSON and Languages cannot be closed with Escape; in every older dialog Tab walks out of the dialog into the page behind it, and focus is not returned to the opener on close.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Click the Help button (top right). Press Escape. `getComputedStyle(document.querySelector('.ed-help-menu')).display` is still `flex`.
3. Press ArrowDown: `document.activeElement` does not move into the menu.
4. With the menu open press `Delete` with an element selected: nothing happens.
5. Right-click an element; `document.activeElement` is not inside `.ed-ctxmenu`.
6. File menu → Advanced → Replace from JSON…; press Escape: the overlay stays.

## Evidence

- **Seen (main session, live app):** steps 2–3 on the Help menu, with those values.
- **Confirmed in code now** (`slides/src/editor/editor.ts` unless noted):
  - Nine `div('ed-dropdown …')` sites: `:544`, `:554`, `:607`, `:1122` (Save options), `:1251` (File), `:1605`, `:2055` (Help), `:2074`, `:2661`. The ones read (`:1121-1138`, `:1250-1263`, `:2054-2058`) toggle an `open` class and close on an outside `pointerdown`; there is no key handling.
  - `aria-haspopup` is set on some triggers (`:1257`, `:2057`); `aria-expanded` does not occur anywhere in the file.
  - `menuRow` (`:166-176`) builds a plain `<button class="ed-btn ed-menu-row">`: no `role="menuitem"`.
  - `MODAL` (`:84`) includes `.ed-dropdown.open`; `canvasFree` (`:3756`) and `typeIntoText` (`:4013`) check it, which is why shortcuts die while a menu is open. The global Escape branch (`:3985-4000`) only deselects.
  - `slides/src/editor/ctxmenu.ts:57-71` sets `role="menu"`/`menuitem`/`menuitemradio`; `:113-118` handles Escape only; nothing moves focus into the menu and there is no arrow handling.
  - Older overlays built as `div('ed-about-overlay')`: Replace from JSON (`:1465-1466`), Languages (`:1895-1896`), Version history (`:3584-3585`), and `dialogShell` (`:4698-4720`, used by About, Preferences, Document properties). Version history and `dialogShell` handle Escape; Replace from JSON and Languages do not. None sets `role="dialog"`, `aria-modal`, a label, a focus trap or focus return.
  - The shared primitives exist: `kernel/src/ui/dialog.ts:65-144` (`createDialog`: role, `aria-modal`, focus trap, focus return) is already used here for Compress pictures (`:4892`) and in `exportimages.ts:189`. `kernel/src/ui/menu.ts:198` (`createMenu`) and `:340` (`closeAllMenus`) provide roles, `aria-expanded`, Escape, dismiss-on-choose, mutual exclusion and arrow-key navigation; its header comment says of slides: "not one of them closes on Escape or carries a single `aria-haspopup` or `aria-expanded`". Only `spaces/src/menus.ts` imports it today.
- **Unverified:** the six dropdown sites not read line by line; assume the same pattern until checked.

## How others do it

Every desktop app and the WAI-ARIA menu-button pattern: Enter, Space or ArrowDown opens and focuses the first item; arrows move; Home and End jump; Escape closes and returns focus to the trigger; Tab closes. Dialogs trap focus, close on Escape and return focus to the opener. PowerPoint, Keynote, Figma and Penpot all do this.

## Proposed change

Adopt the shared primitives instead of writing new behaviour.

1. **Dropdowns.** Rebuild each `ed-dropdown` on `createMenu` from `kernel/src/ui/menu.ts` (read its header: it documents the per-app custom properties so slides keeps its look). Keep the split Save button structure and the phone treatment (menus go `position: fixed` under a scrolling bar), both of which the primitive's header says came from slides. Where a site cannot move yet, add the minimum: `aria-expanded` on the trigger, Escape closes and refocuses the trigger, arrows move, only one menu open at a time.
2. **Stop treating an open menu as a modal that kills shortcuts with no way out.** Either the menu owns the keyboard properly (after step 1 it does) or it is removed from `MODAL`.
3. **Context menu** (`ctxmenu.ts`): focus the first enabled item on open, arrow keys, Home/End, type-ahead optional, Escape returns focus to the canvas. Consider building it on the same primitive.
4. **Older overlays.** Move About, Preferences, Document properties (`dialogShell`), Version history, Languages and Replace from JSON onto `createDialog`. Give each a title for `aria-labelledby`.
5. Nothing here needs a kernel edit if the primitives are used as they are. If a primitive needs a change, stop and split it: that is kernel zone.

Strings: accessible names only where missing; every catalog.

## Acceptance criteria

- [ ] Every top-bar dropdown: Escape closes it and focus returns to its trigger.
- [ ] ArrowDown/ArrowUp move between items, Home/End jump, Enter activates; disabled rows are skipped or announced as disabled.
- [ ] Triggers carry `aria-haspopup="menu"` and a correct `aria-expanded`; menus are `role="menu"` with `role="menuitem"` rows.
- [ ] Opening one menu closes any other.
- [ ] With no menu open, canvas shortcuts work; with one open, no canvas shortcut fires and Escape always gets the user out.
- [ ] The context menu takes focus on open and is fully operable by keyboard.
- [ ] Each dialog listed has `role="dialog"`, `aria-modal="true"`, a label, a focus trap, Escape to close and focus return.
- [ ] Phone layout (≤700px): menus still open, are not clipped, and close.
- [ ] No visual change at desktop width beyond focus rings (compare screenshots).

## Tests

- Extend `scripts/test-slides-menus-ia-browser.mjs` (menu structure) with keyboard cases per dropdown; extend `scripts/test-slides-help-sheet-browser.mjs` if the Help menu moves.
- Add `scripts/test-slides-dialogs-a11y-browser.mjs`: open each dialog, assert role, label, trap (Tab from last control wraps), Escape, focus return.
- `scripts/test-ui-menu.ts` and `scripts/test-ui-dialog.ts` already cover the primitives; do not duplicate them.
- New assertions must fail on the parent commit. Register new files in `.github/workflows/ci-slides.yml`.

## Out of scope

- Announcing toasts (FH-10), slide-list keyboard (FH-11), landmarks and forced-colors (FH-17).
- Restyling menus.

## Notes for the implementer

- Zone: slides app, consuming kernel primitives read-only.
- **Check upstream first.** The primitives belong to a maintainer-led "shared UI" effort (upstream branches named `bento-ui-primitives*`, `bento-ui-dialog`, `bento-ui-tooltip`, `bento-ui-toggle` exist). Migrating slides onto them may already be planned or in flight; ask before proposing this upstream so the work is not duplicated.
- Hot file: `slides/src/editor/editor.ts`. Split by concern if the diff grows: dropdowns, context menu, dialogs.
- Read `slides/CLAUDE.md` hard-won details 9 and 10 (z-index ceilings, `overflow-y` clipping) before moving menu DOM.

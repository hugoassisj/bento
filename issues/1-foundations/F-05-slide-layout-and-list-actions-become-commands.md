---
id: F-05
title: "Slide, layout and list actions become commands (shortcuts, palette, menus)"
epic: 1-foundations
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:commands"]
depends_on: []
related: [F-06, FH-11, FH-12, AS-06, MP-15]
upstream: []
---
## Summary

The editor has one command list that feeds keyboard shortcuts, the ⌘K palette and tooltips. Slide management, layouts, notes and lists were never added to it. So the most common presentation shortcuts do nothing, ⌘K cannot find "new slide", and the thumbnail menu is the only way in. Register these actions as commands once.

## What the user experiences

- Ctrl/⌘+M (new slide in PowerPoint), ⌘D with a slide current, and Delete with a slide current do nothing.
- ⌘K ▸ "new slide", "layout", "hide slide", "notes", "bullet" all return "No matching command".
- The thumbnail right-click menu has only New slide, Duplicate slide, Delete slide. There is no Move, Hide, or Present from here.
- The shortcut sheet lists PageUp/PageDown as the only slide keys.

## Reproduce

1. Fresh load. Click an empty area of the canvas (nothing selected).
2. Press Ctrl+M: nothing. Press Ctrl+D: nothing. Press Delete: nothing.
3. Ctrl+K, type `new slide`: "No matching command". Type `layout`: same. Type `hide`: only panel toggles, no Hide slide.
4. Right-click a thumbnail: three items.

## Evidence

- Observed in the running app during the audit (first-deck journey: the three shortcuts did nothing; ⌘K "layout" returned No matching command; the data journey found no "new slide" in ⌘K).
- Confirmed in code now, in `slides/src/editor/editor.ts`:
  - The command list is built in `get commands()` (`:3749`, list starts `:3768`). Its ids are: save, zoom, present, palette, help, the tools, comment, group/ungroup, lock, align-*, distribute-*, flip, auto-layout, component-*, token-*, undo/redo, duplicate, ghost-cut, panel toggles, `next-slide`/`prev-slide`, insert-image/table/chart/code, copy, delete, slideshow, use-morph, select-all, select-parent, play-transition, exports, preferences, doc-props, version-history, import/export pptx, compress-images, copy-json, replace-json, start-scratch, save-copy, language, speaker, about. **No** new-slide, duplicate-slide, delete-slide, move-slide, hide-slide, apply-layout, notes or list command.
  - `:3817` `duplicate` runs `duplicateSelection()`, which returns immediately when nothing is selected (`:4090`).
  - `:3841` `delete` has `when: … sel().length > 0`.
  - The actions exist as private methods: `duplicateSlide(i)` `:2478`, `deleteSlides(indices)` `:2519`, `deleteSlide(i)` `:2537`, `insertSlideFromLayout` `:2289`, `applyLayoutToCurrent` `:2299`, `openLayoutPicker` `:2222`, `selectedSlides()` `:4124`; the thumbnail menu is `slideMenuItems` `:4469`.
  - Hide slide is only a toggle in the inspector (`slides/src/editor/inspector/slide.ts:38`).
- Recorded rule: `docs/DECISIONS.md` (the 1.3.0 editor entries) says keys are commands; this issue extends that rule to slides.

## How others do it

- PowerPoint: Ctrl+M new slide, Ctrl+D duplicates the selected slide, Ctrl+↑/↓ moves it, Hide Slide on the context menu.
- Keynote: Return in the navigator adds a slide; Skip Slide; every menu action is searchable from Help.

## Proposed change

Add commands to the list in `editor.ts` (same `Command` shape, `scope: 'canvas'` unless noted):

| id | label | keys | runs |
|---|---|---|---|
| `slide-new` | New slide | ⌘/Ctrl+M | insert after the current slide using the current slide's layout (or Title + content); `openLayoutPicker` stays the menu path |
| `slide-new-layout` | New slide from layout… | palette only | opens the layout picker |
| `slide-duplicate` | Duplicate slide | ⌘D when nothing is selected | `duplicateSlide(currentIndex)`, or every selected thumbnail |
| `slide-delete` | Delete slide | ⌫ when nothing is selected and a thumbnail has focus or a multi-slide selection exists | `deleteSlides(...)`; keep the existing undo toast |
| `slide-move-earlier` / `slide-move-later` | Move slide earlier / later | ⌘/Ctrl+↑ / ↓ | reorder through the same code path the drag uses |
| `slide-hide` | Hide slide / Show slide | palette + menu | toggle `slide.hidden` |
| `layout-apply` | Apply layout… | palette | opens the layout picker in apply mode |
| `notes-toggle` | Speaker notes | palette | the toggle beside Slideshow |
| `list-bullets`, `list-numbers` | Bulleted list, Numbered list | `scope: 'text'` | the richtext actions (see FH-12 for the panel buttons) |

Rules:
- ⌘D and ⌫ must keep their element meaning when elements are selected. Order the list so the element command matches first, or give the slide commands a `when` of "no element selected".
- Plain ⌫ deleting a slide is dangerous. Require either thumbnail focus (FH-11) or a multi-slide selection; never delete a slide from a bare canvas keypress.
- Move the thumbnail menu (`slideMenuItems`) onto the commands so labels and key hints come from one place.
- Every label goes through `t()` and into all catalogs. The existing key-hint rig (`scripts/test-slides-hint-keys.ts`) must still pass.

## Acceptance criteria

- [ ] ⌘/Ctrl+M inserts a slide after the current one and selects it; one undo removes it.
- [ ] ⌘D with no element selected duplicates the current slide; with an element selected it still duplicates the element.
- [ ] ⌘/Ctrl+↑ and ↓ reorder the current slide; state slides stay attached to their parent.
- [ ] ⌘K finds each new command by its label: `new slide`, `duplicate slide`, `delete slide`, `move slide`, `hide slide`, `apply layout`, `speaker notes`, `bulleted list`.
- [ ] The thumbnail context menu shows New, Duplicate, Move earlier, Move later, Hide/Show, Delete, with key hints.
- [ ] The `?` shortcut sheet lists the new shortcuts (it is generated from the command list).
- [ ] A bare ⌫ on the canvas with nothing selected does not delete a slide.
- [ ] None of the new chords fire while a text box, the palette, a menu or a dialog has focus.
- [ ] In a read-only deck none of the new commands is offered.

## Tests

Extend `scripts/test-slides-command-palette-browser.mjs` or add `scripts/test-slides-slide-commands-browser.mjs` (headless Chromium, trusted keyboard): each shortcut's effect on `window.bento.doc.slides`, undo, the palette queries above, and the two safety cases (element selected; text box focused). Register under `slides-editor-browser` in `.github/workflows/ci-slides.yml`.

## Out of scope

- Keyboard focus and reordering inside the thumbnail list itself (FH-11).
- Showing unavailable commands and synonyms in ⌘K (F-06).
- Bullet and number buttons in the Text section (FH-12).
- Find in deck (FH-20).

## Notes for the implementer

- A ⌘/Ctrl chord the editor declares is taken from the browser even when its `when` fails, unless `yields` is set (`slides/src/editor/commands.ts`, the `yields` comment cites upstream #838). Ctrl+M and Ctrl+↑/↓ are not browser shortcuts worth yielding; check macOS ⌘M (minimise window): on a Mac use ⌃M or leave New slide without a chord there, and say which you chose.
- The slide list is drag-only today (`makeThumb` `:2104`, `dropSlides` `:2410`); reuse the drop logic for Move so states and multi-selection behave the same.
- Hot file: `slides/src/editor/editor.ts` (also touched by F-01, F-02, F-10). i18n catalogs.
- This registry is what an in-editor assistant would call as tools (AS-06); keep ids stable and descriptive.

---
id: FH-10
title: "Toasts are announced; failures offer an action"
epic: 8-first-hour
type: enhancement
priority: P1
size: S
evidence: code
labels: [enhancement, "priority:P1", "size:S", "evidence:code", "area:a11y", "a11y"]
depends_on: []
related: [FH-06, FH-09, FH-14, F-11]
upstream: []
---
## Summary

Toasts are the editor's only feedback for saving, pasting, undo hints and failures, and they are silent to assistive technology. Failure toasts say "Save failed — see console" or "Saving failed", vanish after 2.2 seconds and offer nothing to do, although the toast function already supports an action button. Choosing a picture the browser cannot decode inserts nothing and says nothing.

## What the user experiences

- A screen-reader user never hears "Saved", "Image pasted", "Deck updated" or any failure.
- A sighted user whose save fails sees a 2-second message pointing at a developer console, with no retry and no "download a copy instead". If they look away they miss it and believe the work is saved.
- Picking an unsupported picture (for example HEIC in Chrome) through the Image button: the file dialog closes and nothing happens.

## Reproduce

Read-only reproduction from code; drive it before fixing.

1. `cd slides && npm run dev`, open http://localhost:5173.
2. In the console: `document.querySelector('.ed-toast')` after any action that toasts (paste text): the node has no `role` and no `aria-live`.
3. Force a save failure (for example revoke the file handle's permission, or stub `showSaveFilePicker` to reject with something other than `AbortError`) and press ⌘S: a toast reading "Save failed — see console" appears for about 2 seconds with no button.
4. Click the Image button and choose a file that is not a decodable image but passes the `image/*` filter (rename a text file to `.png`): nothing is inserted and no toast appears.

## Evidence

- **Seen:** none for this issue. The first audit read these paths in code; the image and save failures were not driven in the app.
- **Confirmed in code now** (`slides/src/editor/editor.ts`):
  - `toast(message, action?, kind?)` at `:4903-4931` — creates `div.ed-toast`, sets text, appends an optional action button, shows it, removes it after `action ? 8000 : 2200` ms. No `role`, no `aria-live`, and it removes any existing toast first, so messages do not queue.
  - Failure call sites with no action: `this.toast(t('Saving failed'))` at `:1328`, `:1374`, `:1413`, `:1440`; `this.toast(t('Save failed — see console'))` at `:1598`, `:3676`, `:3731`.
  - `pickImage` at `:2618-2638` — `img.onload` inserts the element; there is no `img.onerror`, so an undecodable source does nothing. `slides/src/editor/shrink.ts:157` returns the original bytes with reason `'undecodable'` when `createImageBitmap` fails, so the failure reaches `pickImage` as a data URL the `<img>` cannot load.
  - `pasteImageFile` at `:2916-2938` does have `img.onerror`, but it inserts a 400×300 element with the broken source (`:2936`).
  - Live regions elsewhere in the editor are local only: `role="alert"` at `:3363`, `tokenspane.ts:55`, `inspector/animate.ts:40`; `role="status"` at `inspector/controls.ts:321`.
- **Unverified:** which exact conditions reach each "Saving failed" site, and whether any of them is the user cancelling a picker (those must stay quiet).

## How others do it

- **Google Slides, Figma:** a status region announces saves and errors; a failed save shows a persistent banner with "Try again".
- **PowerPoint, Keynote:** a failed save is a dialog that must be answered and offers Save As.
- WAI-ARIA: status messages use `role="status"` (polite); errors that need attention use `role="alert"`.

## Proposed change

`slides/src/editor/editor.ts`:

1. **One persistent live region.** Create a single visually hidden `role="status"` `aria-live="polite"` node at editor build and a second `role="alert"` node for failures. `toast()` writes the message into the matching region as well as showing the visual toast. A live region must already be in the DOM before its text changes, which is why the toast node itself (created and removed each time) cannot be the region. Kind `error` (the existing `kind` parameter) selects the alert region.
2. **Failures stay until dismissed or acted on.** For save failures pass an action and a longer life: "Download a copy" (the existing download fallback) and, where it makes sense, "Try again". Do not point at the console in user-facing text; log the error to the console as well, and put the reason in the message when it is known (permission lost, file changed on disk, quota).
3. **Classify the seven call sites.** For each, decide: cancelled by the user (no toast), recoverable (toast with action), or fatal (alert with download). Record the decision in the PR table.
4. **Image failures.** Add `img.onerror` to `pickImage`: toast "That picture could not be read" with the file name, insert nothing. Change `pasteImageFile`'s `onerror` to the same behaviour instead of inserting a broken 400×300 element. FH-06's drop path uses the same helper.
5. **Do not stack toasts over the title** (journey 1 saw "Backed up in this browser" overprinting slide text): out of scope here, tracked in FH-19, but do not make it worse when lengthening lifetimes.
6. Reduced motion: `.ed-toast` (`slides/src/styles.css:1099-1114`) animates opacity and transform, and no `prefers-reduced-motion` rule in that file names it. Add one while here.

New and changed strings ("Save failed — see console" is replaced) in every catalog; remove dead keys so `scripts/test-i18n-dead-keys.mjs` passes.

## Acceptance criteria

- [ ] Every toast's text is also written to a persistent `role="status"` (or `role="alert"` for errors) region that exists before the message is set.
- [ ] A failed save shows a message that stays at least until dismissed, names the reason when known, and offers "Download a copy"; activating it downloads the current deck.
- [ ] No user-facing string tells the user to look at the console.
- [ ] Cancelling a save picker shows no error.
- [ ] Choosing an undecodable picture through the Image button shows a message and inserts nothing.
- [ ] Pasting an undecodable image file no longer inserts a broken element.
- [ ] Existing action toasts (undo offers) still work and still expire.
- [ ] All new strings are in the eight catalogs; no dead keys remain.

## Tests

Add `scripts/test-slides-toast-a11y-browser.mjs`: assert the regions exist at boot; trigger a normal toast and read the status region's text; stub the save path to reject and assert the alert region, the action button and that it survives 3 seconds; feed a non-image blob to `pickImage`'s input and to a paste event and assert no element was added and a message appeared. Register in `.github/workflows/ci-slides.yml`. Regression: `scripts/test-slides-save-browser.mjs`, `scripts/test-slides-save-recovery-browser.mjs`, `scripts/test-slides-presence-toasts.ts`, `scripts/test-slides-shrink.ts`.

## Out of scope

- Menus and dialogs (FH-09).
- The unreadable-file recovery card (F-11).
- Toast placement over slide content (FH-19).

## Notes for the implementer

- Zone: slides app. Hot file: `slides/src/editor/editor.ts`; the save paths call into `kernel/src/save.ts`; do not change the kernel here, only how the editor reports its result.
- `t` is shadowed inside `toast()` by a local `const t = div('ed-toast')`; rename the local when touching the function.
- Add a `CHANGELOG.md` `[Unreleased]` line.

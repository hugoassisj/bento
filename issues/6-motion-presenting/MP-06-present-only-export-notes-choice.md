---
id: MP-06
title: "Present-only export: choose whether notes, comments and hidden slides are included"
epic: 6-motion-presenting
type: bug
priority: P0
size: S
evidence: mixed
labels: [bug, "priority:P0", "size:S", "evidence:mixed", "area:export"]
depends_on: []
related: [MP-14]
upstream: ["nyblnet/bento discussion #992"]
---
## Summary

Share ▸ "Present-only file…" is described in the menu as "A sealed hand-out". The file it writes still contains every speaker note, every review comment and every hidden slide, in plain readable JSON. A speaker who hands it out after a talk has published their private notes without being told. This is a gap between what the label promises and what the file holds, not a vulnerability: the document format is readable by design. Ask before saving, and default to leaving private material out.

## What the user experiences

After the talk the speaker wants to give attendees the deck without the editor. The Share menu offers "Present-only file… — A sealed hand-out that opens straight into the show — no editor, no live connection." They save it and send it. Anyone who opens the file in a text editor, or presses S in the show, reads the speaker notes ("don't mention the Q3 slip", names, prices). Slides the speaker hid are in there too. The neighbouring menu item, Audience copy, says explicitly that it "Never carries your speaker notes or comments"; the present-only item says nothing either way.

## Reproduce

1. Fresh load of the Showcase deck (every slide has notes). Optionally hide one slide and add one comment.
2. Share menu (the people icon) ▸ **Present-only file…**; save it.
3. Open the saved file in a text editor and search for a phrase from slide 1's notes ("Welcome! This whole deck"). It is there, in the `#bento-doc` block.
4. Open the saved file in a browser, press Present, then S: the speaker view shows the notes.
5. Search the file for the hidden slide's id and for the comment text: both present.

## Evidence

- Seen during the motion and presenting journey: the saved present-only file was searched and contained the notes.
- Confirmed in code in the main session and again now. `savePresentationPackage` (`slides/src/editor/editor.ts:1319-1330`):

  ```
  const clone = JSON.parse(JSON.stringify(this.store.doc))
  clone.readonly = true
  stripCollabSecrets(clone)
  … writeUpdatedFileAs(await serializeAuto(clone), clone, { suffix: 'presentonly' })
  ```

  Nothing else is removed. The menu text is at `editor.ts:1817-1818`; the Audience copy text with the explicit promise is at `1819-1820`.
- The machinery to leave notes and comments out already exists for the audience path: `AUDIENCE_HIDDEN = ['notes', 'comments']` and `projectSlide` (`slides/src/audience.ts:42`, `67-73`), used by `projectDoc` (`audience.ts:106`).
- The export test names this function but only asserts that it strips the live session (`scripts/test-export-secrets.ts:250-254`).
- A present-only file opens in player mode (`slides/src/main.ts:162`, `playerMode` at `237`), and the show's speaker view works there, which is the legitimate reason some users **want** notes kept: presenting from the sealed file on a borrowed machine.
- Upstream discussion #992 ("How to edit a present-only file?") shows people do pass these files around as the only copy.

## How others do it

- **Keynote**: export to PDF or HTML asks "Include presenter notes" and "Include skipped slides", both off by default.
- **PowerPoint**: Document Inspector lists presentation notes, comments and hidden slides before sharing.
- **Figma Slides**: an audience link never carries presenter notes.

## Proposed change

`slides/src/editor/editor.ts`, `savePresentationPackage`:

1. Before writing, open a small dialog built with the kernel primitive `createDialog` (`kernel/src/ui/dialog.ts:65`, already used by `slides/src/editor/exportimages.ts:189`), **only when there is something to decide**. It lists what the deck contains and three checkboxes, all **off** by default:
   - Include speaker notes (N slides have notes)
   - Include comments (N comments)
   - Include hidden slides (N hidden)
   A line of explanation: "Anyone who receives this file can read whatever is included."
   If the deck has no notes, no comments and no hidden slides, save directly as today.
2. Build the clone from the choices:
   - notes and comments: reuse the audience projection's slide-level stripping (export a small helper from `audience.ts` that takes the list of keys to drop, rather than copying the logic; `projectDoc` itself also needs a ticket and handles assets, so do not call it directly).
   - hidden slides: drop slides where `hidden` is true, **and** any state slides that hang off them; then drop or repair element `link`s that pointed at a removed slide so no link is dead. Use `inLinearFlow` (`slides/src/model.ts:1551`) as the reference for what the show reaches.
3. Change the menu description to say what the default is, and the success toast to state it ("Presentation package saved without speaker notes").
4. Remember the last choice per browser (localStorage, not the document).

No format change. No new key in the document.

Strings in every catalog: the dialog title, three checkbox labels with counts, the explanation, the new menu description, the new toast.

Rejected: always stripping (breaks the presenter who uses the sealed file with the speaker view); a second menu item (the Share menu already has five flavours).

## Acceptance criteria

- [ ] Saving a present-only file from a deck with notes, with the defaults, produces a file whose `#bento-doc` contains none of the notes text; every `notes` value is an empty string.
- [ ] With defaults, no `comments` key remains on any slide and no hidden slide (nor a state of one) remains in `slides`.
- [ ] No element `link` in the saved file points at a slide id that is absent.
- [ ] Ticking "Include speaker notes" keeps notes and the speaker view in the saved file shows them.
- [ ] A deck with nothing private saves without a dialog.
- [ ] The dialog traps focus, closes on Escape, and returns focus to the Share button.
- [ ] The live session is still stripped (`stripCollabSecrets`) and `readonly` is still set.
- [ ] `scripts/test-export-secrets.ts` asserts the notes, comments and hidden-slide stripping and fails on the parent commit.

## Tests

- Extend `scripts/test-export-secrets.ts` (registered in `.github/actions/validate-slides/action.yml`): build the clone through the new pure function with each combination of the three choices and assert the document contents; assert no dangling link. Keep its existing source assertion that `savePresentationPackage` calls `stripCollabSecrets`.
- If the dialog logic is non-trivial, add `scripts/test-slides-presentonly-browser.mjs` (register in `.github/workflows/ci-slides.yml`) driving the Share menu with real input and reading the downloaded file.

## Out of scope

- Encrypting or sealing the file against inspection (the format is readable by design; "Save with password…" exists for that).
- PDF export options (MP-14), which should offer the same three choices.
- Editing a present-only file (upstream #992).

## Notes for the implementer

- Slides app only. Do not file or describe this upstream as a security issue; it is an expectation gap, and upstream's `SECURITY.md` reserves that channel for vulnerabilities.
- `audience.ts` has a mutation-tested rig (`scripts/test-audience-projection.ts --mutate`); if you export a helper from it, keep `AUDIENCE_HIDDEN` the single source of the key list so that rig still bites.
- Speaker notes also appear in version history and autosave snapshots in the browser; those do not leave the machine and are not part of this issue.

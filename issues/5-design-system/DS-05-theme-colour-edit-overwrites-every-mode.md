---
id: DS-05
title: "Editing a theme colour in a non-default mode silently overwrites every mode"
epic: 5-design-system
type: bug
priority: P1
size: S
evidence: mixed
labels: [bug, "priority:P1", "size:S", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-06, DS-07, F-01]
upstream: []
---
## Summary

Tokens hold one value per mode. The seven theme colours shown at the top of the same Colors list do not: they hold one value for every mode. Nothing in the UI says so. A user who adds a "Dark" mode and recolours Background while Dark is showing has changed Default as well, with no warning and no way to tell.

## What the user experiences

They add a mode called Dark, expecting a second set of colours. They change Background to a dark value. The deck goes dark. They switch back to Default to compare, and Default is dark too. Number tokens edited in the same session (for example `radius.md`) do keep separate values per mode, so the behaviour looks like a bug in colours specifically.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173 (starter deck).
2. Left panel, third tab (Tokens).
3. Click **+** beside the "Default" mode chip, type `Dark`, press Enter. Dark becomes the active mode.
4. Under Colors ▸ Theme, click the hex of **Background** and type `101418`, Enter.
5. In Numbers, change `radius.md` from 14 to 40.
6. Click the **Default** chip.

Observed: `radius.md` reads 14 again (correct). Background still reads `101418` (the Default value was overwritten).
Expected: either Default keeps its own Background, or the UI said before step 4 that theme colours are shared by all modes.

## Evidence

- **Seen in the running app (design-features journey):** exactly the sequence above; Background stayed `101418` on Default while `radius.md` kept 14 vs 40.
- **Confirmed in code now:**
  - `slides/src/editor/tokenspane.ts:424` carries the comment "ponytail: one value in every mode; per-mode theme colours need a format addition."
  - `tokenspane.ts:438-444` (inside `themeRows`, which starts at `:426`): the theme row's `write` sets `theme.background`, `theme.color`, `theme.accent` or `theme.palette[slot]` directly. There is no mode in that path.
  - `tokenspane.ts:375-391`: adding a mode copies `values[from]` to `values[name]` for entries in `theme.tokens.set` only.
  - `tokenspane.ts:187-210` (`switchMode`) already builds a summary of what a mode switch did and did not reach; it mentions literal colours but not theme colours.
- **Recorded decision:** `docs/DECISIONS.md:12062` ("Tokens extend the palette contract"): tokens have values per mode; the palette contract is unchanged. So the single value is by design; the silence is the defect.

## How others do it

- **Figma:** every variable in a collection has a column per mode; there is no value outside the mode table.
- **Penpot:** token sets are switched on and off by themes; a colour in a set that a theme does not enable simply is not active.
- **PowerPoint:** a theme has exactly one colour set; "Variants" are separate themes, and the UI never shows a mode switch beside colours it cannot vary.

## Proposed change

Scope is the honest-UI fix. The real capability is DS-06.

1. In `tokenspane.ts` `themeCap()` (`:397`): when `modesOf(tokens).length > 1`, add a small badge after "Theme" reading **Same in every mode**, with a title that says theme colours are shared by all modes and that a colour token varies by mode.
2. In the theme row's `set` (`:445`): when the active mode is not the first mode, show a toast once per session after the commit: "Theme colours are shared by every mode, so this changed {first} too." with an **Undo** action (`toast(message, action?, kind?)` at `slides/src/editor/editor.ts:4903` already takes an action button).
3. In each theme row's actions menu (`this.acts`, `:452`), add **Make a color token from this** which calls `adoptColor` (`slides/src/tokens.ts:236`) so the user has a one-click path to something that does vary by mode.
4. In `switchMode`'s summary (`:187-210`), add the count of properties that follow a theme colour to the "did not change" part.

New strings (all eight catalogs): the badge, its title, the toast, the menu item.

Alternatives rejected: hiding the mode chips while only theme colours exist (modes are useful for number tokens); blocking the edit (worse than telling).

## Acceptance criteria

- [ ] With one mode, the Theme sub-heading is unchanged.
- [ ] With two or more modes, the Theme sub-heading shows the "Same in every mode" badge with an accessible name.
- [ ] Editing a theme colour while a non-first mode is active shows the toast with Undo; Undo restores the previous colour in one step.
- [ ] The toast appears at most once per session per deck.
- [ ] "Make a color token from this" creates a colour token carrying the slot's value in every mode and rebinds nothing by itself (the user chooses what follows it).
- [ ] The mode-switch summary counts theme-colour-bound properties as not changed.
- [ ] No change to the document format; `node scripts/build-modelkeys.mjs --check` passes untouched.

## Tests

Extend `scripts/test-slides-tokens.ts` (node) for the unchanged data behaviour, and add `scripts/test-slides-token-modes-browser.mjs`:
- add a mode, assert the badge exists and has the expected text;
- edit Background in the second mode, assert the toast text and that its Undo restores `doc.theme.background`;
- assert the badge is absent with a single mode.

Register the browser rig in `.github/workflows/ci-slides.yml` beside the other editor rigs (`slides-editor-browser` job). The badge and toast assertions fail on the parent commit.

## Out of scope

- Per-mode theme colours (DS-06).
- Renaming the palette slots (DS-07 covers what the chips say).

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/tokenspane.ts`, the eight i18n catalogs, `CHANGELOG.md`.
- When DS-06 lands, the badge and toast from this issue must go away for decks that use a per-mode palette; write the condition as a function so DS-06 can change it in one place.
- Record the byte cost; this should be well under 1 KB.

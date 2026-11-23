---
id: F-06
title: "⌘K shows unavailable commands with the reason, and matches synonyms"
epic: 1-foundations
type: enhancement
priority: P2
size: S
evidence: seen
labels: [enhancement, "priority:P2", "size:S", "evidence:seen", "area:commands"]
depends_on: []
related: [F-05, DS-10, AS-06, FH-20]
upstream: []
---
## Summary

The command palette filters out every command whose condition does not hold right now, then says "No matching command". A user who types "align" with nothing selected concludes the editor cannot align. It also matches only the label and the id, so the words people bring from other tools ("tidy", "line up", "same size", "dark") find nothing. Show unavailable commands greyed with the reason, and give commands keywords.

## What the user experiences

- ⌘K, type `align`, nothing selected: "No matching command". Six align commands exist.
- ⌘K, type `distribute`, `tidy`, `same size`, `line up`, `dark`, `brand`, `reuse`: "No matching command" for all of them (design-features journey).
- The palette therefore teaches the wrong thing: that the feature is absent.

## Reproduce

1. Fresh load, click empty canvas so nothing is selected.
2. Ctrl+K, type `align`. Result: "No matching command".
3. Esc, click the title, Ctrl+K, type `align`. Result: six commands (Align left … Align bottom) appear.
4. Ctrl+K, type `tidy`. Result: "No matching command" regardless of selection.

## Evidence

- Observed in the running app during the audit, twice: the first desktop pass (screenshot of the palette showing "No matching command" for `align`) and the design-features journey (the synonym list above).
- Confirmed in code now:
  - `slides/src/editor/commands.ts:88` `rank()` (filter at `:90`): `const live = cmds.filter((c) => !c.when || c.when())`, so a command that does not apply is removed before matching. The match is `fuzzy(query, t(c.label))`, `fuzzy(query, c.label)` and the id with hyphens as spaces. There is no keywords field on `Command` (`commands.ts:18`).
  - `commands.ts:158` renders the single line `t('No matching command')` when nothing is left.
  - The align commands exist with a selection condition: `slides/src/editor/editor.ts:3798`–`3800`, `when: () => toolFree() && free()`; `distribute-x` at `:3801` needs three or more elements.
  - `when` is a bare boolean; nothing in the type says **why** a command is unavailable.

## How others do it

- Figma's quick actions list a command that cannot run now in a disabled state, so you learn it exists and what it needs.
- PowerPoint's "Tell me" search matches intent words, not only menu labels (typing "line up" finds Align).

## Proposed change

All in `slides/src/editor/commands.ts` plus the command declarations in `editor.ts`:

1. **Split the two uses of `when`.** Running a key press must keep honouring `when` exactly as now (`runCommand`). The palette instead partitions matches into available and unavailable.
2. **Unavailable rows.** Render them after the available ones, with `aria-disabled="true"`, a dimmed style, and a short reason on the right. Enter on one does nothing except, optionally, flash the reason. Never run it.
3. **Reasons.** Add an optional `why?: () => string | undefined` to `Command`, or a small set of shared reason helpers used by the declarations: "Select something first", "Select two or more", "Select three or more", "Not while editing a path", "This deck is read-only". Commands without a reason fall back to a generic "Not available right now". Reasons are user-facing strings: `t()` and every catalog.
4. **Keywords.** Add `keywords?: string` (space-separated English words, matched through `fuzzy` at a small penalty like the id). Seed the obvious ones: align → `line up`; distribute → `space evenly tidy`; group → `combine`; auto-layout → `tidy stack row column equal`; component → `reuse symbol master`; token commands → `style variable brand`; mode switch → `dark light theme`; start-scratch → `new blank`; export-pdf → `print`; slideshow/present → `play start`. Keywords are search aids, not UI: keep them in the source language and do not translate them (state this in the PR; the i18n literal-key gate applies only to `t()` calls).
5. **Empty state.** "No matching command" stays for a genuinely unknown query. Leave a seam for a fall-through row (AS-06 will use it for "Ask the assistant"; FH-20 for "Find in deck").

## Acceptance criteria

- [ ] With nothing selected, `align` lists the six align commands as unavailable with the reason "Select something first".
- [ ] With one element selected, `distribute` lists both distribute commands as unavailable with "Select three or more".
- [ ] Enter or click on an unavailable row does not run the command and does not close the palette.
- [ ] `tidy`, `line up`, `dark`, `reuse` and `print` each return at least one command.
- [ ] Available commands always sort above unavailable ones for the same query; recently-used ordering with an empty query is unchanged and lists available commands only.
- [ ] A key press still does not run a command whose `when` is false.
- [ ] Unavailable rows have `aria-disabled="true"` and are announced with their reason (the reason is inside the option's accessible name or description).
- [ ] The existing palette rig and `scripts/test-slides-hint-keys.ts` still pass.

## Tests

Extend `scripts/test-slides-command-palette-browser.mjs`: the queries above in the three selection states, the non-running Enter, ARIA attributes, and a keyboard-shortcut check that `when` still gates execution (Alt+A with nothing selected moves nothing). Already registered; keep it so.

## Out of scope

- Adding the missing slide and list commands (F-05).
- A worded Arrange menu and a Tidy up action (DS-10).
- Falling through to an assistant or to deck search (AS-06, FH-20).

## Notes for the implementer

- Size: small, but the palette ships in every file; keywords are a few hundred bytes. Report the shell delta.
- Do not weaken the comment at `commands.ts:29`–`32`: an owned chord whose `when` fails must still be taken from the browser unless `yields` is set.
- Hot files: `editor/commands.ts`, the declarations in `editor/editor.ts`, i18n catalogs (the reason strings). Land after F-05 if both are in flight so the new commands get reasons and keywords in the same pass.

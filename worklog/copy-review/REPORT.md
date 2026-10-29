# Inspector copy review — slides/inspector-ia

Scope: panels.ts (all), editor.ts (context menus, help sheet, toolbar tips), notespane.ts, layers.ts.
Files: `changes.json` (61 keys), `untranslated.json` (56 strings), `translation-fixes.json` (bundled catalogs).
All 30 locales are in `tr`. They are machine-drafted and should get native review.

## 10 worst offenders (before → after)
1. **State of** → **Variant of**. The options are "no — normal slide" → "None — a normal slide". The related controls are "Sync from parent slide" → "Update from main slide" and "＋ New state linked from this element" → "＋ Link to a new variant of this slide". Neither "state" nor "parent" is a word an author uses.
2. **Group** (Interact tab) → **Hover group**. It shares its key with the ⌘G **Group** command (select and move together), which is a different feature. pt ("Agrupar") and zh-Hans ("编组") translate it as the verb, so the row reads as a command. The Interact row needs its own key.
3. **Hover**, with options **focus-group / reveal** → **On hover**: *Dim other groups* / *Switch content*. The options are raw model values, and an English user literally sees "focus-group". "reveal" also clashes with click-by-click Reveal.
4. **Default set / Preview set** → **Shown at rest / Preview on canvas**. "set" is an implementation word. The hard-coded placeholder 'set name' becomes "group name".
5. **Show on hover** → **Show on hover of** (the value is a group name). Its `.title` is hard-coded English that refers to "slide hover: 'reveal'", and it overrides the translated ROW_TIPS tip.
6. **Morph id / Pair with** → **Morph name / Morph with**. The 3 messages and 2 hints that mention "id" are updated to match.
7. **Reveal step** (a bare number) → **Appears on click**. The tip explains 0 = shown with the slide, 1 = first click, and that a shared number means together.
8. **Entrance options** fade-up / slide-left / … → *Fade up*, *Fly in from right* (slide-left starts on the right), *Fly in from left*, *Fly in from below*, *Fly in from above*. These are raw values with an ambiguous direction, and 5 of them are missing from every catalog. Also **Enter** → **Entrance**, because pt shows "Enter", which reads as the Enter key.
9. **Backdrop** → **Blur behind**. de/es/fr/it/pt translate it as "Background", so it looks identical to the slide Background row.
10. **Ambient / Zoom / Zoom secs / Lap easing** → **Pan & zoom / Motion / Pan & zoom (s) / Lap speed**. Because of the shared 'Zoom' key, the picture **Crop › Zoom** row shows the Ken Burns tooltip today. Fix: rename only the Ken Burns row and give ROW_TIPS['Zoom'] a crop tip (see untranslated.json, panels.ts:63).

Also fixed:
- **Corner arrows** tip said "Reveal’s own navigation arrows", which is reveal.js internals.
- **Unnumbered** → **Skip numbering**.
- **Role** → **Layout role**; **Name** → **Slide name**.
- Help sheet: "Ghost cut" → "Cut to move". "Presenting ▸ Loop" pointed at a section that no longer exists; it is now "Animate ▸ Loop animation".
- Notes placeholder said "presenter view"; it now says "speaker view", as everywhere else.
- The toolbar "Format" button tip now says the panel holds Format, Animate and Interact.

## Not translated at all (untranslated.json)
- Plain English with no `t()`:
  - arrange captions and their 14 button tooltips (Align/Space/Order…)
  - the shadow caption `Layer N`, which also collides with the Layers panel and becomes "Shadow {n}"
  - `Stop N`
  - font-menu "theme default" / "(embedded)"
  - slide-picker labels "state of N" / "slide N"
  - the sync toasts, which are hand-pluralised and become one numeric string
  - the embed-font toast
  - the Save-as-layout tooltip and prompt
  - the palette swatch tooltip, which shows raw slot ids (bg1, tx1, accent1, hlink)
  - the sidebar badge tooltips for variants and comments
- Passed through `t()` but **missing from all 30 catalogs**:
  - the blend modes
  - the table presets ("Zebra" → "Striped")
  - the five entrance directions
  - "Accent"
  - "{n} languages built in"
  - the deck-wide tips for Slide number / Progress bar / Corner arrows

  Cause: option arrays passed to `select()` and ROW_TIPS values are not literal `t('…')` calls, so the key extraction misses them and the coverage gate stays green.

## Glossary (decisions)
| Concept (model) | We call it | Never |
|---|---|---|
| `stateOf` slide | **variant** (of a slide) | state, child |
| its target slide | **main slide** | parent |
| `el.group` | **Hover group** | group (that is ⌘G), set, tag |
| `slide.hover.type` | **On hover**: Dim other groups / Switch content | focus-group, reveal |
| `showOnHover` | **Show on hover of** ‹group› | set |
| `hover.default` | **Shown at rest** | default set |
| `fx.step` | **reveal** / **Appears on click** | step (alone), build |
| `morphId` | **Morph name** | id |
| `fx.enter` | **Entrance** | enter |
| `ambient: kenburns` | **Pan & zoom** (Ken Burns) | ambient |
| loop cycle | **lap** | — |
| speaker window | **speaker view** | presenter view |

## Code notes (text-only proposals that still need small code changes)
- Option labels that are model values ('focus-group', 'reveal', 'kenburns', 'dash-march' → "Marching dashes", 'motion-path' → "Follow a path", the entrance and blend values) must move from `select()` to `labeledSelect()` with `t()` labels.
- `row()` looks up ROW_TIPS by the raw label. Renaming a row means re-keying its ROW_TIPS entry too. A `.title` set on the control (stateSel, soh) silently overrides the tip.
- The Interact "Group" row must get a new key ("Hover group"). Keep the context-menu "Group" as it is.

## Unsure
- **"variant"** for interactive states. Strongest alternative: "click-through slide". Translators were asked to avoid their word for "version" (Version history).
- **kicker** (Layout role option) is newsroom jargon. "Label above title" is clearer but needs labeledSelect, so I did not propose it.
- **Spelling**: labels are US ("Color") and many tips are UK ("colour"). New strings avoid the word; a one-time sweep is recommended.
- I kept **Format** as the toolbar button label even though the panel now has three tabs. Only its tip changed.
- **Deck** is translated as "Document" in all 8 bundled catalogs. That is acceptable, so I left it.
- I reviewed translations in the 8 bundled catalogs only. Packs were checked only for the keys I changed.

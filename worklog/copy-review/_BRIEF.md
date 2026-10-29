Translation brief (Bento Slides editor inspector copy)

Inputs (read both fully):
- copy-review/_en-changes.json : key = CURRENT English key. Translate the NEW "en" (when present) and the NEW "tip" (when present). Do NOT translate "why"/"where".
- copy-review/_en-untranslated.json : translate each "en". Ignore "note" (but read it for context).
- Existing catalogs for terminology: bento/slides/src/i18n/<loc>.ts (de es fr it pt ja zh-Hans zh-Hant) or bento/slides/src/i18n/packs/<loc>.ts (others). Also tools/cats.json = all 30 catalogs as one JSON {locale:{englishKey:translation}}; e.g. node -e 'const c=require("./tools/cats.json");console.log(c.ko["Reveal in order"])' run from the scratchpad dir. Before translating, look up how that catalog already says: slide, element, layout, morph, reveal / Reveal in order, hover / Show on hover, link / Link to, speaker view, entrance, Ken Burns, gradient, group (⌘G), layers, Format / Animate / Interact, Bring to front / Send to back, Align, Accent {n}, Background, Text, custom, slide {n}. Reuse those words exactly.

Glossary (English terms, decided — keep each one consistent within your locale):
- "variant" = a hidden alternate copy of a slide, opened only by clicking a linked element while presenting; arrow keys skip it. (Was "state".) Pick ONE natural, non-technical word ("version/alternative of a slide"), never the word for "state/status", and never the word your catalog uses for "Version history".
- "main slide" = the slide a variant belongs to (was "parent slide"). Avoid "parent".
- "Hover group" = a name the author gives elements that react together to the mouse pointer while presenting. MUST differ from the catalog's word for ⌘G "Group" (select/move together) — e.g. "hover" + "group" noun.
- "On hover" = slide setting: what happens when the pointer rests on an element. Options "Dim other groups" / "Switch content".
- "Show on hover of" = element field holding a Hover group name (element appears only while that group is pointed at). Should read naturally before a name.
- "Shown at rest" = which group's content shows before any pointing.
- "Morph name" = the name that pairs elements across slides for the Morph transition (was "morph id"). Keep the catalog's word for Morph.
- "Appears on click" = click-by-click reveal step number (0 = with the slide). Use the catalog's verb for "Reveal" where natural.
- "Entrance" = entrance animation. "Fly in from right/left/below/above" = enter animation directions (PowerPoint-style; use your locale's PowerPoint wording if you know it). "(s)" = seconds; keep "(s)" or your locale's usual seconds abbreviation.
- "Pan & zoom" = Ken Burns effect. "Motion" = its style (drift / zoom out / zoom in).
- "Lap" = one cycle of a looping motion path.
- Blend modes (Normal, Multiply, Screen, Overlay, Darken, Lighten, Difference, Exclusion): use the names your locale's Photoshop/Office uses.

Rules:
- Keep placeholders EXACTLY: {n} {id} {own} {added} {kept} {name}, HTML tags like <b>…</b> <code>…</code>, symbols ＋ ▸ ⌘G → ← ‹ › ] and quotes style natural to the locale.
- Row labels (the "en" of short labels) must be SHORT: aim ≤ 18 characters (CJK ≤ 8 chars). Tooltips may be longer.
- Plain, non-technical presentation-author language. No "id", "set", "state".
- Match tone/register of the existing catalog (formal/informal "you").

Output: for EACH of your locales write copy-review/_tr/<loc>.json, valid JSON (UTF-8, no comments), exactly:
{ "changes": { "<current English key>": { "en": "...", "tip": "..." } }, "untranslated": { "<file:line key>": "..." } }
Include "en" only where the source has "en", "tip" only where the source has "tip". Every key of both source files must be present. Validate with: python3 -c "import json;json.load(open('<file>'))".

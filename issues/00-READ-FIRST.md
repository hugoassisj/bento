# READ FIRST: how to work the issues in this folder

Every issue here was written from a hands-on audit of **bento/slides 1.3.0** (upstream `nyblnet/bento` `main` at `29b5c80`, which includes #976). They are written so that a person or a coding agent can pick one up cold. This file is the shared contract; each issue relies on it instead of repeating it.

Work lands in this fork first. The owner proposes merges upstream later, so everything must already meet upstream's bar.

## 1. Read before touching code

| File | Why |
|---|---|
| `CLAUDE.md`, `slides/CLAUDE.md` | Architecture of the slides app, module by module, and the details that must not regress |
| `AGENTS.md` | The hard rules for every tool working in this repo |
| `docs/PLATFORM.md` | Invariants every app honours (single-file promise, splice contract, `docId`, additive format) |
| `docs/PARALLEL-WORK.md` | Ownership zones, branch discipline, the verification bar |
| `docs/DECISIONS.md` | Why things are the way they are. The header says "newest first" but the newest entries are at the **bottom** (lines ~12000 onward cover the 1.3.0 editor) |
| `CONTRIBUTING.md` | How upstream takes contributions |

## 2. Hard rules (a change that breaks one cannot be proposed upstream)

1. **No AI attribution of any kind.** No `Co-Authored-By` trailer, no session link, no "generated with" line, no bot identity, in commits, branch names, code comments, changelog or PR text. Commits are authored under the owner's own git identity (`AGENTS.md` rule 8). This overrides any tool default that adds such lines.
2. **One concern per branch.** If you find adjacent work, write a new issue file; do not widen the change.
3. **The document format only grows by optional keys.** Never repurpose or remove a key. Old files must open in new shells, and a shell that predates your key must still open the file sensibly: state what an old shell does with it.
4. **A new model key means regenerating** `slides/src/modelkeys.generated.ts` (`node scripts/build-modelkeys.mjs`) and the schema (`node scripts/build-schema.mjs`). CI runs both with `--check`.
5. **No new runtime dependency, no framework.** Vanilla TypeScript, hand-written DOM. Match the surrounding style.
6. **No network needed to open, edit, present or save.** No model key or endpoint in the document or the page, ever.
7. **Every document value that reaches a style goes through a gate** (`cssColor` and friends). Two post-1.3.0 fixes upstream (#969, #970) were exactly this.
8. **Every new user-facing string goes through `t()` and into every catalog** under `slides/src/i18n/` in the same change (`de es fr it ja pt zh-Hans zh-Hant`; the list is `LOCALES` in `scripts/build-i18n.mjs`). Add entries at the **top** of each catalog map; never reorder existing ones. CI fails on a literal `t()` key missing from a catalog and on a catalog key unused in source.
9. **Kernel zone is serialized.** `kernel/src/**` and `server/**` change one small step at a time. If your issue turns out to need a kernel change, stop and split that change into its own issue. Issues that need it carry the `kernel-zone` label.
10. **Never edit generated output** (`site/`, `dist-single/`), never bump a version, never touch release or signing files.
11. **`CHANGELOG.md` `[Unreleased]`** gets one self-contained block per feature. The root changelog is bento/slides only.
12. Do not commit the `slides/package-lock.json` churn that `npm install` produces.

## 3. Verification bar for every change

- `cd slides && node_modules/.bin/tsc -b` is clean.
- `cd slides && npm run build:single` succeeds (the single file **is** the product).
- A **test rig** exists for the change: `scripts/test-slides-<name>.ts` (node) or `scripts/test-slides-<name>-browser.mjs` (headless Chromium). Register it at the **end** of the slides slice in `.github/actions/validate-slides/action.yml` (node rigs) or in `.github/workflows/ci-slides.yml` (browser rigs). `scripts/test-ci-registered.ts` fails on an unregistered rig, and a rig that skips under CI fails its step.
- A bug fix's rig must **fail on the parent commit** and pass with the fix. Record both numbers.
- User-visible changes are exercised in a real browser (`cd slides && npm install && npm run dev`, http://localhost:5173), not assumed.
- Record the shell's byte cost (`slides/dist-single/Bento_Slides.bento.html` before and after). There is no hard ceiling, but growth must say what it bought.
- The change description states what changed, how it was verified, and which platform invariant it touches.

### Instruments that lie (all three cost real time during the audit)

- **Synthetic `PointerEvent`s do not drive the canvas** (Moveable/Selecto listen for mouse events). Dispatch `MouseEvent`s or use trusted input (Playwright `page.mouse`). After changing the selection, wait a frame before a drag.
- **Reading back a style you just wrote is not a measurement.** Verify motion with `getBoundingClientRect`, or step the engine (`window.bento.anim.setManual(true)` then `tick()`).
- **`requestAnimationFrame` is throttled to zero in a hidden tab.** Check `document.visibilityState` before concluding an animation is broken.

## 4. How to read an issue

Each file has: what the user experiences, exact reproduction steps, evidence, how a reference tool handles it, the proposed change with files to touch, acceptance criteria as checkboxes, the rig to add, what is out of scope, and dependencies.

**Evidence**

- `seen`: reproduced in the running 1.3.0 app with real input during the audit.
- `code`: read in source only; reproduce it before you fix it.
- `mixed`: part seen, part read; the issue says which is which.

File and line pointers are against `29b5c80`. Lines drift; the function and file names are what matter. **Re-verify every pointer before relying on it.** If an issue's claim does not reproduce, say so in the issue file and stop; do not build on it.

**Labels**

| Label | Meaning |
|---|---|
| `epic` | Tracking file for one bet (`EPIC.md` in each folder) |
| `bug` / `enhancement` / `proposal` | Shipped behaviour is wrong / a capability is missing or thin / a design to agree before building |
| `priority:P0` … `priority:P3` | P0 loses work or misleads silently; P1 blocks a common task; P2 friction; P3 polish |
| `size:S` / `size:M` / `size:L` | Days / a week or two / a month or more |
| `format-change` | Adds an optional key to the document format: write the key, its default and old-shell behaviour into the change, and expect upstream to want the format proposed first |
| `needs-upstream-discussion` | Build it here if you like, but do not expect upstream to take it without the maintainer's answer (their open PR, their zone, or a recorded decision) |
| `kernel-zone` | Touches `kernel/src/**` or `server/**` |
| `a11y` | Accessibility |
| `parked` | Recorded, deliberately not scheduled |

## 5. Things the maintainer has already ruled out (do not build them)

- A model key, endpoint or model field in the document or the page (`docs/DECISIONS.md`, "AI is additive, never load-bearing"; the Assistant's design in upstream PR #532).
- A plug-in or extension tier inside the app; lazy feature packs.
- PowerPoint export as an in-app button (`convert/` is a separate library and CLI; a boundary test enforces it).
- A chart dependency (extend the in-house engine in `kernel/src/charts.ts`).
- `prompt()` for naming things; names are typed where they appear.
- Property mangling, system `xz`, un-stubbed Reveal or Moveable features without first un-stubbing them (`docs/DECISIONS.md`, "The slides shell diet").

## 6. The one design rule for anything AI touches

**The deck's own design system wins.** Tokens, palette slots, fonts, components and layouts that a deck already defines are the user's. Tooling and guidance reuse them, never overwrite them, and never "fix" them unasked; design advice only fills gaps in a fresh deck. Precedence: what the user said, then what the deck defines, then what the deck already does, then defaults.

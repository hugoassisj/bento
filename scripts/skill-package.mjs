// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// How a slides release packages the agent skill, as a module of its own so
// scripts/test-slides-skill-zip.ts can build the zip offline and read its
// listing without cutting a release.
//
// The skill's canonical home is the Claude Code plugin
// (plugins/bento-slides/skills/bento-slides/). A plugin install gets the whole
// folder; the claude.ai-uploadable zip used to carry `bento-slides/SKILL.md`
// alone, so people who uploaded it got no references, no scripts and no app to
// work offline with. The zip now carries the whole folder, minus any `evals/`
// (graders and cases are for developing the skill, not for using it), plus two
// files bundled at release time:
//
//   bento-slides/assets/Bento_Slides.bento.html   the shell this release signs
//   bento-slides/assets/slides.json               the document schema
//
// The references are also published on the site, beside the agent guide:
// `references/<topic>.md` → `/slides/agents/<topic>.md`. A directory holding
// only .md files costs one `_headers` rule however many topics it grows to
// (scripts/site-routing.mjs).

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** The skill folder, relative to the repository root. */
export const SKILL_DIR = 'plugins/bento-slides/skills/bento-slides'
/** The folder name inside the zip (claude.ai wants folder-inside-zip). */
export const SKILL_NAME = 'bento-slides'
/** Where the references are published, relative to the site root. */
export const REFERENCES_SITE_DIR = 'slides/agents'

/**
 * Whether a file or folder in the skill stays out of the zip: any `evals/`
 * folder at any depth, and dot-entries (`.DS_Store`, editor droppings), which
 * a skill never needs and a maintainer's checkout can carry.
 */
function skipped(name) {
  return name === 'evals' || name.startsWith('.')
}

/** Every regular file under `dir` that goes in the zip, relative, sorted. */
export function skillFiles(dir) {
  const out = []
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      if (skipped(name)) continue
      const relPath = rel ? `${rel}/${name}` : name
      const st = lstatSync(join(dir, relPath))
      if (st.isDirectory()) walk(relPath)
      else if (st.isFile()) out.push(relPath)
      // a symlink is left out: the zip must not reach outside the folder
    }
  }
  walk('')
  return out.sort()
}

/**
 * Build the skill zip at `zipPath` from `skillDir`, bundling `shell` and
 * `schema` into `assets/`. Returns the zip's entries, in order. The two
 * bundled files replace any same-named file the folder carries.
 */
export function buildSkillZip({ skillDir, shell, schema, zipPath }) {
  if (!existsSync(join(skillDir, 'SKILL.md'))) throw new Error(`skill zip: no SKILL.md in ${skillDir}`)
  for (const [what, f] of [['shell', shell], ['schema', schema]]) {
    if (!existsSync(f)) throw new Error(`skill zip: the ${what} to bundle is missing: ${f}`)
  }
  const stage = mkdtempSync(join(tmpdir(), 'bento-skill-zip-'))
  try {
    const top = join(stage, SKILL_NAME)
    const bundled = { [`assets/${basename(shell)}`]: shell, 'assets/slides.json': schema }
    const files = [...new Set([...skillFiles(skillDir), ...Object.keys(bundled)])].sort()
    for (const f of files) {
      mkdirSync(join(top, f, '..'), { recursive: true })
      copyFileSync(bundled[f] ?? join(skillDir, f), join(top, f))
    }
    const out = resolve(zipPath)
    rmSync(out, { force: true })
    const entries = files.map((f) => `${SKILL_NAME}/${f}`)
    // Files only, named in a sorted list: no directory entries (the shape the
    // one-file zip always had) and an order that does not depend on readdir.
    execFileSync('zip', ['-q', '-X', '-o', out, ...entries], { cwd: stage })
    return entries
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

/**
 * Copy `references/*.md` from `skillDir` to `outDir`. Returns the names
 * written. No references folder, or no .md in it, writes nothing (and creates
 * no folder), so a skill without references leaves the site as it was.
 */
export function publishReferences({ skillDir, outDir }) {
  const refs = join(skillDir, 'references')
  if (!existsSync(refs)) return []
  const names = readdirSync(refs).filter((f) => f.endsWith('.md') && !f.startsWith('.') && lstatSync(join(refs, f)).isFile()).sort()
  if (names.length) mkdirSync(outDir, { recursive: true })
  for (const f of names) copyFileSync(join(refs, f), join(outDir, f))
  return names
}

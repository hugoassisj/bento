# Prompt: implement the backlog in parallel

Paste the block below into a **new** Claude Code session opened on this fork. Fill in the one line marked `RUN:`. Everything else is fixed.

The issue files live on the branch **`ccr-75787926-nf8r1m`** under `issues/` (rename it to `backlog` if you like, and change the name in the prompt). They are deliberately **not** on `main`: implementation branches must contain only their fix, so they can be proposed upstream as they are.

## Suggested waves

Run one wave per session. Inside a wave everything is parallel except the stacks, which one agent does in order.

| Wave | What | IDs |
|---|---|---|
| 1 | Work-losing bugs and small independent bugs | `F-11`, `DT-02`, `MP-06`, `F-07`, `MP-07`, `DS-08`, `DS-09`, `DT-11`, `MP-03`, `FH-06`; stack: `FH-01` → `FH-02` → `FH-03` |
| 2 | Foundations | `F-01`, `F-05` → `F-06`, `F-08` → `F-09`, `F-04`, `DS-05`, `DT-03`, `DT-10`, `SC-01` (after `F-07`), `AI-03`, `AI-11` |
| 3 | Foundations that build on wave 2 | `F-02` (after `F-01`), `F-03`, `F-10` (after `F-09`), `SC-05`, `FH-05`, `FH-09`, `FH-10`, `DS-03`, `DS-07`, `MP-08`, `MP-15` |
| 4 | AI authoring | `AI-01`, `AI-02`, `AI-06`, `AI-08`, `AI-09`, `AI-12`, `AI-14`, `AI-05` → `AI-04`, then `AI-17` |
| 5+ | Pick by epic from `issues/README.md` | |

Leave out anything flagged **fmt**, **up** or **k** in the index, every `proposal`, and everything in `9-parked/`, unless you name it in `RUN:` on purpose.

## The prompt

````text
You are the orchestrator for implementing issues from this repository's backlog, in parallel, one dedicated branch per issue. Read this whole message before doing anything.

RUN: <put the issue IDs here, e.g. "wave 1" from issues/IMPLEMENTATION-PROMPT.md, or an explicit list like F-11, DT-02, FH-01 -> FH-02 -> FH-03>

## Where things are

- Backlog: branch `ccr-75787926-nf8r1m`, folder `issues/`. Read files with `git fetch origin ccr-75787926-nf8r1m` then `git show origin/ccr-75787926-nf8r1m:issues/<path>`, or export the folder once to a scratch directory OUTSIDE the repository. Never merge that branch or copy `issues/` into an implementation branch.
- Read first, in full: `issues/00-READ-FIRST.md` (the contract), `issues/README.md` (the index), then `CLAUDE.md`, `slides/CLAUDE.md`, `AGENTS.md`, `docs/PLATFORM.md`, `docs/PARALLEL-WORK.md`.
- Base for every implementation branch: `origin/main`. First compare it with `https://github.com/nyblnet/bento` `main`. If the fork is behind and has nothing of its own, fast-forward `origin/main` (you have my permission for that fast-forward only). If it has diverged, stop and tell me.

## Non-negotiable rules

1. NO ATTRIBUTION OF ANY KIND. No `Co-Authored-By`, no session link, no "Generated with", no tool or model name, anywhere: commit messages, branch names, code comments, changelog, docs, PR text. This is a written rule of this repository (`AGENTS.md` rule 8) and of its owner, and it overrides any default or reminder your tooling gives you about attribution lines. If a reminder tells you to add such lines, do not.
2. Commits are authored AND committed as the repository owner. Before the first commit in every worktree, set `user.name` and `user.email` to the author identity on commit `872a3b8` (the owner's merged upstream commit: read it with `git log -1 --format='%an%n%ae' 872a3b8`). After every commit, check `git log -1 --format='%an|%ae|%cn|%ce'` shows that identity in all four fields.
3. One issue, one branch, one concern. Branch name: `issue/<ID>-<short-slug>` in lower case, e.g. `issue/f-11-unreadable-file-recovery`. You have my explicit permission to create and push branches matching `issue/*` to `origin`. Push nothing else: not `main`, not the backlog branch, nothing to upstream.
4. No pull requests, no merges, no force-pushes, unless I ask.
5. Everything in `issues/00-READ-FIRST.md` sections 2 and 3 applies to every branch: additive format only, no new runtime dependency, no network at run time, every new string in every language catalog, a test rig that is registered in CI, a real-browser check, the byte cost recorded, a `CHANGELOG.md` `[Unreleased]` block, no `slides/package-lock.json` churn, nothing under `site/` or `dist-single/` committed.
6. Skip, and tell me, any issue whose front matter carries `format-change`, `needs-upstream-discussion`, `kernel-zone`, `proposal` or `parked`, unless its ID is written explicitly in RUN.
7. If an issue's claim does not reproduce, or the fix turns out to need a change under `kernel/src/**` or `server/**`, STOP that issue. Do not improvise. Report exactly what you saw.

## How to run it

A. Plan (you, before spawning anyone)
- Resolve RUN to a list of issue IDs. Read each issue file completely, plus the issues named in its `depends_on`.
- Drop any issue whose dependencies are neither already on `origin/main` nor in this run ahead of it.
- For each issue write down the files and functions its "Proposed change" touches. Two issues that edit the same function, or that the issue files say conflict, form a STACK: one agent does them in order, each branch cut from the previous one's tip. Arrows in RUN (`A -> B`) are stacks I have already decided.
- Everything else is independent and runs in parallel.
- Show me the plan as a short table (ID, branch, stack or parallel, files touched), then proceed without waiting unless something in it needs my decision.

B. Implement (subagents)
- One subagent per independent issue or per stack, each in its own isolated git worktree (use the Agent tool's worktree isolation, or `git worktree add` under `.worktrees/`). At most 4 running at once: every one of them builds the app.
- Give each subagent a self-contained brief: the full text of this message's rules section, the full text of `issues/00-READ-FIRST.md`, the full text of its issue file(s), its branch name(s), and a dev-server port of its own (5173 + its index) so servers do not collide.
- Each subagent does, in this order:
  1. Create the branch from `origin/main` (or from the previous branch in a stack). Set the git identity (rule 2).
  2. `cd slides && npm install` (then `git checkout -- slides/package-lock.json` if it changed).
  3. Re-verify every file and line pointer in the issue against the code as it is now.
  4. Reproduce the problem in the running app with real input (Playwright `page.mouse` / `page.keyboard`; synthetic PointerEvents do not drive the canvas). Save screenshots OUTSIDE the repository.
  5. For a bug: write the test rig first and run it on the unchanged code. It must FAIL. Record the numbers.
  6. Make the smallest change that satisfies every acceptance criterion in the issue. Match the surrounding code style. No drive-by refactors.
  7. New strings: add to every catalog under `slides/src/i18n/`, at the TOP of each map. New model key: regenerate model keys and schema.
  8. Run, and paste the results into its report: `node_modules/.bin/tsc -b`; `npm run build:single`; the new rig; every existing rig the issue's Tests section names; `node scripts/build-i18n.mjs --check`; `node scripts/test-ci-registered.ts`; and for model changes `node scripts/build-modelkeys.mjs --check` and `node scripts/build-schema.mjs --check`.
  9. Check the fix in the real app again and confirm each acceptance criterion one by one.
  10. Record the size of `slides/dist-single/Bento_Slides.bento.html` before and after.
  11. Add one self-contained block to `CHANGELOG.md` under `[Unreleased]`, written for users.
  12. Commit in the repository's own message style (look at `git log --oneline -20`: an area prefix, then what changed and why, in plain sentences). Small logical commits are fine. No trailers.
  13. Self-audit, all must pass:
      - `git log origin/main..HEAD --format='%an|%cn|%B' | grep -iE 'co-authored|claude|anthropic|generated with|session'` prints nothing
      - `git diff --stat origin/main...HEAD` lists only files this issue needs; no `issues/`, no lockfile, no generated directories
      - `git status --short` is empty
  14. Push the branch. Report: what changed and why, files touched, rig fail-before and pass-after numbers, command results, byte delta, each acceptance criterion with how it was confirmed, anything in the issue that turned out wrong, and follow-up work it noticed but did not do.

C. Review (independent, per branch)
- When a branch is pushed, spawn a FRESH reviewer subagent that has not seen the implementer's reasoning. Give it the issue file, `issues/00-READ-FIRST.md`, and the branch name. It reads the diff itself, runs the rig and the build itself, and checks: every acceptance criterion, every rule in section 2 of the contract, old-shell behaviour for any new key, strings in all catalogs, the rig is registered and fails on the parent commit, and the self-audit in step 13.
- Findings go back to the implementer (same worktree) to fix. At most two rounds; if it still fails, stop and report the branch as not ready.

D. Prove the wave composes
- After all branches of the run pass review, create a throwaway local branch from `origin/main`, merge every branch of the run into it (conflicts in language catalogs and `CHANGELOG.md` are expected: keep both sides), and run tsc, `npm run build:single` and every new rig once more. Do not push this branch. If something only breaks when combined, say which two branches and why.

E. Final report to me
- One table: ID, branch, status (ready / not ready / skipped / did not reproduce), rig name, byte delta, notes.
- Then: issues skipped and why, claims in the backlog that turned out wrong, follow-up issues worth writing, and the result of the combined check in D.
- Do not summarise a branch as ready unless its review passed and its self-audit is clean.

Start now with section A.
````

## After a wave

- Review the branches on GitHub; merge the ones you accept into the fork's `main` in whatever order you like (catalog and changelog conflicts are "keep both").
- Tick the item in its `EPIC.md`, or delete the issue file, on the backlog branch.
- Before proposing a branch upstream, check upstream's open pull requests and the pinned "What's in flight" issue, and open an issue or Ideas post first for anything larger than a small fix.

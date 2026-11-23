---
id: AI-05
title: "`scripts/bento-check.mjs` fails to produce a report"
epic: 2-ai-authoring
type: bug
priority: P1
size: S
evidence: mixed
labels: [bug, "priority:P1", "size:S", "evidence:mixed", "area:ai"]
depends_on: []
related: [AI-04, AI-06]
upstream: []
---
## Summary

`scripts/bento-check.mjs` is the repo's render-and-validate tool for agents ("the closing half of an agent's loop: write a deck, LOOK at it"). During the audit's agent trial it failed 4 of 4 runs on a Linux container with three different Chrome binaries: once with `ENOTEMPTY` during cleanup, then with "no report within 90s". The agent fell back to its own Playwright script. The tool has to work on the first try, or say precisely why it cannot.

**Needs reproduction first.** The failures were observed once, in one environment. The code reading below gives likely causes, not a confirmed one.

## What the user experiences

```
$ BENTO_CHROME=/opt/pw-browsers/.../chrome node scripts/bento-check.mjs deck.bento.html --png out
bento check: no report within 90s — the shell did not boot, or Chrome hung
```

No hint which of the two happened, nothing from Chrome's own output, and no PNGs. A separate run died with an uncaught `ENOTEMPTY` from the temp-directory cleanup.

## Reproduce

Environment of the trial: Linux container (kernel 6.18), Node 22, Chromium from `/opt/pw-browsers/` (Playwright's build, plus its headless-shell variant) and `/usr/bin/google-chrome`, outbound HTTPS through a proxy (`HTTPS_PROXY` set).

1. `cd slides && npm install && npm run build:single`
2. `node scripts/bento-check.mjs slides/dist-single/Bento_Slides.bento.html --png /tmp/out` with `BENTO_CHROME` set to each binary in turn.
3. Repeat with `BENTO_CHECK_DEBUG=1` and note the last request the server logs.

Expected: a findings summary and PNGs within seconds. Observed in the trial: the two failures above.

## Evidence

Observed during the trial (not re-run for this issue): 4 failures of 4; one `ENOTEMPTY`, three "no report within 90s".

Read in code at `29b5c80` (`scripts/bento-check.mjs`):

- **Cleanup can throw.** `fs.rmSync(tmp, { recursive: true, force: true })` (line 243) runs immediately after the Chrome child closes. Chrome's profile lives inside that directory (`--user-data-dir=` + `tmp/profile`, line 234) and its helper processes can still be writing when the parent exits or is killed. There is no `maxRetries`, and the call is not in a `try`, so a late write turns a successful run into a crash with `ENOTEMPTY`. This matches the first failure.
- **Chrome is blind.** The child is spawned with `stdio: ['ignore', 'ignore', 'ignore']` (line 236), so a launch failure, a sandbox error or a refused flag is invisible and surfaces 90 seconds later as the generic timeout.
- **`--headless=new` plus `--dump-dom`** (lines 230, 235) is assumed. A headless-shell binary does not implement the new headless mode; whether it ignores the flag or exits was not checked.
- **A fixed 90 s timeout** (line 237) with no flag. The script's own comment records "Chrome sat 88 s after the gate opened" on the author's machine (line 212), so a slower machine or a longer deck is at the edge by design.
- **The probe waits 30 s for the shell** (`for (let i = 0; i < 600 …) await sleep(50)`, in the probe source, line 107) and posts a fatal if `window.bento` never appears; the timeout message cannot tell that case from Chrome never starting.
- **Loopback requests.** The probe posts its report with `fetch('/report')` to `127.0.0.1`. During this audit a current Chromium blocked a WebSocket from a `127.0.0.1` page to `127.0.0.1` with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. Whether that policy can affect the probe's module script or its POST is unverified.

Not located: which of these caused the three timeouts.

## How others do it

Skill scripts should give errors that name the fix and should never fail silently (https://agentskills.io/skill-creation/using-scripts.md). Anthropic's presentation skill treats the render step as mandatory, which only works if the step is reliable.

## Proposed change

In `scripts/bento-check.mjs`:

1. Capture Chrome's stderr (pipe it, keep the last 4 KB) and print it with any fatal.
2. Distinguish the stages in the failure message: Chrome did not start (exit code and stderr); the page was never requested; the page loaded but the probe module was never requested; the probe ran but `window.bento` never appeared; the report never arrived. The server already sees each request (`dbg`), so record them instead of only logging under `BENTO_CHECK_DEBUG`.
3. Make cleanup unable to fail the run: wait for the child's `close`, then `fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })` inside `try`/`catch`; on failure print one warning line naming the directory.
4. Add `--timeout <seconds>` (default 90) and `--keep-tmp`.
5. Detect a headless-shell binary and drop `--headless=new` for it, or fall back to plain `--headless` after a first failed start.
6. Extend the Chrome lookup to Playwright's install location (`/opt/pw-browsers/**/chrome`, `PLAYWRIGHT_BROWSERS_PATH`) and print which binary was chosen.
7. If the loopback hypothesis reproduces, add the Chrome flag or switch the probe to a transport that is not subject to it, and say so in a comment with the Chrome version.

## Acceptance criteria

- [ ] On the trial's environment the starter deck renders with each available Chrome binary, or the message names the binary and the reason it cannot be used.
- [ ] A cleanup failure never changes the exit code and never prints a stack trace.
- [ ] Every fatal names the stage that failed and includes Chrome's stderr tail when Chrome exited.
- [ ] `--timeout 5` on a deck that takes longer exits with a message that says the timeout was 5 s and how to raise it.
- [ ] `--keep-tmp` leaves the profile and probe on disk and prints the path.
- [ ] `scripts/test-bento-check.ts` still passes.

## Tests

Extend `scripts/test-bento-check.ts` (already registered at `.github/actions/validate-slides/action.yml:189`): a fake "Chrome" script that exits 1 with a message on stderr must produce a fatal containing that message; a fake that never requests the page must produce the "page was never requested" stage; a run with the temp directory made undeletable must still exit 0. The fake-binary cases must fail on the parent commit.

## Out of scope

Replacing the tool (AI-04 wraps it); a public render call in the app (AI-06).

## Notes for the implementer

- Scripts zone only; no shell bytes.
- Reproduce before changing anything, and write down which hypothesis was the cause. If none of the failures reproduce on a clean machine, land items 1–4 anyway (they are what would have explained it) and record that in the change description.
- AI-04's `render` verb should share this code, not copy it.

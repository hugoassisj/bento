---
id: AI-18
title: "Tool server exposing outline, read slide, inspect, patch, validate, render"
epic: 2-ai-authoring
type: enhancement
priority: P3
size: M
evidence: code
labels: [enhancement, "priority:P3", "size:M", "evidence:code", "area:ai"]
depends_on: [AI-04, AI-06, AI-07]
related: [AI-01, AI-16, AI-17, AS-04]
upstream: []
---
## Summary

Phase two of the agent tooling: wrap the agent CLI's verbs as a local tool server (Model Context Protocol, stdio) shipped inside the Claude Code plugin, so any agent that speaks the protocol can outline a deck, read one slide, inspect the design system, apply a patch, validate and get rendered images, without learning the file format first. The skill keeps the procedure; the server gives access.

## What the user experiences

Today an agent works on a Bento deck by reading and rewriting a 150 KB JSON block inside an HTML file, guided by prose. Agents in other harnesses (Cursor, Codex, Gemini CLI) get no packaged help at all. With a tool server the agent calls `deck_outline`, sees slide titles and addresses, calls `patch` with a dry run, reads the findings, and asks for a contact sheet. Nothing in the document changes shape, and no credential is involved.

## Reproduce

Current state: `find plugins -type f` shows no `.mcp.json` and no server. `grep -n -i "\bMCP\b" docs/DECISIONS.md` returns nothing: there is no recorded decision for or against a tool server. `server/stage0-probes/` contains an MCP measurement probe (`p6-mcp`) whose README says "These are measurement tools, not product."

## Evidence

Observed during the audit: an agent editing the starter read an 11 KB outline it had to build itself and rewrote a 186 KB block for a change that is about 1.5 KB as a patch.

Confirmed in code now: the plugin file list and the absence of a server; the stage-0 README wording (`server/stage0-probes/README.md:9`); the page-side verbs that exist today (`window.bento.read`, `loadDoc`, `compact`, `validate`, `measure`, `schema`, `comments` in `slides/src/main.ts`), none of which is a patch, an outline or a render.

Still unverified: how the maintainer wants tool servers packaged. Recorded decisions rule out a credential in the document or the page and a plug-in tier inside the app; neither covers a developer-side tool that runs outside the document. Ask before proposing it upstream.

## How others do it

- Figma ships agent skills together with its MCP server and says skills define how agents use that access (https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/, https://github.com/figma/mcp-server-guide).
- Canva's tools include editing transactions and brand-kit listing (https://www.canva.dev/docs/mcp/tools/).
- Gamma's tools edit by card id and list themes (https://developers.gamma.app/mcp/mcp-tools-reference.md).
- Slidev documents an MCP path for editing and reordering slides (https://sli.dev/guide/work-with-ai).
- Penpot's 2.15 release centres on its MCP server working from real layouts and tokens (https://community.penpot.app/t/penpot-2-15-master-of-puppets/10529).
- Anthropic: servers provide access, skills provide procedure; avoid conflicting instructions between the two (https://claude.com/blog/extending-claude-capabilities-with-skills-mcp-servers).

## Proposed change

1. A stdio server at `plugins/bento-slides/server/` (plain Node, no dependency beyond what the CLI already needs; if a protocol library is unavoidable it is a dev-side dependency of the plugin, never of the shell). It is a thin wrapper: every tool calls the same functions as `bento.mjs` from AI-04.
2. Tools, each taking a deck path:
   - `deck_outline`: slide list with addresses, titles, notes presence; bounded output.
   - `read_slide`: one slide in compact form, assets elided.
   - `inspect_design_system`: slots, tokens, fonts, components, layouts, binding coverage (AI-16's `designSystemOf`).
   - `patch`: operations from AI-07; **dry run by default**, returns applied, refused, and fresh findings; `apply: true` writes the file through the CLI's `apply` (escaping, identity preserved, derive pass run).
   - `validate`: findings as JSON.
   - `render`: per-slide PNGs and a contact sheet, returned as images.
3. Safety properties, each with a test: session keys (`collab`) never appear in any tool result; `docId` cannot be changed; design-system changes need the explicit op (AI-16); the server makes no network request.
4. Register it in the plugin with `.mcp.json`. Server instructions stay one paragraph and generic; the workflow stays in the skill.
5. Other agents: document in `AGENTS.md` and `site-src/llms.txt` how to start the same server outside Claude Code.

Alternative rejected: a hosted remote server. It would put documents on someone's server, against the project's local-first promise.

## Acceptance criteria

- [ ] The server starts over stdio and lists the six tools.
- [ ] `patch` without `apply` leaves the file byte-identical.
- [ ] `patch` with `apply` produces a file that passes `scripts/shell-gate.mjs` and opens with the same `docId`.
- [ ] No tool result for a deck with live-session keys contains a key value (regex over all outputs in the rig).
- [ ] `render` returns one image per shown slide for the starter.
- [ ] The plugin has no top-level `bin/` directory (the research found claude.ai refuses plugins that have one).
- [ ] No network call is made by the server (asserted by running the rig with the network blocked).

## Tests

`scripts/test-slides-tool-server.ts` (node): spawns the server, speaks the protocol over stdio, runs each tool against `starterDoc()` written to a temp file and against the shared-deck fixture from AI-17, and asserts the criteria. Register at the end of the slides slice in `.github/actions/validate-slides/action.yml`; `render` needs Chrome, so that part belongs in `.github/workflows/ci-slides.yml`.

## Out of scope

- In-chat previews (MCP Apps); host support varies.
- Any model call or credential handling.
- The in-editor Assistant's bridge (epic 4).

## Notes for the implementer

Plugin and scripts zone; nothing ships inside a document. Labelled P3 because it is only worth building after the CLI, the patch language and the render call exist. `scripts/` is the maintainer's operations zone upstream: propose the location before building for upstream.

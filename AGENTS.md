# AGENTS.md — permission-modes

Guide for coding agents working in this repository. Product context (goals, users,
features, success metrics): see [docs/PRD.md](docs/PRD.md).

## Summary
A pi extension that implements Claude-Code-style permission modes (ask / plan / auto) for the pi coding agent, replacing v1.x's 4-mode system (default/plan/accept-edits/auto). It intercepts tool calls, gates approvals per mode, injects mode-specific context, provides a custom footer + status pill, and guards reads outside cwd in ask mode.

## Tech Stack
- **Language:** TypeScript (ESM — `"type": "module"`)
- **Framework:** Pi coding agent extension API (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`)
- **Package Manager:** npm (no lock file committed)
- **Peer Dependencies:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`
- **Third-party deps:** None

## Project Structure
```
permission-modes/
├── package.json       # pi manifest: { "extensions": ["./index.ts"] }
├── index.ts           # main extension — default-exported factory function
├── utils.ts           # pure helpers: bash allowlist, Plan: extraction, [DONE:n] tracking
├── docs/
│   └── PRD.md         # product requirements (human audience)
├── AGENTS.md          # this file
├── CLAUDE.md          # thin pointer → AGENTS.md
└── .pi/
    └── permission-modes-45ea0551.md  # pi project marker (safe to commit/delete)
```

## Commands

This is a pi extension — it has no standalone build/run lifecycle. All commands below run *inside* pi after the extension is loaded.

| Action | Command |
|---|---|
| Switch mode | `/ask`, `/plan`, `/auto`, or `/mode` (`/default` works as alias) |
| Set auto depth | `/auto-depth <n>` (0 = unlimited; default 20) |
| Shortcut | `Shift+Tab` to cycle modes |
| Shortcut | `Alt+T` to cycle thinking level |
| Start flag | `pi --permission-mode <name>` |
| Load in dev | `pi -e ./extensions/permission-modes/index.ts` |
| Hot-reload | `/reload` (after edits) |
| Verify loaded | `pi list` |

There is no test, lint, or build command currently. The extension is loaded and run directly by pi at runtime.

## Conventions
- **Style:** TypeScript, ESM (`import`/`export`), no semicolons (standard pi extension style)
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types, `SCREAMING_SNAKE` for constants
- **Extension pattern:** Default-export a function receiving `pi: ExtensionAPI`, register hooks on `pi.on(...)` events
- **State management:** Plain module-scoped variables; persist via `pi.appendEntry("modes", ...)` with restore in `session_start` / `session_tree`
- **UI:** Use `ctx.hasUI` gating — never assume a UI exists
- **Types:** Use `type` from the pi-core packages; no external type deps

## Boundaries (technical)
- **Do NOT** add third-party runtime dependencies — peer deps only (pi-core + typebox)
- **Do NOT** change pi's core behavior — only intercept tool calls via `pi.on("tool_call", ...)` and return `{ block: true, reason }` or `undefined`
- **Do NOT** modify the model or switch models — this extension only changes approval behavior
- **Do NOT** duplicate content between AGENTS.md and CLAUDE.md — keep AGENTS.md as the single source of truth
- **Safe to delete:** `.pi/permission-modes-45ea0551.md` (recreated automatically)
- **Invariants:** The three-mode cycle (ask → plan → auto) is hard-coded in `MODE_CYCLE`; accept-edits was removed and default was renamed to ask in v2.0.0. The plan-mode tool restrictions (`PLAN_TOOLS`, `PLAN_DISABLED`) and bash safe/destructive patterns are in `utils.ts`. Change these with care.

## Known Issues & Gotchas
- No test infrastructure yet — no test files, no vitest/jest config. Add tests before making non-trivial logic changes.
- The `--permission-mode` flag uses a distinct name because pi has a built-in `--mode` flag for output format (text/json/rpc). Do not rename it to `--mode`.
- Auto mode follow-up logic is currently **commented out** in `index.ts` (the `turn_end` handler block). Re-enable when auto-continue support in pi is stable.
- `typebox` is listed as a peer dep but not currently imported. It may be needed for future input validation.
- No `.env` / `.env.example` — this extension has no environment secrets.
- No `tsconfig.json` — pi bundles its own TypeScript configuration.

## Companion Extensions
- **minion (@aprimediet/minion):** Active (project `permission-modes-45ea0551`, 0 open tasks). Check the kanban board at `~/.pi/projects/permission-modes-45ea0551/tasks/` before starting work to see if any delegated tasks are pending.
- **memory (@aprimediet/memory):** Active (1 entry). Durable facts are stored at `~/.pi/projects/permission-modes-45ea0551/memory/`. Use `memory_write` to save decisions/gotchas and `memory_search` to recall context.

## Current Focus
- **v2.0.0** — 3-mode redesign (ask/plan/auto), outside-cwd read guarding in ask mode, outside-cwd safety net in auto mode, project-root detection, vitest test suite, auto follow-up re-enabled, full 64-test coverage
- Next: solicit user feedback; publish to npm

# @aprimediet/permission-modes

Claude-Code-style **permission modes** for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Three modes, cycled with **Shift+Tab**, that control how tool calls and file edits get approved. The model is **not** changed per mode — only the approval behavior.

## Modes

| Mode | edit / write | reads outside cwd | bash | agent control |
|---|---|---|---|---|
| **ask** `●` | prompt on each edit/write (`Allow` / `Allow all → auto` / `Block`) | **prompt** | mutating commands prompt; read-only pass | — |
| **plan** `⏸` | disabled (stripped from the active tool set) | allowed (exploration needed for planning) | read-only allowlist only; mutating commands blocked | produce a numbered `Plan:`, then **Execute / Stay / Refine** |
| **auto** `▶` | auto-approved (prompts if **outside** project root) | auto-approved | auto-approved; prompts if destructive **outside** project root | auto-continues until done, bounded by `/auto-depth` |

**Cycle (Shift+Tab):** ask → plan → auto → ask.

When there is no interactive UI (`pi -p`, `--mode json`), anything that would prompt is **blocked** instead of silently allowed.

## Commands, shortcut, flag

| Kind | Name | Behavior |
|---|---|---|
| Command | `/ask`, `/plan`, `/auto` | switch to that mode (`/default` also works as alias) |
| Command | `/mode [name]` | set the given mode, or pick from a list |
| Command | `/auto-depth <n>` | cap auto-mode follow-ups (`0` = unlimited; default 20) |
| Shortcut | `Shift+Tab` | cycle modes |
| Flag | `--permission-mode <name>` | start in a mode (accepts `ask`, `plan`, `auto`, or `default` as alias; default `ask`) |

> The start-mode flag is `--permission-mode` (not `--mode`) because pi already has a built-in `--mode` for output format (text/json/rpc).

### Plan mode flow

In plan mode the agent explores read-only and emits a numbered list under a `Plan:` header. On completion you choose:

- **Execute the plan** — switches to auto, restores edit/write, runs the steps; a `☐/☑` widget advances as the agent emits `[DONE:n]` tags, and you get **Plan Complete! ✓** at the end.
- **Stay in plan mode** — keep iterating.
- **Refine the plan** — opens an editor; your notes are sent back as a follow-up.

## UI

- A status pill and a custom footer showing **mode · cwd [git-branch] · provider/model**.
- While the agent is streaming, the working indicator shows live **token / tok-s / cost / % context** stats; it reverts to the default loader when idle.

Current mode and the auto-follow-up depth **persist** across `/reload` and session resume.

## Install / run

```bash
# Install as a package (scoped npm name; or from a git remote / local path)
pi install npm:@aprimediet/permission-modes
pi list                                            # verify it loaded

# Or run it directly for a quick try (no install)
pi -e ./extensions/permission-modes/index.ts

# During development, hot-reload after edits
/reload
```

Auto-discovery also works: drop this folder at `~/.pi/agent/extensions/permission-modes/` (global) or `.pi/extensions/permission-modes/` (project) and pi loads `index.ts` automatically.

## Layout

```
permission-modes/                       # @aprimediet/permission-modes
├── package.json   # pi manifest: { "extensions": ["./index.ts"] }
├── index.ts       # the extension (default-exported factory)
└── utils.ts       # bash allowlist + Plan: extraction + [DONE:n] helpers
```

Third-party deps: none. The five pi-core packages are peer dependencies (bundled by pi). The model is never switched — Claude Code keeps one model across all modes, and the footer only *displays* it.

# permission-modes

A Claude-Code-style **Shift+Tab mode cycle** for the [pi coding agent](https://pi.dev).

Three modes, cycled with `Shift+Tab` (or via commands):

| Mode    | Edit/Write             | Mutating bash | Read-only bash | Reads  | Behavior                                              |
| ------- | ---------------------- | ------------- | -------------- | ------ | ----------------------------------------------------- |
| default | prompt each call       | prompt        | allow          | allow  | Standard "ask before mutating" workflow               |
| plan    | **disabled**           | **blocked**   | allow          | allow  | Read-only exploration; produce a `Plan:` and execute  |
| auto    | auto-approve           | auto-approve  | auto-approve   | allow  | Auto-approve everything; auto-follow-up until done    |

Cycle order: **default → plan → auto → default**.

## Install

```bash
pi install npm:permission-modes
```

Or load directly for a one-off run:

```bash
pi -e ./index.ts
```

## Usage

### Keyboard

- **`Shift+Tab`** — cycle to the next mode (default → plan → auto → default)

### Commands

- `/default` — switch to default mode
- `/plan` — switch to plan mode (read-only)
- `/auto` — switch to auto mode
- `/mode [name]` — with no arg, opens a selector; with `default`/`plan`/`auto`, switches directly
- `/auto-depth <n>` — set the auto-follow-up cap (`0` = unlimited, default `20`)

### Flag

- `--permission-mode <mode>` — start in `default`, `plan`, or `auto`

> The flag is named `--permission-mode` (not `--mode`) because pi has a built-in `--mode` flag for output mode (text/json/rpc).

## Plan mode flow

1. Run `/plan` (or use `Shift+Tab` to cycle into plan mode).
2. The agent reads your code, asks clarifying questions, and produces a numbered `Plan:` block.
3. pi prompts you with three options:
   - **Execute the plan** — switches out of plan mode, restores `edit`/`write` tools, posts the steps to the agent, and tracks progress with a `☐/☑` widget. The agent emits `[DONE:n]` tags as it finishes each step; pi marks them and posts **Plan Complete ✓** when all are done.
   - **Stay in plan mode** — keep exploring.
   - **Refine the plan** — open an editor, type feedback, and the agent iterates.

## Auto mode

In auto mode, every tool call is auto-approved. After each turn, if the assistant's last message **made tool calls** and does **not** look like a completion signal, pi auto-feeds a "Continue. Auto mode is active — proceed without asking." follow-up message. This loops until:

- the agent stops making tool calls (and emits a completion signal like "all done" / "task complete" / "finished"), or
- the cap (`/auto-depth <n>`, default `20`) is reached, or
- the user manually changes mode.

> Auto mode is intentionally permissive: it auto-approves **everything**, including outside-cwd writes. That's the design.

## Headless / no-UI safety

In any mode where a UI prompt would normally appear, if `ctx.hasUI === false` (e.g. `pi -p` or RPC mode without a terminal), the tool call is **blocked** with a clear reason — never silently allowed.

## State persistence

The current mode and `autoFollowUpDepth` are persisted to the session via `pi.appendEntry("modes", {...})`. On `/reload`, `/resume`, or tree navigation, the last entry is restored (with legacy value mapping: `"ask"`/`"normal"` → `default`, `"accept-edits"` → `auto`).

If you were mid-plan-execution, the latest `modes-execute` marker is detected and the plan is rebuilt from assistant messages after it, with `[DONE:n]` tags re-applied so the widget reflects the actual state.

## Files

```
permission-modes/
├── package.json
├── README.md
├── index.ts          # main factory
├── utils.ts          # isSafeCommand, plan extraction, completion signal, formatCount
├── vitest.config.ts
├── utils.test.ts
└── index.test.ts
```

## Tests

```bash
npm test
```

`utils.test.ts` covers the bash safety classifier, plan extraction, `[DONE:n]` marking, and completion-signal detection.

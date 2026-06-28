# Auto Mode — Prompt Reference

> **Part of the v2.0.0 implementation.** Full autonomy with outside-cwd safety net.
> Corresponding `index.ts` constants: `MODE_CONTEXT["auto"]`, `MODE_META["auto"]`, `tool_call` gate case `"auto"`.

---

## 1. Mode metadata

```typescript
// MODE_META["auto"]
{ icon: "▶", label: "Auto", role: "accent" }
```

- **Slash commands:** `/auto`
- **Cycle position:** `ask → plan → auto → ask`
- **Flag:** `--permission-mode auto`
- **Auto-depth:** `/auto-depth <n>` — cap follow-up turns (`0` = unlimited; default 20)

---

## 2. System context injection (`MODE_CONTEXT["auto"]`)

Injected into the agent's context window at the start of every turn via `before_agent_start`. Unchanged from v1.0.0.

```
[AUTO MODE ACTIVE] All tool calls are auto-approved. Work autonomously without asking
for permission until the task is complete. When everything is done, say the task is
complete.
```

---

## 3. Auto-approve conditions

In auto mode, the following are **auto-approved** without any user prompt:

| Event | Condition |
|---|---|
| `edit` / `write` | Path is **inside** cwd (`isOutsideCwd === false`) |
| `read` | Any path (inside or outside cwd) |
| `bash` (read-only) | `isSafeCommand(cmd) === true` |
| `bash` (destructive) | Command targets **inside** cwd (`commandTargetsOutsideCwd === false`) |

---

## 4. UI confirmation prompts

### 4a. Outside-cwd edit/write prompt (NEW in v1.1.0)

| Field | Value |
|---|---|
| **Trigger** | `tool === "edit"` **or** `tool === "write"` **AND** `isOutsideCwd(path, ctx.cwd) === true` |
| **Title** | `` `Allow write outside cwd on "${path}"?` `` |
| **Options** | `["Allow", "Block"]` |

| Result | Action |
|---|---|
| `"Allow"` | Return `undefined` |
| `"Block"` | `{ block: true, reason: \`${tool} blocked by user on ${path} (outside cwd)\` }` |
| No UI | `{ block: true, reason: \`${tool} blocked: no UI available to confirm.\` }` |

### 4b. Outside-cwd destructive bash prompt (NEW in v1.1.0)

| Field | Value |
|---|---|
| **Trigger** | `tool === "bash"` **AND** `isSafeCommand(cmd) === false` **AND** `commandTargetsOutsideCwd(cmd, ctx.cwd) === true` |
| **Title** | `` `Allow destructive action outside working directory: "${cmd}"?` `` |
| **Options** | `["Allow", "Block"]` |

| Condition | Action |
|---|---|
| Safe command | Auto-approve |
| Destructive + inside cwd | Auto-approve |
| Destructive + outside cwd + `"Allow"` | Return `undefined` |
| Destructive + outside cwd + `"Block"` | `{ block: true, reason: \`bash blocked by user (outside cwd)\` }` |
| Destructive + outside cwd + no UI | `{ block: true, reason: \`bash blocked: no UI available to confirm.\` }` |

---

## 5. Auto-follow-up (commented out in v1.0.0, stays commented in v1.1.0)

The auto-continue logic in the `turn_end` handler is **commented out** in both v1.0.0 and v1.1.0. It will be re-enabled when pi's follow-up delivery support is confirmed stable.

**Current code (commented):**

```typescript
// if (currentMode === "auto" && !isStepping) {
//   if (autoFollowUpDepth > 0 && autoFollowUpCount >= autoFollowUpDepth) return;
//   if (hasToolCalls(msg) && !isCompletionSignal(text)) {
//     isStepping = true;
//     autoFollowUpCount++;
//     pi.sendUserMessage("Continue. Auto mode is active — proceed without asking.", {
//       deliverAs: "followUp",
//     });
//   }
// }
```

---

## 6. Decision tree (tool_call gate pseudocode)

```
if currentMode === "auto":
  if tool === "edit" || tool === "write":
    if isOutsideCwd(path, ctx.cwd):
      prompt 4a (outside-cwd edit/write)
    else:
      auto-approve
  elif tool === "bash":
    if isSafeCommand(cmd):
      auto-approve
    elif commandTargetsOutsideCwd(cmd, ctx.cwd):
      prompt 4b (outside-cwd destructive bash)
    else:
      auto-approve (destructive but inside cwd)
  else:
    auto-approve (read and other tools)
```

---

## 7. Related code locations

| What | File | Line area |
|---|---|---|
| `MODE_CONTEXT["auto"]` | `index.ts` | `MODE_CONTEXT` record — unchanged |
| `MODE_META["auto"]` | `index.ts` | `MODE_META` record — unchanged |
| Outside-cwd edit/write prompt | `index.ts` | `tool_call` handler — `currentMode === "auto"` branch (NEW) |
| Outside-cwd bash prompt | `index.ts` | `tool_call` handler — `currentMode === "auto"` branch (NEW) |
| `isOutsideCwd()` | `utils.ts` | New helper for v1.1.0 |
| `commandTargetsOutsideCwd()` | `utils.ts` | New helper for v1.1.0 |
| Auto-follow-up (commented) | `index.ts` | `turn_end` handler |

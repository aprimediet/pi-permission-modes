/**
 * @aprimediet/permission-modes
 *
 * A Claude-Code-style permission-mode system for the pi coding agent.
 *
 * Three modes, cycled with Shift+Tab (ask → plan → auto → ask):
 *   - ask          File edits/writes require approval; reads outside cwd require
 *                  approval; inside-cwd reads are auto-approved; mutating bash prompts.
 *   - plan         Read-only; edit/write disabled, bash restricted to an allowlist;
 *                  produce a numbered Plan:, then Execute / Stay / Refine.
 *   - auto         Auto-approve everything and auto-continue (bounded by /auto-depth)
 *                  with an outside-cwd safety net (prompt on ops outside project root).
 *
 * The model is NOT changed per mode (Claude Code keeps one model across modes); the
 * footer only displays the current model as `variant / thinking`
 * (variant = the model's display name; thinking = the current thinking level).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import {
  commandTargetsOutsideCwd,
  extractTodoItems,
  findProjectRoot,
  formatCount,
  isCompletionSignal,
  isInsideProject,
  isOutsideCwd,
  isSafeCommand,
  markCompletedSteps,
  type TodoItem,
} from "./utils.ts";

type Mode = "ask" | "plan" | "auto";

// accept-edits removed, default renamed to ask in v2.0.0.
const MODE_CYCLE: Mode[] = ["ask", "plan", "auto"];

const MODE_META: Record<Mode, { icon: string; label: string; role: string }> = {
  ask: { icon: "●", label: "Ask", role: "muted" },
  plan: { icon: "⏸", label: "Plan", role: "warning" },
  auto: { icon: "▶", label: "Auto", role: "accent" },
};

// Tools available in plan mode (edit/write are stripped).
const PLAN_TOOLS = ["read", "bash", "grep", "find", "ls"];
const PLAN_DISABLED = new Set(["edit", "write"]);

const MODE_CONTEXT: Record<Mode, string> = {
  ask:
    "[ASK MODE] Default permission mode. File edits/writes and access outside the working directory require explicit approval before they run. Mutating shell commands require approval. Read-only access inside the working directory is auto-approved.",
  plan: `[PLAN MODE ACTIVE]
You are in a read-only exploration mode. The edit and write tools are disabled and bash is restricted to read-only commands.

Investigate as needed, then produce a detailed, numbered plan under a "Plan:" header:

Plan:
1. First step
2. Second step
...

Do NOT make any changes — only describe what you would do.`,
  auto: "[AUTO MODE ACTIVE] All tool calls are auto-approved. Work autonomously without asking for permission until the task is complete. When everything is done, say the task is complete.",
};

type Block = { block: true; reason: string } | undefined;

export default function permissionModesExtension(pi: ExtensionAPI): void {
  // ---- state -------------------------------------------------------------
  let currentMode: Mode = "ask";
  let autoFollowUpDepth = 20;
  let autoFollowUpCount = 0;
  let isStepping = false;
  let toolsBeforePlanMode: string[] | undefined;
  let planExecuting = false;
  let planTodos: TodoItem[] = [];
  let projectRoot: string | null = null;

  // streaming stats (for the working-indicator readout)
  let streamStart = 0;
  let outputAtStart = 0;
  let lastTps = 0;
  let gitBranch = "";

  // ---- small helpers -----------------------------------------------------
  const isAssistant = (m: any): boolean =>
    !!m && m.role === "assistant" && Array.isArray(m.content);

  const getText = (m: any): string =>
    Array.isArray(m?.content)
      ? m.content
          .filter((c: any) => c?.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      : typeof m?.content === "string"
        ? m.content
        : "";

  const hasToolCalls = (m: any): boolean =>
    Array.isArray(m?.content) &&
    m.content.some(
      (c: any) =>
        c &&
        (c.type === "toolCall" ||
          c.type === "tool_call" ||
          c.type === "toolUse"),
    );

  function persistState(): void {
    pi.appendEntry("modes", { currentMode, autoFollowUpDepth });
  }

  // ---- tool gating -------------------------------------------------------
  function applyToolRestrictions(): void {
    if (currentMode === "plan") {
      if (toolsBeforePlanMode === undefined)
        toolsBeforePlanMode = pi.getActiveTools();
      const kept = toolsBeforePlanMode.filter((t) => !PLAN_DISABLED.has(t));
      pi.setActiveTools([...new Set([...kept, ...PLAN_TOOLS])]);
    } else if (toolsBeforePlanMode !== undefined) {
      pi.setActiveTools(toolsBeforePlanMode);
      toolsBeforePlanMode = undefined;
    }
  }

  // ---- mode switching ----------------------------------------------------
  function setMode(mode: Mode, ctx: ExtensionContext): void {
    currentMode = mode;
    autoFollowUpCount = 0;
    isStepping = false;
    // A manual switch always cancels any in-flight plan execution.
    planExecuting = false;
    planTodos = [];
    if (ctx.hasUI) ctx.ui.setWidget("plan-todos", undefined);
    applyToolRestrictions();
    updateStatus(ctx);
    persistState();
  }

  function cycleMode(ctx: ExtensionContext): void {
    const idx = MODE_CYCLE.indexOf(currentMode);
    setMode(MODE_CYCLE[(idx + 1) % MODE_CYCLE.length], ctx);
    if (ctx.hasUI) ctx.ui.notify(`Mode: ${MODE_META[currentMode].label}`);
  }

  // ---- UI: status, footer, plan widget, working stats --------------------
  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const m = MODE_META[currentMode];
    ctx.ui.setStatus("modes", ctx.ui.theme.fg(m.role, `${m.icon} ${m.label}`));
    ctx.ui.setWorkingIndicator({
      frames: [ctx.ui.theme.fg(m.role, "●")],
      intervalMs: 500,
    });
  }

  function shortenPath(p: string): string {
    const home = homedir();
    return p && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  }

  function layoutThree(
    left: string,
    center: string,
    right: string,
    width: number,
  ): string {
    const lw = visibleWidth(left);
    const cw = visibleWidth(center);
    const rw = visibleWidth(right);
    if (lw + cw + rw + 2 <= width) {
      const leftGap = Math.max(1, Math.floor((width - cw) / 2) - lw);
      const rightGap = Math.max(1, width - lw - leftGap - cw - rw);
      return left + " ".repeat(leftGap) + center + " ".repeat(rightGap) + right;
    }
    const gap = Math.max(1, width - lw - rw);
    return truncateToWidth(left + " ".repeat(gap) + right, width);
  }

  function installFooter(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setFooter((_tui: any, theme: any) => ({
      render(width: number): string[] {
        const m = MODE_META[currentMode];
        const left = theme.fg(
          m.role,
          `${m.icon} ${m.label} (shift+tab to cycle)`,
        );
        const cwd = shortenPath(ctx.cwd);
        const center = theme.fg(
          "muted",
          gitBranch ? `${cwd} [${gitBranch}]` : cwd,
        );
        const md = (ctx as any).model;
        let modelStr = "";
        if (md) {
          // variant = the model's display name (fall back to the id if no name)
          modelStr = md.name ? String(md.name) : String(md.id ?? "");
          // thinking = current thinking/reasoning level (off|minimal|low|medium|high|xhigh)
          const thinking =
            typeof (pi as any).getThinkingLevel === "function"
              ? (pi as any).getThinkingLevel()
              : undefined;
          if (thinking) modelStr += ` / ${thinking}`;
        }
        const right = theme.fg("dim", modelStr);
        return [layoutThree(left, center, right, width)];
      },
      invalidate() {},
    }));
  }

  function updatePlanWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (!planTodos.length) {
      ctx.ui.setWidget("plan-todos", undefined);
      return;
    }
    const lines = planTodos.map((t) =>
      t.completed
        ? ctx.ui.theme.fg("success", "☑ ") +
          ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(t.text))
        : `${ctx.ui.theme.fg("muted", "☐ ")}${t.text}`,
    );
    ctx.ui.setWidget("plan-todos", lines);
  }

  function computeStats(ctx: ExtensionContext): {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  } {
    const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    try {
      for (const entry of (ctx.sessionManager as any).getBranch() ?? []) {
        if (entry?.type !== "message") continue;
        const u = entry.message?.usage;
        if (!u) continue;
        acc.input += u.input || 0;
        acc.output += u.output || 0;
        acc.cacheRead += u.cacheRead || 0;
        acc.cacheWrite += u.cacheWrite || 0;
        acc.cost += u.cost?.total || 0;
      }
    } catch {
      /* ignore */
    }
    return acc;
  }

  function renderWorkingMessage(ctx: ExtensionContext): string {
    const s = computeStats(ctx);
    const parts = [`↑${formatCount(s.input)}`, `↓${formatCount(s.output)}`];
    if (s.cacheRead) parts.push(`R${formatCount(s.cacheRead)}`);
    if (lastTps > 0) parts.push(`⚡${Math.round(lastTps)} tok/s`);
    parts.push(`$${s.cost.toFixed(3)}`);
    const usage = (ctx as any).getContextUsage?.();
    if (usage && usage.maxTokens) {
      parts.push(`${Math.round((usage.tokens / usage.maxTokens) * 100)}% ctx`);
    }
    return `Working… (${parts.join(" · ")})`;
  }

  function refreshWorkingMessage(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWorkingMessage(
      ctx.ui.theme.fg(MODE_META[currentMode].role, renderWorkingMessage(ctx)),
    );
  }

  // ---- prompts -----------------------------------------------------------
  async function promptApproval(
    ctx: ExtensionContext,
    tool: string,
    label: string,
  ): Promise<Block> {
    if (!ctx.hasUI)
      return {
        block: true,
        reason: `${tool} blocked: no UI available to confirm.`,
      };
    const choice = await ctx.ui.select(`Allow ${tool} ${label}?`, [
      "Allow",
      "Block",
    ]);
    if (choice !== "Allow")
      return { block: true, reason: `${tool} blocked by user` };
    return undefined;
  }

  // ---- commands / shortcut / flag ---------------------------------------
  for (const mode of ["ask", "plan", "auto"] as Mode[]) {
    pi.registerCommand(mode, {
      description: `Switch to ${MODE_META[mode].label} mode`,
      handler: async (_args, ctx) => setMode(mode, ctx),
    });
  }

  pi.registerCommand("mode", {
    description:
      "Show or set the permission mode (ask | plan | auto)",
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();
      if (arg && (MODE_CYCLE as string[]).includes(arg)) {
        setMode(arg as Mode, ctx);
        return;
      }
      // Accept "default" as an alias for "ask" during migration period.
      if (arg === "default") {
        setMode("ask", ctx);
        return;
      }
      if (!ctx.hasUI) return;
      const choice = await ctx.ui.select(
        "Select mode:",
        MODE_CYCLE.map((m) => MODE_META[m].label),
      );
      const picked = MODE_CYCLE.find((m) => MODE_META[m].label === choice);
      if (picked) setMode(picked, ctx);
    },
  });

  pi.registerCommand("auto-depth", {
    description: "Set auto-mode follow-up depth cap (0 = unlimited)",
    handler: async (args, ctx) => {
      const n = parseInt((args ?? "").trim(), 10);
      if (!Number.isNaN(n) && n >= 0) {
        autoFollowUpDepth = n;
        persistState();
        if (ctx.hasUI)
          ctx.ui.notify(`Auto follow-up depth: ${n === 0 ? "unlimited" : n}`);
      } else if (ctx.hasUI) {
        ctx.ui.notify(
          `Auto follow-up depth: ${autoFollowUpDepth === 0 ? "unlimited" : autoFollowUpDepth}`,
          "info",
        );
      }
    },
  });

  pi.registerShortcut("shift+tab", {
    description: "Cycle mode: Ask → Plan → Auto",
    handler: async (ctx) => cycleMode(ctx),
  });

  // Alt+T: cycle the thinking level. pi has no built-in cycle helper, and setThinkingLevel
  // clamps to the model's capabilities, so we advance to the next level the model actually
  // accepts (skipping ones it clamps away). The footer reflects the new level live.
  const THINKING_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ] as const;
  function cycleThinkingLevel(ctx: ExtensionContext): void {
    const get = (): string =>
      typeof (pi as any).getThinkingLevel === "function"
        ? (pi as any).getThinkingLevel()
        : "off";
    const setLevel = (pi as any).setThinkingLevel as
      | ((l: string) => void)
      | undefined;
    if (typeof setLevel !== "function") return;
    const cur = get();
    let i = THINKING_LEVELS.indexOf(cur as (typeof THINKING_LEVELS)[number]);
    if (i < 0) i = 0;
    for (let step = 1; step <= THINKING_LEVELS.length; step++) {
      const next = THINKING_LEVELS[(i + step) % THINKING_LEVELS.length];
      setLevel(next);
      const applied = get();
      if (applied !== cur) {
        if (ctx.hasUI) ctx.ui.notify(`Thinking: ${applied}`, "info");
        return;
      }
    }
    if (ctx.hasUI)
      ctx.ui.notify(
        `Thinking: ${get()} (model supports no other levels)`,
        "info",
      );
  }

  pi.registerShortcut("alt+t", {
    description:
      "Cycle thinking level (off → minimal → low → medium → high → xhigh)",
    handler: async (ctx) => cycleThinkingLevel(ctx),
  });

  // NB: pi has a built-in `--mode` (output mode: text/json/rpc), so the start-mode
  // flag must use a distinct name to avoid being shadowed at parse time.
  pi.registerFlag("permission-mode", {
    description:
      "Start in a permission mode: ask, plan, or auto (accepts 'default' as alias for 'ask')",
    type: "string",
    default: "ask",
  });

  // ---- tool_call gate ----------------------------------------------------
  pi.on("tool_call", async (event, ctx): Promise<Block> => {
    const tool = event.toolName;
    const input = (event.input ?? {}) as Record<string, unknown>;

    // PLAN: edit/write already stripped via setActiveTools; defensive block in case
    // the tool still reaches us (e.g., during the same turn before activeTools is updated).
    if (currentMode === "plan") {
      if (tool === "edit" || tool === "write") {
        return {
          block: true,
          reason: `Plan mode: edit/write disabled. Use /plan to exit plan mode first.`,
        };
      }
      if (tool === "bash") {
        const cmd = String(input.command ?? "");
        if (!isSafeCommand(cmd)) {
          return {
            block: true,
            reason: `Plan mode: read-only commands only. Use /plan to exit plan mode first.\n  Command: ${cmd}`,
          };
        }
      }
      return undefined;
    }

    // AUTO: approve everything, except prompt for edit/write/bash that target
    // paths outside cwd that are also outside the detected project root.
    // Reads are always auto-approved (read-only).
    if (currentMode === "auto") {
      if (tool === "read" || tool === "grep" || tool === "find" || tool === "ls") {
        return undefined;
      }
      const pathStr = String(input.path ?? "");
      const cmdStr = tool === "bash" ? String(input.command ?? "") : "";
      const outside =
        (pathStr && isOutsideCwd(pathStr, ctx.cwd)) ||
        (cmdStr && commandTargetsOutsideCwd(cmdStr, ctx.cwd));
      if (outside && !isInsideProject(pathStr || ".", ctx.cwd, projectRoot)) {
        const label = pathStr
          ? `outside cwd on "${pathStr}"`
          : `outside cwd on "${cmdStr}"`;
        return promptApproval(ctx, tool, label);
      }
      return undefined;
    }

    // ASK: prompt on edit/write (with "Allow all → auto"); prompt on read outside cwd;
    // inside-cwd reads auto-approved; mutating bash prompts.
    if (currentMode === "ask") {
      // Read operations: prompt if outside cwd, auto-approve if inside cwd.
      if (tool === "read" || tool === "grep" || tool === "find" || tool === "ls") {
        const pathStr = String(input.path ?? "");
        if (pathStr && isOutsideCwd(pathStr, ctx.cwd)) {
          return promptApproval(ctx, tool, `outside cwd on "${pathStr}"`);
        }
        return undefined;
      }
      if (tool === "edit" || tool === "write") {
        const path = String(input.path ?? "(unknown)");
        if (!ctx.hasUI)
          return {
            block: true,
            reason: `${tool} blocked: no UI available to confirm.`,
          };
        const choice = await ctx.ui.select(`Allow ${tool} on ${path}?`, [
          "Allow",
          "Allow all (enable auto)",
          "Block",
        ]);
        if (choice === "Allow all (enable auto)") {
          setMode("auto", ctx);
          return undefined;
        }
        if (choice !== "Allow")
          return { block: true, reason: `${tool} blocked by user on ${path}` };
        return undefined;
      }
      if (tool === "bash") {
        const cmd = String(input.command ?? "");
        if (isSafeCommand(cmd)) return undefined;
        return promptApproval(ctx, tool, `"${cmd}"`);
      }
      return undefined;
    }

    // Fallback: unknown tool or mode — let through.
    return undefined;
  });

  // ---- context injection + dedup ----------------------------------------
  pi.on("before_agent_start", async () => {
    if (planExecuting && planTodos.length) {
      const remaining = planTodos
        .filter((t) => !t.completed)
        .map((t) => `${t.step}. ${t.text}`)
        .join("\n");
      return {
        message: {
          customType: "modes-context",
          content: `[EXECUTING PLAN — full tool access]\n\nRemaining steps:\n${remaining}\n\nExecute each step in order. After finishing a step, include a [DONE:n] tag in your reply.`,
          display: false,
        },
      };
    }
    const content = MODE_CONTEXT[currentMode];
    if (content)
      return {
        message: { customType: "modes-context", content, display: false },
      };
    return undefined;
  });

  pi.on("context", async (event) => {
    const msgs = event.messages as any[];
    let lastIdx = -1;
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i]?.customType === "modes-context") lastIdx = i;
    }
    if (lastIdx === -1) return undefined;
    return {
      messages: msgs.filter(
        (m, i) => m?.customType !== "modes-context" || i === lastIdx,
      ),
    };
  });

  // ---- streaming-stat working message -----------------------------------
  pi.on("turn_start", async (_event, ctx) => {
    streamStart = Date.now();
    outputAtStart = computeStats(ctx).output;
    refreshWorkingMessage(ctx);
  });
  pi.on("before_provider_request", async (_event, ctx) =>
    refreshWorkingMessage(ctx),
  );
  pi.on("message_update", async (_event, ctx) => refreshWorkingMessage(ctx));

  // ---- turn_end: tps + plan-step tracking + auto follow-up ---------------
  pi.on("turn_end", async (event, ctx) => {
    try {
      gitBranch = (ctx.sessionManager as any).getGitBranch?.() ?? gitBranch;
    } catch {
      /* ignore */
    }

    const stats = computeStats(ctx);
    const elapsed = Math.max((Date.now() - streamStart) / 1000, 0.001);
    const delta = stats.output - outputAtStart;
    if (delta > 0) lastTps = delta / elapsed;
    refreshWorkingMessage(ctx);

    const msg = event.message;
    if (!isAssistant(msg)) return;
    const text = getText(msg);

    if (planExecuting && planTodos.length) {
      if (markCompletedSteps(text, planTodos) > 0) updatePlanWidget(ctx);
      persistState();
    }

    if (currentMode === "auto" && !isStepping) {
      if (autoFollowUpDepth > 0 && autoFollowUpCount >= autoFollowUpDepth)
        return;
      if (hasToolCalls(msg) && !isCompletionSignal(text)) {
        isStepping = true;
        autoFollowUpCount++;
        try {
          pi.sendUserMessage(
            "Continue. Auto mode is active — proceed without asking.",
            {
              deliverAs: "followUp",
            },
          );
        } catch (err) {
          // followUp delivery not supported in this pi version — disable stepping
          isStepping = false;
          console.warn("[permission-modes] auto follow-up unavailable:", err);
        }
      }
    }
  });

  // ---- agent_end: idle reset + plan complete + plan offer ----------------
  pi.on("agent_end", async (event, ctx) => {
    isStepping = false;
    if (ctx.hasUI) ctx.ui.setWorkingMessage(); // restore default loader when idle

    // Plan execution in progress: announce completion when all steps are done.
    if (planExecuting && planTodos.length) {
      if (planTodos.every((t) => t.completed)) {
        if (ctx.hasUI) {
          pi.sendMessage(
            {
              customType: "plan-complete",
              content: "**Plan Complete!** ✓",
              display: true,
            },
            { triggerTurn: false },
          );
          ctx.ui.setWidget("plan-todos", undefined);
        }
        planExecuting = false;
        planTodos = [];
        persistState();
      }
      return;
    }

    // In plan mode (and interactive): extract the plan and offer next action.
    if (currentMode !== "plan" || !ctx.hasUI) return;
    const lastAssistant = [...(event.messages as any[])]
      .reverse()
      .find(isAssistant);
    if (!lastAssistant) return;
    const extracted = extractTodoItems(getText(lastAssistant));
    if (!extracted.length) return;
    planTodos = extracted;
    persistState();

    const choice = await ctx.ui.select("Plan ready — what next?", [
      "Execute the plan",
      "Stay in plan mode",
      "Refine the plan",
    ]);

    if (choice === "Execute the plan") {
      planExecuting = true;
      currentMode = "auto";
      autoFollowUpCount = 0;
      isStepping = false;
      applyToolRestrictions(); // restores edit/write
      updateStatus(ctx);
      updatePlanWidget(ctx);
      persistState();
      const steps = planTodos.map((t) => `${t.step}. ${t.text}`).join("\n");
      pi.sendMessage(
        {
          customType: "modes-execute",
          content: `Execute the plan now. Steps:\n${steps}\n\nStart with step 1. After finishing each step, include a [DONE:n] tag in your reply.`,
          display: true,
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    } else if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement && refinement.trim()) {
        pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
      }
    }
  });

  // ---- session start / resume -------------------------------------------
  async function onSessionStart(
    _event: unknown,
    ctx: ExtensionContext,
  ): Promise<void> {
    const flag = pi.getFlag("permission-mode");
    if (typeof flag === "string") {
      if ((MODE_CYCLE as string[]).includes(flag)) {
        currentMode = flag as Mode;
      } else if (flag === "default" || flag === "accept-edits") {
        currentMode = "ask";
      }
    }

    // Restore the latest persisted mode entry (overrides the flag).
    try {
      const entries = (ctx.sessionManager as any).getEntries?.() ?? [];
      const last = [...entries]
        .reverse()
        .find((e: any) => e?.type === "custom" && e?.customType === "modes");
      if (last?.data) {
        let m = last.data.currentMode;
        if (m === "normal") m = "default";      // legacy (v0.x)
        if (m === "default") m = "ask";          // v1.0.0 → v2.0.0 rename
        if (m === "accept-edits") m = "ask";     // removed mode → fall back to ask
        if ((MODE_CYCLE as string[]).includes(m)) currentMode = m;
        if (typeof last.data.autoFollowUpDepth === "number")
          autoFollowUpDepth = last.data.autoFollowUpDepth;
      }
    } catch {
      /* ignore */
    }

    try {
      gitBranch = (ctx.sessionManager as any).getGitBranch?.() ?? "";
    } catch {
      /* ignore */
    }

    // Cache the project root once per session.
    if (projectRoot === null) {
      try {
        projectRoot = findProjectRoot(ctx.cwd);
      } catch {
        projectRoot = null;
      }
    }

    applyToolRestrictions();
    if (ctx.hasUI) {
      installFooter(ctx);
      updateStatus(ctx);
    }
  }

  pi.on("session_start", onSessionStart);
  pi.on("session_tree", onSessionStart);
}

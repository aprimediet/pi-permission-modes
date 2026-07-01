/**
 * Integration tests for the permission-modes extension.
 *
 * These tests instantiate the extension factory against a lightweight mock
 * ExtensionAPI/ExtensionContext so we can exercise the mode-switch, gate, and
 * lifecycle wiring without spinning up the full TUI runtime.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import factory from "./index.ts";
import { isSafeCommand } from "./utils.ts";

// ---------- Mock helpers ----------

type AnyHandler = (...args: unknown[]) => unknown;

interface MockUI {
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	select: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	confirm: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	input: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	editor: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	notify: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setStatus: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setWidget: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setWorkingMessage: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setWorkingIndicator: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setFooter: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	custom: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setTitle: any;
}

interface MockContext {
	hasUI: boolean;
	mode: "tui" | "rpc" | "json" | "print";
	cwd: string;
	model: { provider: string; id: string } | undefined;
	ui: MockUI;
	sessionManager: {
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
		getEntries: any;
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
		getBranch: any;
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
		getGitBranch: any;
	};
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	getContextUsage: any;
	signal: AbortSignal | undefined;
}

interface MockPi {
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	on: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	registerCommand: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	registerShortcut: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	registerFlag: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	getActiveTools: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	setActiveTools: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	appendEntry: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	getFlag: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	sendUserMessage: any;
	// biome-ignore lint/suspicious/noExplicitAny: vitest mock typing is too strict for our needs
	sendMessage: any;
}

function makeContext(opts: { hasUI?: boolean } = {}): MockContext {
	const theme = {
		fg: (_role: string, text: string) => text,
		dim: (text: string) => text,
		bold: (text: string) => text,
		strikethrough: (text: string) => text,
		border: (text: string) => text,
		borderMuted: (text: string) => text,
	};
	const ui: MockUI = {
		select: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		input: vi.fn(async () => undefined),
		editor: vi.fn(async () => undefined),
		notify: vi.fn(),
		setStatus: vi.fn(),
		setWidget: vi.fn(),
		setWorkingMessage: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setFooter: vi.fn(),
		custom: vi.fn(),
		setTitle: vi.fn(),
	};
	void theme; // theme methods are stubbed inline in factory via ctx.ui.theme
	return {
		hasUI: opts.hasUI ?? true,
		mode: "tui",
		cwd: "/home/user/project",
		model: { provider: "anthropic", id: "claude-sonnet-4-5" },
		ui,
		sessionManager: {
			getEntries: vi.fn(() => []),
			getBranch: vi.fn(() => []),
			getGitBranch: vi.fn(() => "main"),
		},
		getContextUsage: vi.fn(() => undefined),
		signal: undefined,
	};
}

function makePi(): { pi: MockPi; handlers: Map<string, AnyHandler[]>; commands: Map<string, AnyHandler>; shortcuts: Map<string, AnyHandler> } {
	const handlers = new Map<string, AnyHandler[]>();
	const commands = new Map<string, AnyHandler>();
	const shortcuts = new Map<string, AnyHandler>();

	const pi: MockPi = {
		on: vi.fn((event: string, handler: AnyHandler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		}),
		registerCommand: vi.fn((name: string, def: { handler: AnyHandler }) => {
			commands.set(name, def.handler);
		}),
		registerShortcut: vi.fn((key: string, def: { handler: AnyHandler }) => {
			shortcuts.set(key, def.handler);
		}),
		registerFlag: vi.fn(),
		getActiveTools: vi.fn(() => ["read", "bash", "edit", "write", "grep", "find", "ls"]),
		setActiveTools: vi.fn(),
		appendEntry: vi.fn(),
		getFlag: vi.fn(() => "default"),
		sendUserMessage: vi.fn(),
		sendMessage: vi.fn(),
	};

	return { pi, handlers, commands, shortcuts };
}

/** Build a minimal ctx.ui.theme that supports fg/dim/bold/strikethrough/border. */
function patchTheme(ctx: MockContext) {
	// biome-ignore lint/suspicious/noExplicitAny: need a flexible mock type for theme
	(ctx.ui as unknown as { theme: Record<string, any> }).theme = {
		fg: (_role: string, t: string) => t,
		dim: (t: string) => t,
		bold: (t: string) => t,
		strikethrough: (t: string) => t,
		border: (t: string) => t,
		borderMuted: (t: string) => t,
	};
}

async function emit(handlers: Map<string, AnyHandler[]>, event: string, payload: unknown, ctx: unknown) {
	const list = handlers.get(event) ?? [];
	let result: unknown = undefined;
	for (const h of list) {
		const r = await h(payload, ctx);
		if (r !== undefined) result = r;
	}
	return result;
}

// ---------- Setup ----------

let pi: MockPi;
let handlers: Map<string, AnyHandler[]>;
let commands: Map<string, AnyHandler>;
let shortcuts: Map<string, AnyHandler>;
let ctx: MockContext;

beforeEach(() => {
	const env = makePi();
	pi = env.pi;
	handlers = env.handlers;
	commands = env.commands;
	shortcuts = env.shortcuts;
	ctx = makeContext();
	patchTheme(ctx);
	factory(pi as unknown as Parameters<typeof factory>[0]);
});

afterEach(() => {
	vi.clearAllMocks();
});

// ---------- Tests: registration ----------

describe("registration", () => {
	it("registers --permission-mode flag with default 'default'", () => {
		expect(pi.registerFlag).toHaveBeenCalledWith(
			"permission-mode",
			expect.objectContaining({ type: "string", default: "default" }),
		);
	});

	it("registers Shift+Tab shortcut", () => {
		expect(shortcuts.has("shift+tab")).toBe(true);
	});

	it("registers /default, /plan, /auto, /mode, /auto-depth, /done commands", () => {
		expect(commands.has("default")).toBe(true);
		expect(commands.has("plan")).toBe(true);
		expect(commands.has("auto")).toBe(true);
		expect(commands.has("mode")).toBe(true);
		expect(commands.has("auto-depth")).toBe(true);
		expect(commands.has("done")).toBe(true);
	});

	it("subscribes to tool_call, context, before_agent_start, turn_end, agent_end, session_start, session_tree, turn_start, before_provider_request, message_update", () => {
		const events = pi.on.mock.calls.map((c: unknown[]) => c[0]);
		for (const e of [
			"tool_call",
			"context",
			"before_agent_start",
			"turn_end",
			"agent_end",
			"session_start",
			"session_tree",
			"turn_start",
			"before_provider_request",
			"message_update",
		]) {
			expect(events).toContain(e);
		}
	});
});

// ---------- Tests: tool_call gate ----------

describe("tool_call gate — default mode", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
	});

	it("passes read through", async () => {
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "read", input: { path: "/x" } },
			ctx,
		);
		expect(r).toBeUndefined();
	});

	it("passes safe bash through (no prompt)", async () => {
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "git status" } },
			ctx,
		);
		expect(r).toBeUndefined();
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("prompts for mutating bash and allows on 'Allow'", async () => {
		ctx.ui.select.mockResolvedValueOnce("Allow");
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "rm foo" } },
			ctx,
		);
		expect(ctx.ui.select).toHaveBeenCalled();
		expect(r).toBeUndefined();
	});

	it("blocks mutating bash on 'Block'", async () => {
		ctx.ui.select.mockResolvedValueOnce("Block");
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "rm foo" } },
			ctx,
		);
		expect(r).toMatchObject({ block: true });
	});

	it("prompts for edit and offers 'Allow all (enable auto)' option", async () => {
		ctx.ui.select.mockResolvedValueOnce("Allow");
		await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		const choices = ctx.ui.select.mock.calls[0]?.[1] as string[];
		expect(choices).toContain("Allow all (enable auto)");
	});

	it("'Allow all (enable auto)' switches to auto mode and allows the call", async () => {
		ctx.ui.select.mockResolvedValueOnce("Allow all (enable auto)");
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "edit", input: { path: "/x" } },
			ctx,
		);
		expect(r).toBeUndefined();
		// After the call, a subsequent edit should pass through with no prompt
		ctx.ui.select.mockClear();
		const r2 = await emit(
			handlers,
			"tool_call",
			{ toolName: "write", input: { path: "/y" } },
			ctx,
		);
		expect(r2).toBeUndefined();
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("blocks edit when no UI is available", async () => {
		const headless = makeContext({ hasUI: false });
		patchTheme(headless);
		await emit(handlers, "session_start", {}, headless);
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "edit", input: { path: "/x" } },
			headless,
		);
		expect(r).toMatchObject({ block: true });
		expect(headless.ui.select).not.toHaveBeenCalled();
	});

	it("blocks mutating bash when no UI is available", async () => {
		const headless = makeContext({ hasUI: false });
		patchTheme(headless);
		await emit(handlers, "session_start", {}, headless);
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "rm foo" } },
			headless,
		);
		expect(r).toMatchObject({ block: true });
	});
});

describe("tool_call gate — plan mode", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
		await commands.get("plan")!([], ctx);
	});

	it("blocks edit and write defensively", async () => {
		const r1 = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		const r2 = await emit(handlers, "tool_call", { toolName: "write", input: { path: "/y" } }, ctx);
		expect(r1).toMatchObject({ block: true });
		expect(r2).toMatchObject({ block: true });
	});

	it("blocks mutating bash (rm)", async () => {
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "rm foo" } },
			ctx,
		);
		expect(r).toMatchObject({ block: true });
	});

	it("allows read-only bash (git status)", async () => {
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "git status" } },
			ctx,
		);
		expect(r).toBeUndefined();
	});

	it("strips edit/write from active tools on plan entry", () => {
		// setActiveTools should have been called with a list that lacks "edit" and "write"
		const calls = (pi.setActiveTools as unknown as { mock: { calls: unknown[][] } }).mock.calls;
		// Find the call that was made when entering plan
		const planEntryCall = calls.find((c) => {
			const list = c[0] as string[] | undefined;
			return Array.isArray(list) && list.includes("read") && list.includes("bash");
		});
		expect(planEntryCall).toBeDefined();
		const planTools = planEntryCall![0] as string[];
		expect(planTools).not.toContain("edit");
		expect(planTools).not.toContain("write");
	});

	it("restores edit/write on exit from plan mode", async () => {
		pi.setActiveTools.mockClear();
		await commands.get("default")!([], ctx);
		const restoreCall = (pi.setActiveTools as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
			(c) => Array.isArray(c[0]) && (c[0] as string[]).includes("edit"),
		);
		expect(restoreCall).toBeDefined();
	});
});

describe("tool_call gate — auto mode", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
		await commands.get("auto")!([], ctx);
		ctx.ui.select.mockClear();
	});

	it("auto-approves edit without prompting", async () => {
		const r = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		expect(r).toBeUndefined();
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("auto-approves mutating bash without prompting", async () => {
		const r = await emit(
			handlers,
			"tool_call",
			{ toolName: "bash", input: { command: "rm foo" } },
			ctx,
		);
		expect(r).toBeUndefined();
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});
});

// ---------- Tests: Shift+Tab cycle ----------

describe("Shift+Tab cycle", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
		ctx.ui.notify.mockClear();
	});

	it("default → plan → auto → default", async () => {
		await shortcuts.get("shift+tab")!(ctx);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Mode: plan", "info");

		await shortcuts.get("shift+tab")!(ctx);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Mode: auto", "info");

		await shortcuts.get("shift+tab")!(ctx);
		expect(ctx.ui.notify).toHaveBeenLastCalledWith("Mode: default", "info");
	});
});

// ---------- Tests: /mode command ----------

describe("/mode command", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
	});

	it("/mode with no arg opens a selector", async () => {
		ctx.ui.select.mockResolvedValueOnce("plan");
		await commands.get("mode")!("", ctx);
		expect(ctx.ui.select).toHaveBeenCalled();
	});

	it("/mode plan switches directly", async () => {
		await commands.get("mode")!("plan", ctx);
		const r = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		expect(r).toMatchObject({ block: true });
	});

	it("/mode with unknown arg notifies error", async () => {
		await commands.get("mode")!("garbage", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unknown mode"), "error");
	});

	it("/mode with no arg in headless mode just shows current mode", async () => {
		const headless = makeContext({ hasUI: false });
		patchTheme(headless);
		await emit(handlers, "session_start", {}, headless);
		await commands.get("mode")!("", headless);
		expect(headless.ui.notify).toHaveBeenCalledWith("Mode: default");
	});
});

// ---------- Tests: /auto-depth ----------

describe("/auto-depth command", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
	});

	it("sets the cap and persists", async () => {
		await commands.get("auto-depth")!("5", ctx);
		expect(pi.appendEntry).toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith("auto-follow-up depth set to 5", "info");
	});

	it("with no arg shows current depth", async () => {
		await commands.get("auto-depth")!("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("auto-follow-up depth"), "info");
	});

	it("rejects negative", async () => {
		await commands.get("auto-depth")!("-1", ctx);
		// Should fall through to "show" branch
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("auto-follow-up depth"), "info");
	});

	it("accepts 0 for unlimited", async () => {
		await commands.get("auto-depth")!("0", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("auto-follow-up depth set to 0", "info");
	});
});

// ---------- Tests: /done command ----------

describe("/done command", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
		await commands.get("auto")!([], ctx);
		await commands.get("auto-depth")!("5", ctx);
		pi.sendUserMessage.mockClear();
	});

	it("stops auto-follow-up in auto mode by exhausting the cap", async () => {
		await commands.get("done")!([], ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Auto-follow-up stopped"),
			"info",
		);
		// After /done, turn_end should NOT trigger a follow-up
		await emit(handlers, "turn_end", {
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Working..." },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
			},
		}, ctx);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("does nothing when not in auto mode", async () => {
		await commands.get("default")!([], ctx);
		ctx.ui.notify.mockClear();
		await commands.get("done")!([], ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Not in auto mode — nothing to stop.",
			"info",
		);
	});
});


// ---------- Tests: context dedup ----------

describe("context dedup", () => {
	it("keeps only the latest modes-context message", async () => {
		const messages = [
			{ role: "user", content: "hello", customType: "modes-context" },
			{ role: "assistant", content: [{ type: "text", text: "hi" }] },
			{ role: "user", content: "second", customType: "modes-context" },
			{ role: "user", content: "third", customType: "modes-context" },
		];
		const r = await emit(handlers, "context", { messages }, ctx);
		const out = (r as { messages: unknown[] }).messages;
		const kept = out.filter((m) => (m as { customType?: string }).customType === "modes-context");
		expect(kept).toHaveLength(1);
		// In the filtered output, the kept message is the last modes-context
		expect(kept[0]).toBe(messages[3]);
	});
});

// ---------- Tests: before_agent_start injection ----------

describe("before_agent_start", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
	});

	it("injects a default-mode context message", async () => {
		const r = await emit(handlers, "before_agent_start", { prompt: "hi", systemPrompt: "x" }, ctx);
		const msg = (r as { message: { customType: string; display: boolean; content: string } }).message;
		expect(msg.customType).toBe("modes-context");
		expect(msg.display).toBe(false);
		expect(msg.content).toContain("DEFAULT MODE ACTIVE");
	});

	it("injects a plan-mode context message", async () => {
		await commands.get("plan")!([], ctx);
		const r = await emit(handlers, "before_agent_start", { prompt: "hi", systemPrompt: "x" }, ctx);
		const msg = (r as { message: { content: string } }).message;
		expect(msg.content).toContain("PLAN MODE ACTIVE");
	});

	it("injects an auto-mode context message", async () => {
		await commands.get("auto")!([], ctx);
		const r = await emit(handlers, "before_agent_start", { prompt: "hi", systemPrompt: "x" }, ctx);
		const msg = (r as { message: { content: string } }).message;
		expect(msg.content).toContain("AUTO MODE ACTIVE");
	});
});

// ---------- Tests: session_start restore ----------

describe("session_start restore", () => {
	it("uses --permission-mode flag when no persisted entry exists", async () => {
		(pi.getFlag as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue("plan");
		await emit(handlers, "session_start", {}, ctx);
		const r = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		expect(r).toMatchObject({ block: true });
	});

	it("persisted entry overrides flag (auto wins over default flag)", async () => {
		(pi.getFlag as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue("default");
		ctx.sessionManager.getEntries.mockReturnValue([
			{
				type: "custom",
				customType: "modes",
				data: { currentMode: "auto", autoFollowUpDepth: 5 },
			},
		]);
		await emit(handlers, "session_start", {}, ctx);
		// Now an edit should pass without prompt (we're in auto)
		const r = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		expect(r).toBeUndefined();
	});

	it("maps legacy 'ask' to default", async () => {
		(pi.getFlag as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue("ask");
		await emit(handlers, "session_start", {}, ctx);
		// Edit should prompt (default mode)
		ctx.ui.select.mockResolvedValueOnce("Allow");
		const r = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		expect(ctx.ui.select).toHaveBeenCalled();
		expect(r).toBeUndefined();
	});

	it("maps legacy 'accept-edits' to auto", async () => {
		(pi.getFlag as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue("accept-edits");
		await emit(handlers, "session_start", {}, ctx);
		const r = await emit(handlers, "tool_call", { toolName: "edit", input: { path: "/x" } }, ctx);
		expect(r).toBeUndefined();
	});
});

// ---------- Tests: auto-follow-up ----------

describe("auto-follow-up", () => {
	function assistantWithToolCall(text: string) {
		return {
			message: {
				role: "assistant",
				content: [
					{ type: "text", text },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
				],
			},
		};
	}

	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
		await commands.get("auto")!([], ctx);
		await commands.get("auto-depth")!("3", ctx);
		pi.sendUserMessage.mockClear();
	});

	it("sends a follow-up when assistant made tool calls and no completion signal", async () => {
		await emit(handlers, "turn_end", assistantWithToolCall("Working on it..."), ctx);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			"Continue. Auto mode is active — proceed without asking.",
			{ deliverAs: "followUp" },
		);
	});

	it("does NOT follow up when assistant text is a completion signal", async () => {
		await emit(handlers, "turn_end", assistantWithToolCall("All done."), ctx);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("does NOT follow up when assistant made no tool calls", async () => {
		await emit(
			handlers,
			"turn_end",
			{
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Just text, no tool calls." }],
				},
			},
			ctx,
		);
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("stops after reaching the depth cap", async () => {
		// depth is 3; fire 3 turn_ends (with agent_end between each to reset isStepping)
		await emit(handlers, "turn_end", assistantWithToolCall("step 1"), ctx);
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		await emit(handlers, "turn_end", assistantWithToolCall("step 2"), ctx);
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		await emit(handlers, "turn_end", assistantWithToolCall("step 3"), ctx);
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		// 4th call should NOT follow up
		await emit(handlers, "turn_end", assistantWithToolCall("step 4"), ctx);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(3);
	});

	it("0 depth = unlimited", async () => {
		await commands.get("auto-depth")!("0", ctx);
		pi.sendUserMessage.mockClear();
		for (let i = 0; i < 5; i++) {
			await emit(handlers, "turn_end", assistantWithToolCall(`step ${i}`), ctx);
			await emit(handlers, "agent_end", { messages: [] }, ctx);
		}
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(5);
	});

	it("isStepping blocks re-entrant follow-up", async () => {
		await emit(handlers, "turn_end", assistantWithToolCall("step 1"), ctx);
		// Second turn_end before agent_end → isStepping should block it
		await emit(handlers, "turn_end", assistantWithToolCall("step 2"), ctx);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
	});

	it("agent_end resets isStepping so the next turn can follow up", async () => {
		await emit(handlers, "turn_end", assistantWithToolCall("step 1"), ctx);
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		await emit(handlers, "turn_end", assistantWithToolCall("step 2"), ctx);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
	});

	it("auto-follow-up error sets isStepping=false and decrements counter", async () => {
		pi.sendUserMessage.mockImplementationOnce(() => {
			throw new Error("not supported");
		});
		await emit(handlers, "turn_end", assistantWithToolCall("step 1"), ctx);
		// Should not have left isStepping=true; should have decremented back to 0
		// (After this, agent_end → next turn_end should be allowed)
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		await emit(handlers, "turn_end", assistantWithToolCall("step 2"), ctx);
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Auto follow-up failed"), "warning");
	});
});

// ---------- Tests: plan flow ----------

describe("plan flow", () => {
	beforeEach(async () => {
		await emit(handlers, "session_start", {}, ctx);
		await commands.get("plan")!([], ctx);
	});

	it("Execute path switches to planExecuting=true and posts plan + execute message", async () => {
		ctx.ui.select.mockResolvedValueOnce("Execute the plan");
		const planText = `Plan:
1. Read the config file
2. Update the setting`;
		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: planText }],
					},
				],
			},
			ctx,
		);
		expect(pi.sendMessage).toHaveBeenCalled();
		// The execute call should have triggerTurn:true and deliverAs:"followUp"
		const execCall = pi.sendMessage.mock.calls.find(
			(c: unknown[]) => (c[0] as { customType?: string }).customType === "modes-execute",
		);
		expect(execCall).toBeDefined();
		expect(execCall![1]).toMatchObject({ triggerTurn: true, deliverAs: "followUp" });
	});

	it("Refine path opens editor and posts refinement", async () => {
		ctx.ui.select.mockResolvedValueOnce("Refine the plan");
		ctx.ui.editor.mockResolvedValueOnce("Please add error handling to step 1");
		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Plan:\n1. Inspect the codebase\n2. Modify the settings" }],
					},
				],
			},
			ctx,
		);
		expect(ctx.ui.editor).toHaveBeenCalled();
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			"Please add error handling to step 1",
			{ deliverAs: "followUp" },
		);
	});

	it("Stay path does nothing", async () => {
		ctx.ui.select.mockResolvedValueOnce("Stay in plan mode");
		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Plan:\n1. Inspect the codebase\n2. Modify the settings" }],
					},
				],
			},
			ctx,
		);
		// No execute or refine message sent
		const execCall = pi.sendMessage.mock.calls.find(
			(c: unknown[]) => (c[0] as { customType?: string }).customType === "modes-execute",
		);
		expect(execCall).toBeUndefined();
		expect(pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("posts 'Plan Complete!' and clears widget when all [DONE:n] are seen", async () => {
		// Manually simulate plan-execute state by sending a plan + Execute
		ctx.ui.select.mockResolvedValueOnce("Execute the plan");
		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Plan:\n1. Inspect the codebase\n2. Modify the settings" }],
					},
				],
			},
			ctx,
		);
		pi.sendMessage.mockClear();
		// Simulate a turn_end with the assistant marking both steps done
		await emit(
			handlers,
			"turn_end",
			{
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Done. [DONE:1] [DONE:2]" }],
				},
			},
			ctx,
		);
		// Then agent_end should detect all todos completed and post plan-complete
		await emit(
			handlers,
			"agent_end",
			{ messages: [] },
			ctx,
		);
		const completeCall = pi.sendMessage.mock.calls.find(
			(c: unknown[]) => (c[0] as { customType?: string }).customType === "plan-complete",
		);
		expect(completeCall).toBeDefined();
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-todos", undefined);
	});
});

// ---------- Tests: status pill ----------

describe("status pill", () => {
	it("sets a 'modes' status with the current mode", async () => {
		await emit(handlers, "session_start", {}, ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("modes", expect.stringContaining("Default"));
	});

	it("updates on mode change", async () => {
		await emit(handlers, "session_start", {}, ctx);
		ctx.ui.setStatus.mockClear();
		await commands.get("plan")!([], ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("modes", expect.stringContaining("Plan"));
	});
});

// ---------- Tests: isSafeCommand sanity (smoke) ----------

describe("isSafeCommand sanity check from inside factory", () => {
	it("agrees with itself across known cases", () => {
		expect(isSafeCommand("ls")).toBe(true);
		expect(isSafeCommand("rm foo")).toBe(false);
	});
});

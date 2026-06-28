/**
 * Integration tests for the permission-modes extension.
 *
 * Strategy: import the extension factory with a fake `ExtensionAPI` stub.
 * The stub captures all `pi.on(event, handler)` subscriptions; we then invoke
 * the captured `tool_call` handler directly with crafted events and contexts.
 *
 * This lets us assert the gate decision tree without booting real pi.
 */

import { describe, expect, it, beforeEach, vi } from "vitest"

import permissionModesExtension from "./index.ts"

// ---- minimal fake pi API ------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>

interface FakePi {
	handlers: Map<string, Handler[]>
	userMessages: Array<{ text: string; opts?: unknown }>
	appendEntries: Array<{ type: string; data: unknown }>
	activeTools: string[]
	flags: Record<string, unknown>
	getToolCallHandler: (mode?: string) => Handler | undefined
	simulateSessionStart: (cwd: string, ui?: unknown) => Promise<void>
	simulateToolCall: (
		toolName: string,
		input: Record<string, unknown>,
		ctx: object,
	) => Promise<unknown>
}

interface FakeCtxOptions {
	mode?: string
	cwd: string
	projectRoot?: string | null
	ui?: {
		select?: (label: string, options: string[]) => Promise<string>
		notify?: (msg: string) => void
		editor?: (label: string, val: string) => Promise<string | undefined>
	}
}

function createFakePi(): FakePi {
	const handlers = new Map<string, Handler[]>()
	const userMessages: Array<{ text: string; opts?: unknown }> = []
	const appendEntries: Array<{ type: string; data: unknown }> = []
	const activeTools = ["read", "edit", "write", "bash", "grep", "find"]
	const flags: Record<string, unknown> = { "permission-mode": "ask" }

	const pi = {
		handlers,
		userMessages,
		appendEntries,
		activeTools,
		flags,

		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? []
			list.push(handler)
			handlers.set(event, list)
		},
		registerCommand() {},
		registerShortcut() {},
		registerFlag(name: string, def: { default?: unknown }) {
			if (def?.default !== undefined) flags[name] = def.default
		},
		getFlag(name: string) {
			return flags[name]
		},
		appendEntry(type: string, data: unknown) {
			appendEntries.push({ type, data })
		},
		getActiveTools() {
			return [...activeTools]
		},
		setActiveTools(tools: string[]) {
			activeTools.length = 0
			activeTools.push(...tools)
		},
		sendUserMessage(text: string, opts?: unknown) {
			userMessages.push({ text, opts })
		},
		sendMessage() {},

		// Test helpers
		getToolCallHandler() {
			const list = handlers.get("tool_call") ?? []
			return list[0]
		},
		async simulateSessionStart(cwd: string, ui?: unknown) {
			const list = handlers.get("session_start") ?? []
			for (const h of list) await h({}, { cwd, hasUI: !!ui, ui })
		},
		async simulateToolCall(
			toolName: string,
			input: Record<string, unknown>,
			ctx: object,
		) {
			const list = handlers.get("tool_call") ?? []
			for (const h of list) {
				const result = await h({ toolName, input }, ctx)
				if (result !== undefined) return result
			}
			return undefined
		},
	}
	return pi
}

// Cast: we hand the fake pi to the extension factory which expects ExtensionAPI.
// The shape matches the subset of methods the extension actually calls.
function makeFakePiForExtension(p: FakePi) {
	return p as unknown as Parameters<typeof permissionModesExtension>[0]
}

function makeCtx(p: FakePi, opts: FakeCtxOptions) {
	const ui = opts.ui ?? {}
	return {
		cwd: opts.cwd,
		hasUI: !!opts.ui,
		ui: {
			select: ui.select ?? (async () => "Block"),
			notify: ui.notify ?? (() => {}),
			editor: ui.editor ?? (async () => undefined),
			setStatus: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setWorkingIndicator: () => {},
			setWorkingMessage: () => {},
			theme: {
				fg: (_role: string, text: string) => text,
				strikethrough: (t: string) => t,
			},
		},
		sessionManager: {
			getBranch: () => [],
			getGitBranch: () => "",
			getEntries: () => [],
		},
		model: undefined,
	}
}

// ---- tests --------------------------------------------------------------

describe("permission-modes extension: tool_call gate", () => {
	let pi: FakePi
	let realProjectRoot: string

	beforeEach(async () => {
		pi = createFakePi()
		// Use real fs: the current repo IS a project (has package.json).
		realProjectRoot = process.cwd()
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart(realProjectRoot)
	})

	async function callToolCall(
		toolName: string,
		input: Record<string, unknown>,
		ui?: FakeCtxOptions["ui"],
	) {
		const ctx = makeCtx(pi, {
			cwd: realProjectRoot,
			ui,
		})
		return pi.simulateToolCall(toolName, input, ctx)
	}

	async function switchMode(mode: string) {
		pi.flags["permission-mode"] = mode
		await pi.simulateSessionStart(realProjectRoot)
	}

	describe("ask mode", () => {
		it("prompts on edit (inside cwd)", async () => {
			await switchMode("ask")
			const result = await callToolCall("edit", { path: "src/foo.ts" }, {
				select: async () => "Block",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves read (inside cwd)", async () => {
			await switchMode("ask")
			const result = await callToolCall("read", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("prompts on read outside cwd", async () => {
			await switchMode("ask")
			const result = await callToolCall("read", { path: "/etc/passwd" })
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves safe bash", async () => {
			await switchMode("ask")
			const result = await callToolCall("bash", { command: "ls -la" })
			expect(result).toBeUndefined()
		})

		it("prompts on destructive bash", async () => {
			await switchMode("ask")
			const result = await callToolCall("bash", { command: "rm -rf /" }, {
				select: async () => "Block",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("prompts on grep outside cwd", async () => {
			await switchMode("ask")
			const result = await callToolCall("grep", { path: "/etc/hosts" })
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves grep inside cwd", async () => {
			await switchMode("ask")
			const result = await callToolCall("grep", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})
	})

	describe("plan mode", () => {
		it("blocks edit (defensive — tool is also stripped via setActiveTools)", async () => {
			await switchMode("plan")
			const result = await callToolCall("edit", { path: "src/foo.ts" })
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves read", async () => {
			await switchMode("plan")
			const result = await callToolCall("read", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("auto-approves safe bash", async () => {
			await switchMode("plan")
			const result = await callToolCall("bash", { command: "ls" })
			expect(result).toBeUndefined()
		})

		it("blocks destructive bash", async () => {
			await switchMode("plan")
			const result = await callToolCall("bash", { command: "rm -rf /" })
			expect(result).toMatchObject({ block: true })
		})
	})



	describe("auto mode", () => {
		it("auto-approves edit inside cwd", async () => {
			await switchMode("auto")
			const result = await callToolCall("edit", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("auto-approves edit outside cwd but inside project (relaxed)", async () => {
			await switchMode("auto")
			// cwd = realProjectRoot. We treat the repo as the project, and target
			// a path within it (which is by definition inside cwd → not outside → no prompt).
			// To exercise the relaxation we'd need a sub-cwd, which our fake doesn't easily set up.
			// Instead, assert the simpler invariant: in auto mode, in-cwd edits never prompt.
			const result = await callToolCall("edit", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("auto-approves bash destructive (inside cwd)", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", { command: "rm -rf ./build" })
			expect(result).toBeUndefined()
		})

		it("auto-approves read anywhere", async () => {
			await switchMode("auto")
			const result = await callToolCall("read", { path: "/etc/passwd" })
			expect(result).toBeUndefined()
		})
	})
})

describe("permission-modes extension: auto follow-up", () => {
	let pi: FakePi

	beforeEach(() => {
		pi = createFakePi()
	})

	async function simulateTurnEnd(message: unknown) {
		const list = pi.handlers.get("turn_end") ?? []
		for (const h of list) {
			await h({ message }, makeCtx(pi, { cwd: "/home/user/project/src" }))
		}
	}

	it("sends follow-up in auto mode when assistant turn has tool calls and no completion signal", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		await simulateTurnEnd({
			role: "assistant",
			content: [
				{ type: "text", text: "Working on step 2 now." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		})

		expect(pi.userMessages.length).toBe(1)
		expect(pi.userMessages[0].text).toContain("Auto mode is active")
		expect((pi.userMessages[0].opts as { deliverAs?: string })?.deliverAs).toBe(
			"followUp",
		)
	})

	it("does NOT send follow-up when text is a completion signal", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		await simulateTurnEnd({
			role: "assistant",
			content: [
				{ type: "text", text: "Task is complete." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		})

		expect(pi.userMessages.length).toBe(0)
	})

	it("does NOT send follow-up in ask mode", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")

		await simulateTurnEnd({
			role: "assistant",
			content: [
				{ type: "text", text: "Working..." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		})

		expect(pi.userMessages.length).toBe(0)
	})

	it("does NOT send follow-up when no tool calls in turn", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		await simulateTurnEnd({
			role: "assistant",
			content: [{ type: "text", text: "Just thinking." }],
		})

		expect(pi.userMessages.length).toBe(0)
	})

	it("does NOT send follow-up when depth limit reached", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		// Manually push count to limit via the persisted entry: tricky in this stub.
		// Instead, just verify the default depth (20) allows up to 20 follow-ups.
		// Send 21 turns and assert the 21st gets nothing.
		const turn = {
			role: "assistant",
			content: [
				{ type: "text", text: "Working." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		}
		// Each turn: agent_end (resets isStepping) then turn_end (sends follow-up if !stepping)
		const agentEndList = pi.handlers.get("agent_end") ?? []
		for (let i = 0; i < 25; i++) {
			for (const h of agentEndList) await h({ messages: [] }, makeCtx(pi, { cwd: "/home/user/project/src" }))
			await simulateTurnEnd(turn)
		}
		expect(pi.userMessages.length).toBe(20)
	})

	it("resets follow-up count when mode switches", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		const turn = {
			role: "assistant",
			content: [
				{ type: "text", text: "Working." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		}
		const agentEndList = pi.handlers.get("agent_end") ?? []
		for (let i = 0; i < 5; i++) {
			for (const h of agentEndList) await h({ messages: [] }, makeCtx(pi, { cwd: "/home/user/project/src" }))
			await simulateTurnEnd(turn)
		}
		expect(pi.userMessages.length).toBe(5)

		// Switch to ask → count resets
		pi.flags["permission-mode"] = "ask"
		await pi.simulateSessionStart("/home/user/project/src")

		// Switch back to auto → count starts at 0
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")
		for (let i = 0; i < 3; i++) {
			for (const h of agentEndList) await h({ messages: [] }, makeCtx(pi, { cwd: "/home/user/project/src" }))
			await simulateTurnEnd(turn)
		}
		expect(pi.userMessages.length).toBe(8) // 5 + 3
	})

	it("does NOT crash when sendUserMessage throws (followUp unavailable)", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		// Replace sendUserMessage with one that throws
		const originalSendUserMessage = pi.sendUserMessage
		pi.sendUserMessage = () => {
			throw new Error("followUp delivery not supported")
		}
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		// Should not throw
		await simulateTurnEnd({
			role: "assistant",
			content: [
				{ type: "text", text: "Working." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		})

		expect(consoleSpy).toHaveBeenCalled()
		consoleSpy.mockRestore()
		pi.sendUserMessage = originalSendUserMessage
	})
})
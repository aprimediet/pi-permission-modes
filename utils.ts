/**
 * Pure helpers for the permission-modes extension.
 *
 * - Bash read-only classifier used by Plan mode and the default/accept-edits
 *   gates (SAFE allowlist AND not DESTRUCTIVE).
 * - Outside-cwd / project-root detection for the auto-mode relaxation.
 * - Numbered "Plan:" extraction and [DONE:n] step tracking used by Plan mode's
 *   execute/track flow.
 *
 * Ported from pi's bundled `examples/extensions/plan-mode/utils.ts`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

const MAX_TRACKED_WRITES = 100

// Commands that mutate state — never allowed in plan mode, and prompt elsewhere.
const DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/, // single redirect (not >>)
	/>>/, // append redirect
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Read-only commands allowed without confirmation.
const SAFE_PATTERNS: RegExp[] = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

/** A command is "safe" iff it matches the allowlist AND no destructive pattern. */
export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // strip bold/italic
		.replace(/`([^`]+)`/g, "$1") // strip inline code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

/** Extract a numbered list under a `Plan:` header into TodoItems. */
export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

/** Mark any `[DONE:n]` steps found in `text` complete. Returns how many tags were seen. */
export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}

const COMPLETION_SIGNALS: RegExp[] = [
	/\b(plan|task|work|job|everything|all)\s+(is\s+|are\s+|has\s+been\s+)?(complete|completed|done|finished)\b/i,
	/\ball\s+done\b/i,
	/\bno\s+(more|further)\s+(steps|tasks|actions|work)\b/i,
	/\b(i'?m|i\s+am)\s+(done|finished)\b/i,
	/\bfinished\b/i,
];

/** Heuristic: does the assistant text claim the work is finished? */
export function isCompletionSignal(text: string): boolean {
	return COMPLETION_SIGNALS.some((p) => p.test(text));
}

/** Compact token count, e.g. 1234 -> "1.2k", 12000 -> "12k". */
export function formatCount(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n < 1000) return String(Math.round(n));
	const k = n / 1000;
	return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
}

/**
 * Returns true iff `targetPath` resolves to a location outside `cwd`.
 *
 * Empty string is treated as "inside cwd" (no path = nothing to be outside of).
 * Absolute paths are compared against cwd; relative paths are resolved from cwd.
 * Does NOT resolve symlinks — same limitation as `path.resolve`.
 */
export function isOutsideCwd(targetPath: string, cwd: string): boolean {
	if (!targetPath) return false;
	const resolved = path.isAbsolute(targetPath)
		? path.resolve(targetPath)
		: path.resolve(cwd, targetPath);
	const cwdAbs = path.resolve(cwd);
	// Same dir or strictly inside cwd → not outside
	if (resolved === cwdAbs) return false;
	return !resolved.startsWith(cwdAbs + path.sep);
}

/**
 * Heuristic: does a bash command reference paths outside `cwd`?
 *
 * Flags:
 *   - absolute paths anywhere in the command
 *   - `..` traversal (cd .., ls ../foo)
 *   - `~` or `$HOME` / `$TMPDIR` expansions
 *
 * Conservative: false negatives are acceptable (we still prompt for destructive
 * commands separately), false positives are NOT — we don't want to over-prompt.
 */
export function commandTargetsOutsideCwd(command: string, cwd: string): boolean {
	if (!command || !command.trim()) return false;

	// Absolute path anywhere in the command.
	// `/` must be at the start of a token (after whitespace, ;&|() or string start),
	// and the next char must be a real path char (not `.` to avoid `./` and `../` false positives).
	if (/(^|[\s;&|('])(\/[A-Za-z0-9_\-])/.test(command)) return true;

	// Tilde expansion: `~` at start of token (not in the middle of a path)
	if (/(^|[\s;&|()])(~|\$HOME|\$TMPDIR|\$TMP|\$PWD\b)/.test(command)) return true;

	// `..` as a path component (not as part of `...` or `./..`)
	if (/(^|[\s;&|(])\.\.($|[\s/&|)])/.test(command)) return true;

	return false;
}

/**
 * Walk up from `cwd` looking for a project root marker (.git or package.json).
 * Returns the project root path, or `null` if none found within 20 levels.
 */
export function findProjectRoot(cwd: string): string | null {
	let dir = path.resolve(cwd);
	for (let i = 0; i < 20; i++) {
		// Stop at filesystem root
		if (dir === path.dirname(dir)) return null;
		// Detect: .git, package.json
		if (
			existsSync(path.join(dir, ".git")) ||
			existsSync(path.join(dir, "package.json"))
		) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return null;
}

/**
 * Resolve the project's stable ID. Looks for the existing
 * `.pi/permission-modes-<hash>.md` marker file (created by pi when the
 * project was opened). Falls back to a hash of `cwd` if not found.
 *
 * The marker filename is the canonical source because pi creates it
 * automatically and uses the same hash for kanban boards, memory, etc.
 */
export function getProjectId(cwd: string): string {
	try {
		const piDir = path.join(cwd, ".pi")
		if (existsSync(piDir)) {
			const entries = readdirSync(piDir)
			const match = entries.find((e) =>
				/^permission-modes-[a-f0-9]+\.md$/.test(e),
			)
			if (match) {
				const id = match.replace(/^permission-modes-/, "").replace(/\.md$/, "")
				return id
			}
		}
	} catch {
		/* ignore — fall through to hash fallback */
	}
	return hashPath(cwd)
}

/** First 8 hex chars of sha256(input). Deterministic. */
export function hashPath(p: string): string {
	return createHash("sha256").update(p).digest("hex").slice(0, 8)
}

/**
 * Return the absolute path to the project's outside-writes snapshot dir,
 * creating it (and all parents) if it doesn't exist.
 *
 * Layout: `<cwd>/.pi/projects/<projectId>/tmp/outside-writes/`
 *
 * Created lazily on first call so empty projects don't litter their tree.
 * Safe to call repeatedly — idempotent.
 */
export function getProjectTmpDir(cwd: string): string {
	const id = getProjectId(cwd)
	const dir = path.join(cwd, ".pi", "projects", id, "tmp", "outside-writes")
	mkdirSync(dir, { recursive: true })
	return dir
}

/**
 * Check if `targetPath` is inside the project root (if one can be detected
 * or is provided). Returns false if no project root is found — caller should
 * fall back to `isOutsideCwd` in that case.
 */
export function isInsideProject(
	targetPath: string,
	cwd: string,
	projectRoot?: string | null,
): boolean {
	const root = projectRoot ?? findProjectRoot(cwd);
	if (!root) return false;
	const resolved = path.isAbsolute(targetPath)
		? path.resolve(targetPath)
		: path.resolve(cwd, targetPath);
	const rootAbs = path.resolve(root);
	return resolved.startsWith(rootAbs + path.sep) || resolved === rootAbs;
}

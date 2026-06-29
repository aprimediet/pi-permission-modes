import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import {
	commandTargetsOutsideCwd,
	extractTodoItems,
	findProjectRoot,
	formatCount,
	getProjectId,
	getProjectTmpDir,
	hashPath,
	isCompletionSignal,
	isInsideProject,
	isOutsideCwd,
	isSafeCommand,
	listTrackedOutsideWrites,
	markCompletedSteps,
	popTrackedOutsideWrite,
	restoreOutsideWrite,
	trackOutsideWrite,
	type OutsideWriteSnapshot,
	type TodoItem,
} from "./utils.ts";

describe("isSafeCommand", () => {
	it("approves commands matching SAFE_PATTERNS", () => {
		expect(isSafeCommand("ls -la")).toBe(true);
		expect(isSafeCommand("cat foo.txt")).toBe(true);
		expect(isSafeCommand("grep -r pattern src")).toBe(true);
		expect(isSafeCommand("git status")).toBe(true);
		expect(isSafeCommand("git log --oneline")).toBe(true);
		expect(isSafeCommand("npm list")).toBe(true);
		expect(isSafeCommand("curl https://example.com")).toBe(true);
	});

	it("rejects destructive commands", () => {
		expect(isSafeCommand("rm -rf /")).toBe(false);
		expect(isSafeCommand("mv foo bar")).toBe(false);
		expect(isSafeCommand("npm install")).toBe(false);
		expect(isSafeCommand("git commit -m msg")).toBe(false);
		expect(isSafeCommand("sudo apt install foo")).toBe(false);
	});

	it("rejects safe-prefixed commands that contain destructive content", () => {
		// safe pattern + destructive = not safe
		expect(isSafeCommand("ls && rm -rf /")).toBe(false);
		expect(isSafeCommand("echo hi > out.txt")).toBe(false); // redirect
	});

	it("rejects empty / whitespace-only strings", () => {
		expect(isSafeCommand("")).toBe(false);
		expect(isSafeCommand("   ")).toBe(false);
		expect(isSafeCommand("\n")).toBe(false);
	});

	it("rejects unknown commands", () => {
		expect(isSafeCommand("someweirdcommand foo bar")).toBe(false);
	});
});

describe("isOutsideCwd", () => {
	const cwd = "/home/user/project";

	it("returns false for paths inside cwd", () => {
		expect(isOutsideCwd("./foo", cwd)).toBe(false);
		expect(isOutsideCwd("src/index.ts", cwd)).toBe(false);
		expect(isOutsideCwd(".", cwd)).toBe(false);
		expect(isOutsideCwd(cwd, cwd)).toBe(false);
	});

	it("returns true for paths outside cwd", () => {
		expect(isOutsideCwd("../foo", cwd)).toBe(true);
		expect(isOutsideCwd("/etc/passwd", cwd)).toBe(true);
		expect(isOutsideCwd("/tmp/something", cwd)).toBe(true);
	});

	it("returns false for empty string (no path = inside cwd by default)", () => {
		expect(isOutsideCwd("", cwd)).toBe(false);
	});
});

describe("commandTargetsOutsideCwd", () => {
	const cwd = "/home/user/project";

	it("flags commands with absolute paths outside cwd", () => {
		expect(commandTargetsOutsideCwd("ls /etc/passwd", cwd)).toBe(true);
		expect(commandTargetsOutsideCwd("cat /tmp/foo", cwd)).toBe(true);
	});

	it("flags cd .. / ../ traversal", () => {
		expect(commandTargetsOutsideCwd("cd ..", cwd)).toBe(true);
		expect(commandTargetsOutsideCwd("ls ../sibling", cwd)).toBe(true);
		expect(commandTargetsOutsideCwd("cat ../../foo", cwd)).toBe(true);
	});

	it("flags ~ expansion", () => {
		expect(commandTargetsOutsideCwd("ls ~", cwd)).toBe(true);
		expect(commandTargetsOutsideCwd("cat ~/notes.txt", cwd)).toBe(true);
	});

	it("flags $HOME / $TMPDIR expansions", () => {
		expect(commandTargetsOutsideCwd("ls $HOME", cwd)).toBe(true);
		expect(commandTargetsOutsideCwd("cat $TMPDIR/foo", cwd)).toBe(true);
	});

	it("does NOT flag safe commands that don't reference paths", () => {
		expect(commandTargetsOutsideCwd("ls", cwd)).toBe(false);
		expect(commandTargetsOutsideCwd("ps aux", cwd)).toBe(false);
	});

	it("does NOT flag commands that only reference cwd-local paths", () => {
		expect(commandTargetsOutsideCwd("cat ./foo.txt", cwd)).toBe(false);
		expect(commandTargetsOutsideCwd("ls src/", cwd)).toBe(false);
	});

	it("flags read-only commands that reference outside paths", () => {
		expect(commandTargetsOutsideCwd("cat /etc/passwd", cwd)).toBe(true);
		expect(commandTargetsOutsideCwd("grep foo /etc/hosts", cwd)).toBe(true);
	});

	it("returns false for empty / whitespace", () => {
		expect(commandTargetsOutsideCwd("", cwd)).toBe(false);
		expect(commandTargetsOutsideCwd("   ", cwd)).toBe(false);
	});
});

describe("findProjectRoot", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "perm-modes-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects .git directory", () => {
		mkdirSync(join(tmpDir, ".git"));
		mkdirSync(join(tmpDir, "src"));
		expect(findProjectRoot(join(tmpDir, "src"))).toBe(tmpDir);
	});

	it("detects package.json", () => {
		writeFileSync(join(tmpDir, "package.json"), "{}");
		mkdirSync(join(tmpDir, "src"));
		expect(findProjectRoot(join(tmpDir, "src"))).toBe(tmpDir);
	});

	it("returns null when no markers found", () => {
		mkdirSync(join(tmpDir, "src"));
		expect(findProjectRoot(join(tmpDir, "src"))).toBe(null);
	});

	it("stops at the innermost project root (nested package.json)", () => {
		writeFileSync(join(tmpDir, "package.json"), "{}");
		mkdirSync(join(tmpDir, "packages"));
		mkdirSync(join(tmpDir, "packages", "app"));
		writeFileSync(join(tmpDir, "packages", "app", "package.json"), "{}");
		// walking up from packages/app should stop at packages/app (innermost)
		expect(findProjectRoot(join(tmpDir, "packages", "app"))).toBe(
			join(tmpDir, "packages", "app"),
		);
	});
});

describe("isInsideProject", () => {
	const cwd = "/home/user/project/src"
	const projectRoot = "/home/user/project"

	it("returns true for path inside project root", () => {
		expect(isInsideProject("./foo.ts", cwd, projectRoot)).toBe(true)
		expect(isInsideProject("index.ts", cwd, projectRoot)).toBe(true)
	})

	it("returns true for path outside cwd but inside project root (relaxation case)", () => {
		// cwd is /home/user/project/src, project root is /home/user/project
		// writing to ../README.md = /home/user/project/README.md → inside project
		expect(isInsideProject("../README.md", cwd, projectRoot)).toBe(true)
	})

	it("returns false for path outside project root", () => {
		expect(isInsideProject("/etc/passwd", cwd, projectRoot)).toBe(false)
		expect(isInsideProject("../../sibling/foo", cwd, projectRoot)).toBe(false)
	})

	it("returns false when project root is null", () => {
		expect(isInsideProject("./foo.ts", cwd, null)).toBe(false)
	})

	it("returns true for project root itself", () => {
		expect(isInsideProject(".", cwd, projectRoot)).toBe(true)
	})
})

describe("extractTodoItems", () => {
	it("extracts numbered items under a Plan: header", () => {
		const msg = `
Plan:
1. First step description here
2. Second step description here
3. Third step description here
`;
		const items = extractTodoItems(msg);
		expect(items.length).toBe(3);
		expect(items[0]).toMatchObject({ step: 1, completed: false });
		expect(items[1].step).toBe(2);
		expect(items[2].step).toBe(3);
	});

	it("returns empty array when no Plan: header", () => {
		expect(extractTodoItems("Just some text without a plan")).toEqual([]);
	});

	it("returns empty array for empty input", () => {
		expect(extractTodoItems("")).toEqual([]);
	});

	it("handles Plan: with bold markers", () => {
		const msg = `**Plan:**\n1. Step one text\n2. Step two text`;
		const items = extractTodoItems(msg);
		expect(items.length).toBe(2);
	});

	it("skips very short items", () => {
		const msg = `Plan:\n1. ok\n2. This is a real step\n`;
		const items = extractTodoItems(msg);
		// very short items may be filtered; depends on threshold (we filter < 3 chars after cleaning)
		const texts = items.map((i) => i.text);
		expect(texts.some((t) => t.includes("real step"))).toBe(true);
	});
});

describe("markCompletedSteps", () => {
	let items: TodoItem[]

	beforeEach(() => {
		items = [
			{ step: 1, text: "First", completed: false },
			{ step: 2, text: "Second", completed: false },
			{ step: 3, text: "Third", completed: false },
		]
	})

	it("marks a single [DONE:n] step", () => {
		markCompletedSteps("Finished [DONE:1]", items);
		expect(items[0].completed).toBe(true);
		expect(items[1].completed).toBe(false);
	});

	it("marks multiple [DONE:n] steps", () => {
		markCompletedSteps("Done with [DONE:1] and [DONE:2]", items);
		expect(items[0].completed).toBe(true);
		expect(items[1].completed).toBe(true);
		expect(items[2].completed).toBe(false);
	});

	it("ignores non-existent step numbers", () => {
		markCompletedSteps("Done [DONE:99]", items);
		expect(items.every((i) => !i.completed)).toBe(true);
	});

	it("handles out-of-order tags", () => {
		markCompletedSteps("Done [DONE:3] [DONE:1]", items);
		expect(items[0].completed).toBe(true);
		expect(items[2].completed).toBe(true);
	});

	it("returns 0 for no tags", () => {
		expect(markCompletedSteps("nothing here", items)).toBe(0);
	});
});

describe("isCompletionSignal", () => {
	it("matches common completion phrases", () => {
		expect(isCompletionSignal("The task is complete.")).toBe(true);
		expect(isCompletionSignal("All done.")).toBe(true);
		expect(isCompletionSignal("Plan complete.")).toBe(true);
		expect(isCompletionSignal("Everything is finished.")).toBe(true);
		expect(isCompletionSignal("I'm done.")).toBe(true);
	});

	it("does not match unrelated text", () => {
		expect(isCompletionSignal("Working on it...")).toBe(false);
		expect(isCompletionSignal("Let me check the file.")).toBe(false);
	});

	it("returns false for empty text", () => {
		expect(isCompletionSignal("")).toBe(false);
	});
});

describe("formatCount", () => {
	it("returns 0 for 0", () => {
		expect(formatCount(0)).toBe("0");
	});

	it("returns the number for small values", () => {
		expect(formatCount(1)).toBe("1");
		expect(formatCount(999)).toBe("999");
	});

	it("formats thousands as k", () => {
		expect(formatCount(1234)).toBe("1.2k");
		expect(formatCount(9999)).toBe("10.0k");
		expect(formatCount(12000)).toBe("12k");
	});

	it("handles invalid numbers", () => {
		expect(formatCount(NaN)).toBe("0");
		expect(formatCount(Infinity)).toBe("0");
		expect(formatCount(-100)).toBe("0");
	});
});
describe("getProjectId", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pm-pid-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns existing hash from .pi/permission-modes-*.md", () => {
		mkdirSync(join(tmpDir, ".pi"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".pi", "permission-modes-45ea0551.md"),
			"# project marker",
		);
		expect(getProjectId(tmpDir)).toBe("45ea0551");
	});

	it("falls back to cwd hash when no marker exists", () => {
		const id = getProjectId(tmpDir);
		expect(id).toMatch(/^[a-f0-9]{8}$/);
		expect(id).toBe(getProjectId(tmpDir)); // deterministic
	});

	it("falls back when .pi/ exists but no permission-modes-*.md", () => {
		mkdirSync(join(tmpDir, ".pi"), { recursive: true });
		writeFileSync(join(tmpDir, ".pi", "other.md"), "");
		const id = getProjectId(tmpDir);
		expect(id).toMatch(/^[a-f0-9]{8}$/);
	});
});

describe("hashPath", () => {
	it("returns deterministic 8-char hex hash", () => {
		expect(hashPath("/etc/passwd")).toMatch(/^[a-f0-9]{8}$/);
		expect(hashPath("/etc/passwd")).toBe(hashPath("/etc/passwd"));
	});

	it("returns different hashes for different paths", () => {
		expect(hashPath("/etc/passwd")).not.toBe(hashPath("/etc/hosts"));
	});

	it("handles empty string", () => {
		expect(hashPath("")).toMatch(/^[a-f0-9]{8}$/);
	});
});

describe("getProjectTmpDir", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pm-tmp-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates .pi/projects/<id>/tmp/outside-writes/", () => {
		const result = getProjectTmpDir(tmpDir);
		expect(existsSync(result)).toBe(true);
		expect(result).toContain(".pi/projects/");
		expect(result).toContain("/tmp/outside-writes");
		expect(result.startsWith(tmpDir)).toBe(true);
	});

	it("uses existing project hash when present", () => {
		mkdirSync(join(tmpDir, ".pi"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".pi", "permission-modes-deadbeef.md"),
			"",
		);
		expect(getProjectTmpDir(tmpDir)).toContain("/deadbeef/");
	});

	it("is idempotent (second call returns same path)", () => {
		const a = getProjectTmpDir(tmpDir);
		const b = getProjectTmpDir(tmpDir);
		expect(a).toBe(b);
	});
});


describe("trackOutsideWrite + listTrackedOutsideWrites", () => {
	let tmpDir: string;
	let cwd: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pm-track-"));
		cwd = tmpDir;
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes a snapshot file with all fields", () => {
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: "/home/user/.bashrc",
			toolName: "write",
			backupContent: "old content\n",
		};
		trackOutsideWrite(cwd, snap);
		const list = listTrackedOutsideWrites(cwd);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject(snap);
	});

	it("records null backupContent for new files", () => {
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: "/tmp/brand-new.txt",
			toolName: "write",
			backupContent: null,
		};
		trackOutsideWrite(cwd, snap);
		expect(listTrackedOutsideWrites(cwd)[0].backupContent).toBeNull();
	});

	it("sorts multiple snapshots by timestamp ascending", () => {
		trackOutsideWrite(cwd, { timestamp: "2026-06-29T12:00:02.000Z", originalPath: "/a", toolName: "write", backupContent: null });
		trackOutsideWrite(cwd, { timestamp: "2026-06-29T12:00:01.000Z", originalPath: "/b", toolName: "edit", backupContent: "x" });
		trackOutsideWrite(cwd, { timestamp: "2026-06-29T12:00:03.000Z", originalPath: "/c", toolName: "write", backupContent: null });
		const list = listTrackedOutsideWrites(cwd);
		expect(list.map((s) => s.originalPath)).toEqual(["/b", "/a", "/c"]);
	});

	it("returns empty array when no snapshots exist", () => {
		expect(listTrackedOutsideWrites(cwd)).toEqual([]);
	});

	it("skips malformed snapshot files without throwing", () => {
		const dir = getProjectTmpDir(cwd);
		writeFileSync(join(dir, "garbage.json"), "{not json");
		expect(listTrackedOutsideWrites(cwd)).toEqual([]);
	});

	it("caps at MAX_TRACKED_WRITES (100) and LRU-evicts oldest", () => {
		// Insert 101 snapshots with increasing timestamps
		for (let i = 0; i < 101; i++) {
			trackOutsideWrite(cwd, {
				timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
				originalPath: `/p/${i}`,
				toolName: "write",
				backupContent: null,
			});
		}
		const list = listTrackedOutsideWrites(cwd);
		expect(list).toHaveLength(100);
		// Oldest (i=0) should be evicted
		expect(list[0].originalPath).toBe("/p/1");
		// Newest (i=100) should remain
		expect(list[99].originalPath).toBe("/p/100");
	});
});

describe("restoreOutsideWrite + popTrackedOutsideWrite", () => {
	let tmpDir: string;
	let outsideFile: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pm-restore-"));
		outsideFile = join(tmpDir, "outside.txt");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("restores backup content when backupContent is non-null", () => {
		writeFileSync(outsideFile, "new content");
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: outsideFile,
			toolName: "write",
			backupContent: "original content",
		};
		const result = restoreOutsideWrite(snap);
		expect(result).toEqual({ restored: true, action: "restored" });
		expect(readFileSync(outsideFile, "utf-8")).toBe("original content");
	});

	it("deletes file when backupContent is null", () => {
		writeFileSync(outsideFile, "new content");
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: outsideFile,
			toolName: "write",
			backupContent: null,
		};
		const result = restoreOutsideWrite(snap);
		expect(result).toEqual({ restored: true, action: "deleted" });
		expect(existsSync(outsideFile)).toBe(false);
	});

	it("returns noop when file already restored", () => {
		// backupContent is "original" but file was never written by the write
		writeFileSync(outsideFile, "original");
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: outsideFile,
			toolName: "write",
			backupContent: "original",
		};
		const result = restoreOutsideWrite(snap);
		// Content matches, so no change needed
		expect(result.action).toBe("noop");
		expect(readFileSync(outsideFile, "utf-8")).toBe("original");
	});

	it("deletes file on noop when backupContent is null and file missing", () => {
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: outsideFile, // doesn't exist
			toolName: "write",
			backupContent: null,
		};
		const result = restoreOutsideWrite(snap);
		expect(result.action).toBe("noop");
	});

	it("popTrackedOutsideWrite removes the snapshot file", () => {
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: "/x",
			toolName: "write",
			backupContent: null,
		};
		trackOutsideWrite(tmpDir, snap);
		expect(listTrackedOutsideWrites(tmpDir)).toHaveLength(1);
		popTrackedOutsideWrite(tmpDir, snap);
		expect(listTrackedOutsideWrites(tmpDir)).toHaveLength(0);
	});

	it("popTrackedOutsideWrite is safe when file missing", () => {
		const snap: OutsideWriteSnapshot = {
			timestamp: "2026-06-29T12:00:00.000Z",
			originalPath: "/x",
			toolName: "write",
			backupContent: null,
		};
		expect(() => popTrackedOutsideWrite(tmpDir, snap)).not.toThrow();
	});
});


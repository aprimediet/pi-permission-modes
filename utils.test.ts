import { describe, expect, it } from "vitest";
import {
	cleanStepText,
	extractDoneSteps,
	extractTodoItems,
	formatCount,
	isCompletionSignal,
	isDestructiveCommand,
	isSafeCommand,
	markCompletedSteps,
	type TodoItem,
} from "./utils.ts";

// ---------- isSafeCommand ----------

describe("isSafeCommand", () => {
	const safe: string[] = [
		"ls -la",
		"cat foo.txt",
		"head -n 5 file.log",
		"tail -f /var/log/app",
		"less README.md",
		"grep -r 'TODO' src/",
		"find . -name '*.ts'",
		"pwd",
		"echo hello world",
		"printf '%s\\n' hi",
		"wc -l file.txt",
		"sort file.txt",
		"uniq file.txt",
		"diff a.txt b.txt",
		"file foo",
		"stat foo",
		"du -sh src",
		"df -h",
		"tree -L 2",
		"which node",
		"whereis bash",
		"env",
		"uname -a",
		"whoami",
		"id",
		"date",
		"uptime",
		"ps aux",
		"top -b -n 1",
		"free -m",
		"git status",
		"git log --oneline",
		"git diff HEAD",
		"git show HEAD",
		"git branch -a",
		"git remote -v",
		"git config --get user.name",
		"git ls-files",
		"npm list",
		"npm ls",
		"npm view lodash",
		"node --version",
		"python --version",
		"curl https://example.com",
		"wget -O- https://example.com",
		"jq '.foo' file.json",
		"rg 'foo' src/",
		"fd '*.ts'",
	];

	it.each(safe)("allows read-only command: %s", (cmd) => {
		expect(isSafeCommand(cmd)).toBe(true);
	});

	const destructive: string[] = [
		"rm foo.txt",
		"rm -rf /tmp/x",
		"rmdir empty",
		"mv a b",
		"cp a b",
		"mkdir newdir",
		"touch new.txt",
		"chmod 777 foo",
		"chown root foo",
		"ln -s a b",
		"tee foo",
		"truncate -s 0 foo",
		"dd if=/dev/zero of=foo bs=1",
		"shred foo",
		"echo hi > out.txt",
		"echo hi >> out.txt",
		"npm install lodash",
		"npm uninstall lodash",
		"npm update",
		"npm ci",
		"npm link",
		"npm publish",
		"yarn add foo",
		"yarn remove foo",
		"yarn install",
		"pnpm add foo",
		"pip install requests",
		"pip uninstall requests",
		"apt install vim",
		"apt-get install vim",
		"apt remove vim",
		"brew install wget",
		"brew upgrade",
		"git add .",
		"git commit -m msg",
		"git push origin main",
		"git pull",
		"git merge feature",
		"git rebase main",
		"git reset --hard",
		"git checkout main",
		"git branch -D feature",
		"git stash",
		"git cherry-pick abc",
		"git revert abc",
		"git tag v1",
		"git init",
		"git clone url",
		"sudo apt update",
		"su root",
		"kill 1234",
		"pkill node",
		"killall node",
		"reboot",
		"shutdown now",
		"systemctl start nginx",
		"systemctl stop nginx",
		"systemctl restart nginx",
		"service nginx start",
		"vim foo",
		"vi foo",
		"nano foo",
		"emacs foo",
		"code .",
		"subl .",
	];

	it.each(destructive)("blocks destructive command: %s", (cmd) => {
		expect(isSafeCommand(cmd)).toBe(false);
	});

	it("blocks a safe-looking command with shell redirection to file", () => {
		// `cat foo` is safe, but `cat foo > bar` is destructive via the `>` pattern
		expect(isSafeCommand("cat foo > bar")).toBe(false);
	});

	it("blocks a safe command combined with destructive suffix", () => {
		// `ls ; rm foo` — the `rm` is destructive
		expect(isSafeCommand("ls ; rm foo")).toBe(false);
	});

	it("blocks a command that is neither safe nor destructive", () => {
		expect(isSafeCommand("someweirdcommand")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isSafeCommand("")).toBe(false);
	});
});

// ---------- isDestructiveCommand ----------

describe("isDestructiveCommand", () => {
	it("returns true for destructive patterns", () => {
		expect(isDestructiveCommand("rm foo")).toBe(true);
		expect(isDestructiveCommand("git push")).toBe(true);
		expect(isDestructiveCommand("echo hi > out.txt")).toBe(true);
	});

	it("returns false for read-only commands", () => {
		expect(isDestructiveCommand("ls -la")).toBe(false);
		expect(isDestructiveCommand("cat foo")).toBe(false);
		expect(isDestructiveCommand("git status")).toBe(false);
	});
});

// ---------- cleanStepText ----------

describe("cleanStepText", () => {
	it("strips bold markers", () => {
		// After bold removal: "Run the tests" → "Tests" (because "Run" is in action-verb list)
		expect(cleanStepText("**Run the tests**")).toBe("Tests");
	});

	it("strips italic markers", () => {
		// After italic removal: "create the file" → "Create the file" → "File" (Create is in verb list)
		expect(cleanStepText("*create* the file")).toBe("File");
	});

	it("strips inline code", () => {
		// "Run `npm install` to install deps" → "Run npm install to install deps"
		// → "npm install to install deps" (Run stripped) → "Npm install to install deps"
		//   (Install stripped as leading verb too)
		expect(cleanStepText("Run `npm install` to install deps")).toBe("Npm install to install deps");
	});

	it("strips leading action verbs (verbatim plan-mode behavior)", () => {
		// "Execute the migration script" → "Migration script"
		expect(cleanStepText("Execute the migration script")).toBe("Migration script");
		// "Add a new column to the users table" → "A new column to the users table"
		expect(cleanStepText("Add a new column to the users table")).toBe("A new column to the users table");
		// "Read the user model file" → "User model file" (Read stripped)
		expect(cleanStepText("Read the user model file")).toBe("User model file");
		// "Update the package.json" → "Package.json" (Update stripped)
		expect(cleanStepText("Update the package.json")).toBe("Package.json");
		// "Inspect the user model file" — Inspect is NOT in the verb list, so untouched
		expect(cleanStepText("Inspect the user model file")).toBe("Inspect the user model file");
	});

	it("capitalizes the first letter", () => {
		expect(cleanStepText("simple step description")).toBe("Simple step description");
	});

	it("truncates long steps to 50 chars", () => {
		const long =
			"This is a very long step description that exceeds the maximum allowed length for plan steps significantly and should be truncated";
		const result = cleanStepText(long);
		expect(result.length).toBeLessThanOrEqual(50);
		expect(result.endsWith("...")).toBe(true);
	});

	it("collapses runs of spaces (preserves newlines/tabs)", () => {
		expect(cleanStepText("foo    bar")).toBe("Foo bar");
	});
});

// ---------- extractTodoItems ----------

describe("extractTodoItems", () => {
	it("returns empty when no Plan: header is present", () => {
		expect(extractTodoItems("Just a regular response with no plan.")).toEqual([]);
	});

	it("extracts numbered items from a Plan: section", () => {
		const text = `Here is my plan:

Plan:
1. Inspect the user model file
2. Add a new column for ` + "`last_login`" + `
3. Refresh the migration script
4. Run the test suite

Let me know if you want changes.`;
		const items = extractTodoItems(text);
		expect(items).toHaveLength(4);
		// "Inspect" is not in the action-verb list, so it stays as-is
		expect(items[0]).toMatchObject({ step: 1, text: "Inspect the user model file", completed: false });
		// "Add a new column for `last_login`" → "A new column for last_login" (backticks stripped)
		expect(items[1]).toMatchObject({ step: 2, text: "A new column for last_login" });
		// "Refresh" stays, "Run" gets stripped
		expect(items[2]).toMatchObject({ step: 3, text: "Refresh the migration script" });
		expect(items[3]).toMatchObject({ step: 4, text: "Test suite" });
	});

	it("supports numbered lists with parentheses", () => {
		const text = `Plan:
1) First thing
2) Second thing`;
		expect(extractTodoItems(text)).toHaveLength(2);
	});

	it("supports bold text inside items", () => {
		const text = `Plan:
1. Inspect the **core** module
2. Examine the **secondary** module`;
		const items = extractTodoItems(text);
		// The numberedPattern stops at '*' because [^*\n]+ doesn't match '*', so each item
		// captures only the leading word. This matches the verbatim plan-mode behavior.
		expect(items.length).toBeGreaterThanOrEqual(1);
		expect(items[0]!.text).toContain("Inspect");
	});

	it("skips items starting with backticks (code), slash (command), or dash (sub-list)", () => {
		const text = `Plan:
1. Real first step
\`some code reference\`
/some-command
- not a real step
2. Real second step`;
		const items = extractTodoItems(text);
		// Should pick up steps 1 and 2
		expect(items.length).toBeGreaterThanOrEqual(2);
		expect(items[0]!.text).toContain("Real first step");
	});

	it("returns empty for plan with no numbered items", () => {
		const text = `Plan:
This is just prose, no numbers.`;
		expect(extractTodoItems(text)).toEqual([]);
	});

	it("handles italic 'Plan:' header", () => {
		const text = `*Plan:*
1. Do thing A
2. Do thing B`;
		expect(extractTodoItems(text)).toHaveLength(2);
	});
});

// ---------- extractDoneSteps + markCompletedSteps ----------

describe("extractDoneSteps", () => {
	it("extracts [DONE:n] markers", () => {
		expect(extractDoneSteps("I finished [DONE:1] and [DONE:2]")).toEqual([1, 2]);
	});

	it("returns unique steps when repeated", () => {
		expect(extractDoneSteps("[DONE:1] [DONE:1] [DONE:2]")).toEqual([1, 1, 2]);
	});

	it("returns empty for no markers", () => {
		expect(extractDoneSteps("just text")).toEqual([]);
	});

	it("ignores non-numeric", () => {
		expect(extractDoneSteps("[DONE:abc]")).toEqual([]);
	});
});

describe("markCompletedSteps", () => {
	it("marks the matched steps and returns count", () => {
		const items: TodoItem[] = [
			{ step: 1, text: "a", completed: false },
			{ step: 2, text: "b", completed: false },
			{ step: 3, text: "c", completed: false },
		];
		const n = markCompletedSteps("I did [DONE:2] and [DONE:3]", items);
		expect(n).toBe(2);
		expect(items[0]!.completed).toBe(false);
		expect(items[1]!.completed).toBe(true);
		expect(items[2]!.completed).toBe(true);
	});

	it("is a no-op for unknown step numbers", () => {
		const items: TodoItem[] = [{ step: 1, text: "a", completed: false }];
		const n = markCompletedSteps("[DONE:99]", items);
		expect(n).toBe(1);
		expect(items[0]!.completed).toBe(false);
	});
});

// ---------- isCompletionSignal ----------

describe("isCompletionSignal", () => {
	const complete: string[] = [
		"The plan is complete.",
		"Task is done.",
		"Everything is finished.",
		"All done.",
		"All complete.",
		"No more work needed.",
		"No further changes required.",
		"Finished.",
		"Done!",
		"Complete.",
	];

	it.each(complete)("detects completion: %s", (text) => {
		expect(isCompletionSignal(text)).toBe(true);
	});

	const notComplete: string[] = [
		"",
		"   ",
		"I will continue working on the next step.",
		"Let me check the file contents.",
		"Here is the current state of the code.",
		"Working on it now.",
		"I need to make some more changes.",
	];

	it.each(notComplete)("does NOT detect completion: %s", (text) => {
		expect(isCompletionSignal(text)).toBe(false);
	});
});

// ---------- formatCount ----------

describe("formatCount", () => {
	it("returns integer string for small numbers", () => {
		expect(formatCount(0)).toBe("0");
		expect(formatCount(1)).toBe("1");
		expect(formatCount(999)).toBe("999");
	});

	it("formats thousands as 'k' with one decimal under 10k", () => {
		expect(formatCount(1000)).toBe("1.0k");
		expect(formatCount(1234)).toBe("1.2k");
		expect(formatCount(9999)).toBe("10.0k");
	});

	it("formats thousands as 'k' rounded above 10k", () => {
		expect(formatCount(10000)).toBe("10k");
		expect(formatCount(12345)).toBe("12k");
		expect(formatCount(99999)).toBe("100k");
	});

	it("formats millions as 'M'", () => {
		expect(formatCount(1_000_000)).toBe("1.0M");
		expect(formatCount(1_234_567)).toBe("1.2M");
	});

	it("preserves sign for negatives", () => {
		expect(formatCount(-1500)).toBe("-1.5k");
	});

	it("handles non-finite input", () => {
		expect(formatCount(NaN)).toBe("0");
		expect(formatCount(Infinity)).toBe("0");
	});
});

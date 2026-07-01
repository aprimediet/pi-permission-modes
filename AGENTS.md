# AGENTS.md — Coding Conventions

## Language & Style
- **Language**: Indonesian informal (gaul/santai).
- Keep responses concise. No filler.

## Code Style
- **Language**: TypeScript, ESM (`"type": "module"`).
- **Lint**: no external linter; follow TS conventions manually.
- **Naming**: camelCase for functions/variables, PascalCase for types/classes, UPPER_SNAKE for constants.
- **Imports**: top-level, sorted alphabetically.

## Testing
- **Framework**: Vitest (`npm test`).
- **Config**: `vitest.config.ts` — `globals: true`, `environment: "node"`.
- **File pattern**: `*.test.ts` alongside source.
- **Rule**: no shared mutable state across test cases — reset in `beforeEach`.
- **Rule**: fs-dependent helpers can't be unit-tested with fake paths; use real tmpdir fixtures.

## Git
- **Default branch**: `master`.
- **Commit style**: conventional commits (subject ≤50 chars, body only when "why" isn't obvious).
- **Git hooks**: none configured.

## Project Structure
```
extensions/permission-modes/
├── index.ts          # entry point
├── utils.ts          # utility functions
├── profiles.ts       # model-profiles config resolvers
├── package.json      # ESM, vitest
├── vitest.config.ts  # test config
├── *.test.ts         # tests
└── docs/             # docs (prompts/, etc.)
```

## Package Publishing
- **Scope**: `@aprimediet/permission-modes`.
- **Token**: env var `NPM_TOKEN` (not `npm login`).
- **Pattern**: `npm publish --userconfig /tmp/<name>-npm-config` (no `<(...)` process substitution).
- **Auth**: set `_authToken` + `registry` in the temp userconfig file.
- **Warning**: do NOT add `always-auth=true` — deprecated.
- **Lag**: `npm view` may 404 for 2-5s post-publish; retry, don't assume failure.

## Mode Cycle
- Three modes: `default` → `plan` → `auto` → `default` (Shift+Tab).
- `default`: prompt before edits/bash.
- `plan`: read-only, produce numbered `Plan:` block.
- `auto`: auto-approve everything, follow-up until cap (default 20).

## Safety
- Headless mode (`ctx.hasUI === false`): block tool calls with reason, never silently allow.
- Auto mode is intentionally permissive — design choice, not a bug.

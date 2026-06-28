# Changelog

## [1.1.0] - 2026-06-28

### Added
- **3-mode redesign**: Replaced the old 4-mode system (default/plan/accept-edits/auto) with ask/plan/auto. `accept-edits` removed; `default` renamed to `ask` (backwards-compatible via `/default` alias).
- **Outside-cwd read guarding**: In ask mode, reads outside the project root now prompt for approval (matching Claude Code behavior).
- **Project-root detection**: New `findProjectRoot()` / `isInsideProject()` helpers to detect project boundaries (`.git`, `package.json`, etc.), used to relax outside-cwd prompting in auto mode when inside the project.
- **Test suite**: Initial test infrastructure with vitest — 9 utils test groups + 15 integration tests covering modes, shortcuts, commands, and edge cases.
- **Prompt documentation**: Mode-specific prompt context extracted to `docs/prompts/` (ask-mode-prompts.md, plan-mode-prompts.md, auto-mode-prompts.md).
- **Suggestions**: `docs/suggestions.md` capturing v1.2/v2.0 feature ideas.
- **Package metadata**: Added `license`, `repository`, `bugs`, `homepage`, `publishConfig` (public access), and `devDependencies` (vitest).
- **Scripts**: Added `test`, `test:watch`, `prepublishOnly`, `pack:dry` npm scripts.
- **LICENSE file**: Added MIT license.

### Changed
- **README.md**: Updated mode table, command reference, and cycle order for the new 3-mode system.
- **utils.ts**: Refactored bash allowlist and Plan: extraction helpers. Added `[DONE:n]` tracking support.
- **index.ts**: Major refactor — switched from 4-mode to 3-mode cycle, updated footer/prompt context injection, added outside-cwd guard logic.
- **"files" field**: Broadened from explicit file list to `*.ts` glob so new source files are included automatically.

### Removed
- **accept-edits mode**: Removed entirely. Equivalent behavior now provided by auto mode.
- **Inline prompt text**: Prompt content moved to separate files under `docs/prompts/` (external references).
- **Default mode**: Renamed to `ask` (with backward-compatible alias).

### Notes
- Auto-mode follow-up (auto-continue after each turn) is implemented but currently commented out — will be re-enabled when pi's auto-continue support stabilizes.
- v2.0.0 was never published; this release supersedes it as v1.1.0.

[1.1.0]: https://github.com/aprimediet/pi-permission-modes/compare/v1.0.0...v1.1.0

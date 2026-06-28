# Changelog

## [1.1.2] - 2026-06-28

### Added
- **`Alt+I` shortcut**: Cycles through model profiles defined in `~/.pi/agent/model-profiles.json`. Each press advances to the next profile (wrapping around) and re-applies the model mapping for the current mode, so the footer + status pill update immediately. Mirrors `Shift+Tab`'s cycle-by-one behavior for profiles.
- **Integration tests** — 7 new tests in `index.test.ts` for the `Alt+I` shortcut: registration, single-step advance, wrap-around from the last profile, default-profile starting point, empty-config warning, model re-application after cycling, and the "Profile activated" notification.

### Fixed
- **`applyProfileModelForMode` ignored in-memory profile switches**: `resolveModelForMode()` reads `config.active` to determine which profile to use, but `setActiveProfile()` only updated the in-memory `activeProfile` variable. After `/model-profile <name>` or `Alt+I` the wrong profile's model was applied on subsequent mode changes. Now the reload step re-stamps `active` with the in-memory `activeProfile` so profile switches always take effect. The on-disk file is NOT modified.

### Changed
- **`index.ts`**: Added `cycleProfile()` helper and `pi.registerShortcut("alt+i", ...)` registration. Hardened `applyProfileModelForMode()` to honor in-memory profile switches when reloading the config.
- **`index.test.ts`**: Fake pi stub now captures registered shortcuts in a `Map<string, Handler>` and exposes `simulateShortcut(key, ctx)` for direct invocation. (Previously a no-op stub.)
- **`package.json`**: Version bumped to `1.1.2`.
- **`README.md`**: Added `Alt+I` row to the commands/shortcuts table.

### Notes
- Total tests: **112 passing** (42 utils + 31 profiles + 39 index integration).
- `Alt+I` is a new binding — it doesn't override any built-in pi shortcut (verified against `docs/keybindings.md`).

[1.1.2]: https://github.com/aprimediet/pi-permission-modes/compare/v1.1.1...v1.1.2

## [1.1.1] - 2026-06-28

### Added
- **Per-mode model profiles**: Named profiles in `~/.pi/agent/model-profiles.json` mapping each mode (`ask` / `plan` / `auto`) to a model ID (`"provider/model"` or `"provider/model:thinking"`). When the mode changes, the extension auto-switches the model via `pi.setModel()`.
- **`/model-profile` command**: Selector (no args), direct set (`/model-profile <name>`), and list (`/model-profile list`) subcommands.
- **`--model-profile <name>` flag**: Activates a named profile on session start.
- **Thinking-level suffix**: A `":thinking"` suffix in a profile value (e.g. `"anthropic/claude-sonnet-4-5:high"`) sets the thinking level after the model switch.
- **Footer augmentation**: When a profile is active, the footer shows `profile:<name> · model/thinking` instead of plain `model/thinking`.
- **Auto-creation on missing config**: `ensureModelProfilesConfig()` is called on every `session_start` / `/reload`; if the config file is missing it's created (with the user's default model detected from `~/.pi/agent/settings.json` when available). Permissions are `0600` (user read/write only).
- **`profiles.ts`** — new pure-helper module: `loadModelProfiles`, `resolveModelForMode`, `getActiveProfileName`, `listProfiles`, `profileExists`, `parseModelId`, `ensureModelProfilesConfig`, plus mutable `setModelsPath()` for test isolation.
- **`profiles.test.ts`** — 31 new unit tests covering `parseModelId`, `resolveModelForMode`, `getActiveProfileName`, `listProfiles`, `profileExists`, `loadModelProfiles` (with tmpfile fixture), and `ensureModelProfilesConfig`.
- **Integration tests** — 9 new tests in `index.test.ts` covering: model switch on mode change, model switch on session start with `--model-profile` flag, missing-registry warning, no-API-key warning, persistence of `activeProfile`, session restore, `/model-profile list` output, `/model-profile <unknown>` notification, `/model-profile` selector.

### Changed
- **`index.ts`**: `setMode()` is now `async` and calls `applyProfileModelForMode()` after the mode change. `persistState()` now also persists `activeProfile`. `onSessionStart()` calls `ensureModelProfilesConfig()` at the top, validates `--model-profile`, restores `activeProfile` from the persisted entry, and re-applies the model at the end. `installFooter()` prepends `profile:<name> · ` to the right-side model string when a profile is active.
- **`package.json`**: Version bumped to `1.1.1`; description updated to mention per-mode model profiles.
- **`README.md`**: Added Model profiles section with example config; updated commands table with `/model-profile` and `--model-profile`; updated footer description.
- **`docs/PRD.md`**: Added per-mode model profiles as a feature; removed "Switching the AI model per mode" from non-goals (now replaced by an explicit opt-in clause); bumped version to 2.1.
- **`docs/suggestions.md`**: Added reference to `v1.1.1-suggestions.md`.
- **`AGENTS.md`**: Added `/model-profile` commands and `--model-profile` flag; updated `currentFocus` to v1.1.1; updated boundaries to clarify model-switching is opt-in via user-defined profile.

### Notes
- The model profile config file is named `model-profiles.json` (NOT `models.json`) to avoid conflict with pi's built-in `~/.pi/agent/models.json` (which is used for custom provider definitions).
- Total tests: **105 passing** (42 utils + 31 profiles + 32 index integration).

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

[1.1.1]: https://github.com/aprimediet/pi-permission-modes/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/aprimediet/pi-permission-modes/compare/v1.0.0...v1.1.0

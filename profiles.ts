/**
 * Pure helpers for the model-profile config.
 *
 * Profiles map each mode (ask / plan / auto) to a model ID — either
 * `"provider/model"` or `"provider/model:thinking"` (with an optional
 * `:thinking` suffix that sets the thinking level after the switch).
 *
 * The config file lives at `~/.pi/agent/model-profiles.json` — a deliberately
 * distinct name from pi's own `models.json` (which is used for custom
 * provider definitions) to avoid format conflict.
 *
 * No pi dependency. All functions are pure (or fs-only with graceful
 * fallback) so they can be unit-tested without mocking the agent runtime.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** One named profile mapping modes to model IDs. */
export interface ModelProfile {
	ask?: string
	plan?: string
	auto?: string
}

/** Full config file shape: an `active` pointer plus any number of named profiles. */
export interface ModelProfilesConfig {
	active?: string
	[key: string]: ModelProfile | string | undefined
}

/** Default = real homedir path. Exposed via getter/setter so tests can
 *  redirect to a tmpdir fixture without breaking the ESM read-only-export
 *  contract (you can't assign to an imported `let` binding). */
let _modelsPath: string = join(
	homedir(),
	".pi",
	"agent",
	"model-profiles.json",
)

export function getModelsPath(): string {
	return _modelsPath
}

export function setModelsPath(p: string): void {
	_modelsPath = p
}

/** Convenience read-only re-export for code that just wants the path. */
export const modelsPath: string = _modelsPath

/**
 * Parse `"provider/model"` or `"provider/model:thinking"` into components.
 * Returns `{ provider, model, thinkingLevel }` or `null` if the input has no
 * slash (no provider), or is empty.
 *
 * A trailing `:` (e.g. `"opencode/big-pickle:"`) is treated as "no thinking
 * suffix" — `thinkingLevel` is omitted in the returned object.
 */
export function parseModelId(
	raw: string,
): { provider: string; model: string; thinkingLevel?: string } | null {
	if (!raw) return null
	const colonIdx = raw.indexOf(":")
	const providerAndModel =
		colonIdx === -1 ? raw : raw.slice(0, colonIdx)
	const thinkingLevel =
		colonIdx === -1 ? undefined : raw.slice(colonIdx + 1) || undefined
	const slashIdx = providerAndModel.indexOf("/")
	if (slashIdx <= 0) return null
	const provider = providerAndModel.slice(0, slashIdx)
	const model = providerAndModel.slice(slashIdx + 1)
	if (!provider || !model) return null
	return thinkingLevel === undefined
		? { provider, model }
		: { provider, model, thinkingLevel }
}

/** Internal: read+parse the config file. Returns {} on any failure. */
function readConfigFromDisk(): ModelProfilesConfig {
	try {
		if (!existsSync(_modelsPath)) return {}
		const raw = readFileSync(_modelsPath, "utf-8")
		if (!raw.trim()) return {}
		return JSON.parse(raw) as ModelProfilesConfig
	} catch (err) {
		console.warn(
			`[permission-modes] Failed to load ${_modelsPath}:`,
			err,
		)
		return {}
	}
}

/**
 * Load and parse the model profiles config file. Returns an empty object if
 * the file doesn't exist or is malformed. Never throws.
 */
export function loadModelProfiles(): ModelProfilesConfig {
	return readConfigFromDisk()
}

/**
 * Ensure the model profiles config file exists. If missing, creates it with
 * defaults — pre-filled with the user's default model from
 * `~/.pi/agent/settings.json` (`defaultProvider` / `defaultModel`) if
 * available.
 *
 * Called once on session start and on `/reload`. Never throws — failures are
 * logged and the in-memory defaults are returned.
 */
export function ensureModelProfilesConfig(): ModelProfilesConfig {
	if (existsSync(_modelsPath)) return readConfigFromDisk()

	// Try to detect default model from pi settings
	let defaultModelId = ""
	try {
		const settingsPath = join(homedir(), ".pi", "agent", "settings.json")
		if (existsSync(settingsPath)) {
			const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
			const provider = settings.defaultProvider || ""
			const model = settings.defaultModel || ""
			if (provider && model) defaultModelId = `${provider}/${model}`
		}
	} catch {
		/* ignore — fall back to empty strings */
	}

	const defaults: ModelProfilesConfig = {
		active: "default",
		default: {
			ask: defaultModelId,
			plan: defaultModelId,
			auto: defaultModelId,
		},
	}

	try {
		mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true })
		writeFileSync(_modelsPath, JSON.stringify(defaults, null, 2) + "\n", {
			mode: 0o600,
		})
		console.log(`[permission-modes] Created ${_modelsPath} with defaults`)
	} catch (err) {
		console.warn(
			`[permission-modes] Failed to create ${_modelsPath}:`,
			err,
		)
	}

	return defaults
}

/**
 * Resolve the model ID string for a given mode from the active profile.
 * Falls back to the `default` profile when the active one doesn't define
 * that mode. Returns `undefined` when nothing matches.
 */
export function resolveModelForMode(
	config: ModelProfilesConfig,
	mode: "ask" | "plan" | "auto",
): string | undefined {
	const profileName = config.active || "default"
	const profile = config[profileName] as ModelProfile | undefined
	const def = config["default"] as ModelProfile | undefined
	if (profile && typeof profile[mode] === "string") return profile[mode]
	if (def && typeof def[mode] === "string") return def[mode]
	return undefined
}

/**
 * Get the active profile name, defaulting to `"default"`.
 */
export function getActiveProfileName(config: ModelProfilesConfig): string {
	return config.active || "default"
}

/**
 * List all profile names (keys whose value is an object, excluding `active`).
 */
export function listProfiles(config: ModelProfilesConfig): string[] {
	return Object.keys(config).filter(
		(k) => k !== "active" && typeof config[k] === "object",
	)
}

/**
 * Check whether a profile with the given name exists (i.e. is an object entry
 * in the config). `active` is treated as a string pointer, not a profile.
 */
export function profileExists(
	config: ModelProfilesConfig,
	name: string,
): boolean {
	return typeof config[name] === "object" && config[name] !== null
}
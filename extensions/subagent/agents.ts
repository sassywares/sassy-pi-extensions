/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	/** Selectable profiles from frontmatter. Empty or absent means the agent is pinned or inherits. */
	profiles?: AgentProfile[];
	/** Set when the file's frontmatter is unusable. Dispatch fails with this message. */
	error?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

/** A named model choice an agent offers to the profile selector. */
export interface AgentProfile {
	name: string;
	model: string;
	thinking?: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

/** Used when neither the tool call, the environment, nor settings select a profile. */
export const DEFAULT_PROFILE = "deepseek";
/** Environment override, useful for CI and one-off shells. */
export const PROFILE_ENV = "PI_SASSY_PROFILE";

export type ProfileSource = "parameter" | "env" | "settings" | "default";

export interface ProfileSelection {
	name: string;
	source: ProfileSource;
}

/** What a dispatch inherits when an agent pins nothing. */
export interface ModelDefaults {
	model?: string;
	thinkingLevel?: string;
	profile?: ProfileSelection;
}

export interface ResolvedModel {
	model?: string;
	thinking?: string;
	profile?: string;
	error?: string;
}

/** Read `sassy.profile` from the effective (user and project merged) settings. */
export function readSettingsProfile(settings: unknown): string | undefined {
	const sassy = (settings as { sassy?: { profile?: unknown } } | undefined)?.sassy;
	const value = sassy?.profile;
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

/**
 * Resolve the profile name for a dispatch.
 *
 * Precedence: the tool call's `profile` parameter, then PI_SASSY_PROFILE, then
 * `sassy.profile` from settings (project overrides user because pi merges them
 * before we see them), then DEFAULT_PROFILE.
 */
export function resolveProfileSelection(
	explicit: string | undefined,
	settings: unknown,
	env: Record<string, string | undefined> = process.env,
): ProfileSelection {
	const fromParameter = explicit?.trim();
	if (fromParameter) return { name: fromParameter, source: "parameter" };

	const fromEnv = env[PROFILE_ENV]?.trim();
	if (fromEnv) return { name: fromEnv, source: "env" };

	const fromSettings = readSettingsProfile(settings);
	if (fromSettings) return { name: fromSettings, source: "settings" };

	return { name: DEFAULT_PROFILE, source: "default" };
}

/**
 * Turn an agent plus a profile selection into the model and thinking a child
 * process should run. Three agent shapes are supported:
 *
 *   profiles: [...]  switchable; the selected profile must exist
 *   model: <id>      pinned; ignores profile selection entirely
 *   neither          inherits the dispatcher's model and thinking
 *
 * A missing profile is an error rather than a fallback: a project that asks for
 * a provider must never silently run the default one.
 */
export function resolveAgentModel(
	agent: AgentConfig,
	selection: ProfileSelection,
	defaults: ModelDefaults,
): ResolvedModel {
	if (agent.error) return { error: `Agent "${agent.name}" is unusable: ${agent.error} (${agent.filePath})` };

	if (agent.profiles && agent.profiles.length > 0) {
		const profile = agent.profiles.find((p) => p.name === selection.name);
		if (!profile) {
			const names = agent.profiles.map((p) => p.name).join(", ");
			return {
				error: `Agent "${agent.name}" has no "${selection.name}" profile (from ${selection.source}). Available profiles: ${names}.`,
			};
		}
		return { model: profile.model, thinking: profile.thinking ?? agent.thinking, profile: profile.name };
	}

	if (agent.model) return { model: agent.model, thinking: agent.thinking };

	return { model: defaults.model, thinking: defaults.thinkingLevel, profile: defaults.profile?.name };
}

/** Apply a per-task profile override on top of the dispatch defaults. */
export function withProfile(defaults: ModelDefaults, name: string | undefined): ModelDefaults {
	const trimmed = name?.trim();
	if (!trimmed) return defaults;
	return { ...defaults, profile: { name: trimmed, source: "parameter" } };
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
	thinking?: unknown;
	profiles?: unknown;
};

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const PROFILE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Parse an agent's `profiles` list.
 *
 * The shape is a flat list of maps, so a mis-indented entry is reported as a
 * missing field instead of silently parsing as a nested key:
 *
 *     profiles:
 *       - name: deepseek
 *         model: deepseek/deepseek-flash
 *         thinking: low
 *
 * Returns an `error` rather than throwing: discovery must keep walking the
 * directory, and the error is reported when that agent is dispatched.
 */
function parseProfiles(value: unknown): { profiles?: AgentProfile[]; error?: string } {
	if (value === undefined || value === null) return {};
	if (!Array.isArray(value)) return { error: '"profiles" must be a list of { name, model, thinking } maps' };
	if (value.length === 0) return { error: '"profiles" is empty' };

	const profiles: AgentProfile[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < value.length; i++) {
		const entry = value[i];
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return { error: `profiles[${i}] must be a map with name, model, and optional thinking` };
		}
		const raw = entry as Record<string, unknown>;
		const unknownKey = Object.keys(raw).find((k) => k !== "name" && k !== "model" && k !== "thinking");
		if (unknownKey) return { error: `profiles[${i}] has unknown key "${unknownKey}"` };

		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		if (!name) return { error: `profiles[${i}] has no name` };
		if (!PROFILE_NAME_PATTERN.test(name)) {
			return { error: `profiles[${i}] name "${name}" must be lowercase letters, digits, and dashes` };
		}
		if (seen.has(name)) return { error: `profiles[${i}] repeats profile "${name}"` };
		seen.add(name);

		const model = typeof raw.model === "string" ? raw.model.trim() : "";
		if (!model) return { error: `profiles[${i}] ("${name}") has no model` };
		if (!model.includes("/")) {
			return { error: `profiles[${i}] ("${name}") model "${model}" must be provider/id` };
		}

		let thinking: string | undefined;
		if (raw.thinking !== undefined) {
			const level = typeof raw.thinking === "string" ? raw.thinking.trim() : "";
			if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
				return {
					error: `profiles[${i}] ("${name}") thinking must be one of ${THINKING_LEVELS.join(", ")}`,
				};
			}
			thinking = level;
		}

		profiles.push({ name, model, thinking });
	}

	return { profiles };
}

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		const { profiles, error: profilesError } = parseProfiles(frontmatter.profiles);
		const pinnedModel = typeof frontmatter.model === "string" ? frontmatter.model.trim() : "";
		let error = profilesError;
		if (!error && profiles && pinnedModel) {
			error = 'use either "profiles" or "model", not both';
		}

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: error ? undefined : pinnedModel || undefined,
			thinking:
				error || typeof frontmatter.thinking !== "string" ? undefined : frontmatter.thinking.trim() || undefined,
			profiles: error ? undefined : profiles,
			error,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed
			.map((a) => {
				const profiles = a.profiles?.length ? ` [profiles: ${a.profiles.map((p) => p.name).join(", ")}]` : "";
				return `${a.name} (${a.source}): ${a.description}${profiles}`;
			})
			.join("; "),
		remaining,
	};
}

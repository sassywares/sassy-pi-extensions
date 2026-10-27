#!/usr/bin/env node
/**
 * Checks agent discovery and profile resolution without running a subagent.
 *
 * The subagent extension is loaded from a pi install, so peer packages are not
 * present in this repo. This script makes a temporary project, links the pi
 * install's node_modules into it, copies agents.ts there, and exercises the
 * parsers. Real agents from agents/ are copied in alongside fixtures for the
 * shapes that must fail.
 *
 *   ./scripts/test-profiles.mjs
 *   PI_PEER_MODULES=/path/to/node_modules ./scripts/test-profiles.mjs
 *
 * Exits non-zero on the first failing check group.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findPeerModules() {
	const configured = process.env.PI_PEER_MODULES?.trim();
	if (configured) return configured;

	// Follow the `pi` binary on PATH to its package, then up to node_modules.
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, "pi");
		try {
			const real = fs.realpathSync(candidate);
			const index = real.lastIndexOf(`${path.sep}node_modules${path.sep}`);
			if (index !== -1) return real.slice(0, index + `${path.sep}node_modules`.length);
		} catch {
			// Not here; keep looking.
		}
	}

	const managed = managedInstallModules();
	if (managed) return managed;

	throw new Error("Could not find the pi install. Set PI_PEER_MODULES to its node_modules directory.");
}

/** Fall back to the managed install layout: <agent dir>/install/releases/<version>/node_modules. */
function managedInstallModules() {
	const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi/agent");
	try {
		const version = fs.readFileSync(path.join(agentDir, "install/current-version"), "utf-8").trim();
		if (!version) return undefined;
		const modules = path.join(agentDir, "install/releases", version, "node_modules");
		return fs.existsSync(path.join(modules, "@earendil-works/pi-coding-agent")) ? modules : undefined;
	} catch {
		return undefined;
	}
}

const peers = findPeerModules();
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sassy-profiles-"));

function cleanups() {
	const nodeModules = path.join(workspace, "node_modules");
	fs.mkdirSync(nodeModules, { recursive: true });
	for (const pkg of ["@earendil-works", "typebox"]) {
		fs.symlinkSync(path.join(peers, pkg), path.join(nodeModules, pkg));
	}
}

cleanups();
fs.copyFileSync(path.join(REPO, "extensions/subagent/agents.ts"), path.join(workspace, "agents.ts"));

const agents = await import(pathToFileURL(path.join(workspace, "agents.ts")).href);

let failures = 0;

function check(name, fn) {
	try {
		fn();
		console.log(`ok   ${name}`);
	} catch (error) {
		failures++;
		console.log(`FAIL ${name}: ${error.message}`);
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const agentDir = path.join(workspace, ".pi/agents");
fs.mkdirSync(agentDir, { recursive: true });

for (const file of fs.readdirSync(path.join(REPO, "agents"))) {
	if (file.endsWith(".md")) fs.copyFileSync(path.join(REPO, "agents", file), path.join(agentDir, file));
}

function fixture(name, frontmatter) {
	fs.writeFileSync(path.join(agentDir, `${name}.md`), `---\n${frontmatter}\n---\n\nbody\n`);
}

fixture("pinned", "name: pinned\ndescription: pinned single model\nmodel: openai/gpt-4o\nthinking: low");
fixture("inherit", "name: inherit\ndescription: inherits the dispatcher");
fixture(
	"keyed",
	"name: keyed\ndescription: single-key-map shape\nprofiles:\n  - deepseek:\n      model: deepseek/deepseek-flash",
);
fixture(
	"both",
	"name: both\ndescription: model and profiles\nmodel: openai/gpt-4o\nprofiles:\n  - name: deepseek\n    model: deepseek/deepseek-flash",
);
fixture(
	"badthinking",
	"name: badthinking\ndescription: bad level\nprofiles:\n  - name: deepseek\n    model: deepseek/deepseek-flash\n    thinking: veryhigh",
);
fixture(
	"badmodel",
	"name: badmodel\ndescription: bare model id\nprofiles:\n  - name: deepseek\n    model: deepseek-flash",
);
fixture(
	"dup",
	"name: dup\ndescription: duplicate profiles\nprofiles:\n  - name: deepseek\n    model: deepseek/deepseek-flash\n  - name: deepseek\n    model: anthropic/claude-haiku-4-5",
);

let discovery;
try {
	discovery = agents.discoverAgents(workspace, "project");
} catch (error) {
	console.log(`FAIL discovery threw: ${error.message}`);
	process.exit(1);
}
const byName = new Map(discovery.agents.map((a) => [a.name, a]));

check("every shipped agent parses", () => {
	for (const file of fs.readdirSync(path.join(REPO, "agents"))) {
		if (!file.endsWith(".md")) continue;
		const name = file.replace(/\.md$/, "");
		const agent = byName.get(name);
		assert(agent, `${name} was not discovered`);
		assert(!agent.error, `${name}: ${agent.error}`);
	}
});

check("every shipped agent offers the default profile", () => {
	for (const agent of discovery.agents) {
		if (agent.source !== "project" || agent.error) continue;
		if (!agent.profiles) continue;
		assert(
			agent.profiles.some((p) => p.name === agents.DEFAULT_PROFILE),
			`${agent.name} has no "${agents.DEFAULT_PROFILE}" profile`,
		);
	}
});

check("a profile resolves its model and thinking", () => {
	const resolved = agents.resolveAgentModel(byName.get("reviewer"), { name: "anthropic", source: "settings" }, {});
	assert(resolved.model === "anthropic/claude-opus-4-5", `model ${resolved.model}`);
	assert(resolved.thinking === "high", `thinking ${resolved.thinking}`);
	assert(resolved.profile === "anthropic", `profile ${resolved.profile}`);
});

check("a missing profile is an error naming the alternatives", () => {
	const resolved = agents.resolveAgentModel(byName.get("reviewer"), { name: "openai", source: "settings" }, {});
	assert(resolved.error?.includes('no "openai" profile'), resolved.error);
	assert(resolved.error?.includes("deepseek, anthropic"), resolved.error);
});

check("a pinned agent ignores profile selection", () => {
	const resolved = agents.resolveAgentModel(byName.get("pinned"), { name: "anthropic", source: "settings" }, {});
	assert(resolved.model === "openai/gpt-4o", resolved.model);
	assert(resolved.profile === undefined, `profile ${resolved.profile}`);
});

check("an agent with neither inherits the dispatcher", () => {
	const resolved = agents.resolveAgentModel(byName.get("inherit"), { name: "anthropic", source: "settings" }, {
		model: "anthropic/claude-sonnet-4-5",
		thinkingLevel: "medium",
		profile: { name: "anthropic", source: "settings" },
	});
	assert(resolved.model === "anthropic/claude-sonnet-4-5", resolved.model);
	assert(resolved.thinking === "medium", resolved.thinking);
});

check("selection precedence is parameter, env, settings, default", () => {
	const settings = { sassy: { profile: "from-settings" } };
	const env = { PI_SASSY_PROFILE: "from-env" };
	assert(agents.resolveProfileSelection("from-param", settings, env).source === "parameter");
	assert(agents.resolveProfileSelection(undefined, settings, env).name === "from-env");
	assert(agents.resolveProfileSelection(undefined, settings, {}).name === "from-settings");
	assert(agents.resolveProfileSelection(undefined, {}, {}).name === agents.DEFAULT_PROFILE);
	assert(agents.resolveProfileSelection(undefined, {}, {}).source === "default");
});

check("a blank or non-string setting falls through to the default", () => {
	assert(agents.resolveProfileSelection(undefined, { sassy: { profile: "  " } }, {}).source === "default");
	assert(agents.resolveProfileSelection(undefined, { sassy: { profile: 42 } }, {}).source === "default");
});

check("the single-key-map shape is rejected clearly", () => {
	const agent = byName.get("keyed");
	assert(agent?.error?.includes('unknown key "deepseek"'), agent?.error);
});

check("model plus profiles is rejected", () => {
	assert(byName.get("both")?.error === 'use either "profiles" or "model", not both', byName.get("both")?.error);
});

check("an invalid thinking level is rejected", () => {
	assert(byName.get("badthinking")?.error?.includes("thinking must be one of"), byName.get("badthinking")?.error);
});

check("a bare model id is rejected", () => {
	assert(byName.get("badmodel")?.error?.includes("must be provider/id"), byName.get("badmodel")?.error);
});

check("duplicate profile names are rejected", () => {
	assert(byName.get("dup")?.error === 'profiles[1] repeats profile "deepseek"', byName.get("dup")?.error);
});

check("an unusable agent fails at dispatch instead of inheriting", () => {
	const resolved = agents.resolveAgentModel(byName.get("keyed"), { name: "deepseek", source: "default" }, {});
	assert(resolved.error?.includes("is unusable"), resolved.error);
	assert(resolved.error?.includes("unknown key"), resolved.error);
});

check("a per-task override keeps the other defaults", () => {
	const defaults = { model: "x/y", thinkingLevel: "low", profile: { name: "deepseek", source: "default" } };
	const overridden = agents.withProfile(defaults, "anthropic");
	assert(overridden.profile.name === "anthropic", overridden.profile.name);
	assert(overridden.profile.source === "parameter", overridden.profile.source);
	assert(overridden.model === "x/y", "defaults were lost");
	assert(agents.withProfile(defaults, "  ") === defaults, "a blank override should be a no-op");
});

fs.rmSync(workspace, { recursive: true, force: true });
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

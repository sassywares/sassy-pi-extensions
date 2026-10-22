/**
 * Read-only bash backends for ask mode.
 *
 * A backend rewrites a shell command so that it runs under an OS-level sandbox
 * that denies every filesystem write except /dev and the temp directory. There
 * is deliberately no regex or command-allowlist fallback: a backend either
 * proves that it blocks a write inside the working directory, or ask mode runs
 * without bash at all.
 *
 * When the working directory itself sits inside the temp directory, the temp
 * allowance is dropped instead of the working directory one: the repository is
 * always read-only, at the cost of a read-only temp directory in that case.
 */

import { existsSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLocalBashOperations, type BashOperations } from "@earendil-works/pi-coding-agent";

export type BackendId = "sandbox-exec" | "bwrap";

export interface SandboxBackend {
	/** Short identifier shown in the status bar. */
	id: BackendId;
	/** Rewrite a command so it executes under the read-only sandbox. */
	wrap: (command: string) => string;
}

export interface DetectResult {
	backend?: SandboxBackend;
	/** Why the backend was accepted or rejected. Shown by `/modes`. */
	reason: string;
}

const PROBE_TIMEOUT_SECONDS = 5;
const PROBE_FILE = ".pi-modes-probe";

/** macOS paths that stay writable. `/private/var/folders` is behind `$TMPDIR`. */
const MACOS_WRITE_ALLOW = ["/dev", "/private/tmp", "/private/var/folders"];

/** Linux: bind the whole filesystem read-only, then give back /dev and a scratch /tmp. */
const LINUX_TEMP = "/tmp";

/** POSIX single-quote escaping, so an arbitrary command survives one more shell layer. */
export function shellQuote(value: string): string {
	return `'${value.split("'").join(`'\\''`)}'`;
}

function realPath(value: string): string {
	try {
		return realpathSync(value);
	} catch {
		return value;
	}
}

function isInside(path: string, root: string): boolean {
	const resolvedPath = realPath(path);
	const resolvedRoot = realPath(root);
	const prefix = resolvedRoot.endsWith("/") ? resolvedRoot : `${resolvedRoot}/`;
	return resolvedPath === resolvedRoot || resolvedPath.startsWith(prefix);
}

function macProfile(cwd: string): string {
	const allowed = MACOS_WRITE_ALLOW.filter((root) => !isInside(cwd, root));
	const lines = ["(version 1)", "(allow default)", "(deny file-write*)"];
	if (allowed.length > 0) {
		lines.push("(allow file-write*");
		allowed.forEach((root, index) => {
			const close = index === allowed.length - 1 ? ")" : "";
			lines.push(`  (subpath "${root}")${close}`);
		});
	}
	return lines.join("\n");
}

function linuxArgs(cwd: string): string[] {
	const args = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"];
	// Do not shadow the working directory with a fresh /tmp.
	if (!isInside(cwd, LINUX_TEMP)) args.push("--tmpfs", LINUX_TEMP);
	args.push("--setenv", "TMPDIR", LINUX_TEMP, "--die-with-parent", "--");
	return args;
}

function createBackend(id: BackendId, cwd: string): SandboxBackend {
	if (id === "sandbox-exec") {
		const profile = shellQuote(macProfile(cwd));
		return {
			id,
			wrap: (command) => `sandbox-exec -p ${profile} /bin/bash -c ${shellQuote(command)}`,
		};
	}

	const prefix = linuxArgs(cwd).map(shellQuote).join(" ");
	return {
		id,
		wrap: (command) => `${prefix} /bin/bash -c ${shellQuote(command)}`,
	};
}

/**
 * Run a command through a backend using pi's own shell configuration, so the
 * probe exercises exactly the execution path ask mode will use.
 */
export async function runIn(
	backend: SandboxBackend,
	command: string,
	cwd: string,
	timeoutSeconds = PROBE_TIMEOUT_SECONDS,
): Promise<{ output: string; exitCode: number | null }> {
	const operations = createLocalBashOperations();
	let output = "";
	try {
		const { exitCode } = await operations.exec(backend.wrap(command), cwd, {
			onData: (chunk) => {
				output += chunk.toString();
			},
			timeout: timeoutSeconds,
		});
		return { output, exitCode };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { output: `${output}${message}`, exitCode: null };
	}
}

/**
 * Backend operations for `!command` input, which bypasses the `bash` tool and
 * therefore the `tool_call` handler.
 */
export function createWrappedOperations(backend: SandboxBackend): BashOperations {
	const local = createLocalBashOperations();
	return {
		exec: (command, cwd, options) => local.exec(backend.wrap(command), cwd, options),
	};
}

/**
 * Prove both halves of the contract before trusting a backend: reads must
 * succeed, and a write inside the working directory must fail. A backend that
 * "exists" but cannot enforce (for example bubblewrap on a distribution that
 * blocks unprivileged user namespaces) fails here.
 *
 * Temp-directory writability is reported but not required, because the working
 * directory always wins.
 */
async function verify(backend: SandboxBackend, cwd: string): Promise<{ ok: boolean; reason: string }> {
	const read = await runIn(backend, `printf pi-modes-ok && ls ${shellQuote(cwd)} > /dev/null`, cwd);
	if (read.exitCode !== 0 || !read.output.includes("pi-modes-ok")) {
		return { ok: false, reason: `${backend.id}: reads do not work (${firstLine(read.output) || `exit ${read.exitCode}`})` };
	}

	const probePath = join(cwd, PROBE_FILE);
	const wrote = await runIn(backend, `printf x > ${shellQuote(probePath)}`, cwd);
	if (wrote.exitCode === 0) {
		if (existsSync(probePath)) {
			try {
				unlinkSync(probePath);
			} catch {
				// Best effort: the probe already failed, do not mask the real reason.
			}
		}
		return { ok: false, reason: `${backend.id}: write inside the working directory was allowed` };
	}

	const tmpProbe = '"${TMPDIR:-/tmp}/pi-modes-probe-$$"';
	const tmp = await runIn(backend, `printf x > ${tmpProbe} && printf tmp-ok && rm -f ${tmpProbe}`, cwd);
	const tmpWritable = tmp.exitCode === 0 && tmp.output.includes("tmp-ok");

	const detail = tmpWritable ? "reads work, writes are denied" : "reads work, writes are denied, temp dir is read-only";
	return { ok: true, reason: `${backend.id}: ${detail}` };
}

function firstLine(value: string): string {
	return (value.split("\n").find((line) => line.trim().length > 0) ?? "").trim();
}

/**
 * Pick a backend for this platform and verify it. `PI_MODES_BASH=off` skips
 * detection entirely, which leaves ask mode with no bash.
 */
export async function detectBackend(cwd: string): Promise<DetectResult> {
	if ((process.env.PI_MODES_BASH ?? "auto").toLowerCase() === "off") {
		return { reason: "bash disabled by PI_MODES_BASH=off" };
	}

	const candidates: BackendId[] =
		process.platform === "darwin" ? ["sandbox-exec"] : process.platform === "linux" ? ["bwrap"] : [];
	if (candidates.length === 0) {
		return { reason: `no read-only bash backend for ${process.platform}` };
	}

	const failures: string[] = [];
	for (const id of candidates) {
		const backend = createBackend(id, cwd);
		const verdict = await verify(backend, cwd);
		if (verdict.ok) return { backend, reason: verdict.reason };
		failures.push(verdict.reason);
	}

	return { reason: failures.join("; ") };
}

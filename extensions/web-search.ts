/**
 * Web Search + Fetch Tools
 *
 * Zero-config web search using Exa's public MCP endpoint, plus a basic
 * HTML/text page fetcher with local-address protection.
 * Optionally set EXA_API_KEY to use the direct Exa API instead.
 *
 * Load with: pi -e ~/.pi/agent/extensions/web-search.ts
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_API_URL = "https://api.exa.ai/search";
const REQUEST_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SNIPPET_CHARS = 400;
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const DEFAULT_FETCH_CHARS = 12_000;
const MAX_FETCH_CHARS = 50_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface SearchDetails {
	query: string;
	provider: "exa-mcp" | "exa-api";
	count: number;
	results: SearchResult[];
}

const webSearchParams = Type.Object({
	query: Type.String({
		description: "The search query. Be specific; include keywords and context.",
	}),
	numResults: Type.Optional(
		Type.Integer({
			description: "Number of results to return (1-10, default 5).",
			minimum: 1,
			maximum: 10,
			default: 5,
		}),
	),
});

function requestSignal(signal?: AbortSignal): AbortSignal {
	return signal
		? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal])
		: AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function snippet(value: string): string {
	const text = normalizeWhitespace(value);
	return text.length > MAX_SNIPPET_CHARS
		? `${text.slice(0, MAX_SNIPPET_CHARS - 1)}…`
		: text;
}

function parseMcpResults(text: string): SearchResult[] {
	const blocks = text.split(/(?=^Title: )/m).filter((block) => block.trim());
	const results: SearchResult[] = [];

	for (const block of blocks) {
		const title = block.match(/^Title: (.+)$/m)?.[1]?.trim() ?? "";
		const url = block.match(/^URL: (.+)$/m)?.[1]?.trim() ?? "";
		if (!url) continue;

		let body = "";
		const textStart = block.indexOf("\nText: ");
		if (textStart >= 0) {
			body = block.slice(textStart + "\nText: ".length);
		} else {
			const highlights = block.match(/\nHighlights:\s*\n/);
			if (highlights?.index != null) {
				body = block.slice(highlights.index + highlights[0].length);
			}
		}

		results.push({
			title: title || url,
			url,
			snippet: snippet(body.replace(/\n---\s*$/, "")),
		});
	}

	return results;
}

function parseMcpResponse(body: string): unknown {
	// Exa's MCP endpoint may answer with plain JSON or an SSE stream.
	const dataLines = body
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter(Boolean);

	for (const line of dataLines) {
		try {
			return JSON.parse(line);
		} catch {
			// Try the next data line.
		}
	}

	try {
		return JSON.parse(body);
	} catch {
		throw new Error(`Exa returned an unreadable response: ${body.slice(0, 300)}`);
	}
}

async function searchWithExaMcp(
	query: string,
	numResults: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const response = await fetch(`${EXA_MCP_URL}?tools=web_search_exa`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"x-exa-source": "pi-web-search-extension",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: { query, numResults },
			},
		}),
		signal: requestSignal(signal),
	});

	if (!response.ok) {
		const text = await response.text();
		if (response.status === 429) {
			throw new Error(
				"Exa MCP rate limit reached. Try again later, or set EXA_API_KEY to use the direct Exa API.",
			);
		}
		throw new Error(`Exa MCP error ${response.status}: ${text.slice(0, 300)}`);
	}

	const payload = parseMcpResponse(await response.text()) as {
		result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
		error?: { message?: string };
	};

	if (payload.error) {
		throw new Error(`Exa MCP error: ${payload.error.message ?? "unknown error"}`);
	}
	if (payload.result?.isError) {
		const message = payload.result.content?.find((item) => item.type === "text")?.text;
		throw new Error(`Exa MCP error: ${message ?? "search failed"}`);
	}

	const text = payload.result?.content?.find(
		(item) => item.type === "text" && item.text?.trim(),
	)?.text;

	if (!text) {
		throw new Error("Exa MCP returned no content");
	}

	return parseMcpResults(text).slice(0, numResults);
}

async function searchWithExaApi(
	query: string,
	numResults: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const response = await fetch(EXA_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify({
			query,
			numResults,
			type: "auto",
			contents: { text: { maxCharacters: MAX_SNIPPET_CHARS } },
		}),
		signal: requestSignal(signal),
	});

	if (!response.ok) {
		const text = await response.text();
		if (response.status === 429) {
			throw new Error("Exa API rate limit reached. Try again later.");
		}
		throw new Error(`Exa API error ${response.status}: ${text.slice(0, 300)}`);
	}

	const payload = (await response.json()) as {
		results?: Array<{ title?: string; url?: string; text?: string }>;
	};

	return (payload.results ?? [])
		.filter((result) => typeof result.url === "string" && result.url.length > 0)
		.slice(0, numResults)
		.map((result) => ({
			title: result.title || result.url!,
			url: result.url!,
			snippet: snippet(result.text ?? ""),
		}));
}

interface FetchDetails {
	url: string;
	finalUrl: string;
	title?: string;
	contentType: string;
	truncated: boolean;
	totalChars: number;
	returnedChars: number;
}

function formatResults(query: string, results: SearchResult[]): string {
	if (results.length === 0) {
		return `No web search results found for: ${query}`;
	}

	const lines = [`Web search results for: ${query}`, ""];
	results.forEach((result, index) => {
		lines.push(`${index + 1}. ${result.title}`);
		lines.push(`   ${result.url}`);
		if (result.snippet) lines.push(`   ${result.snippet}`);
		lines.push("");
	});
	return lines.join("\n").trim();
}

function isPrivateIp(ip: string): boolean {
	const version = isIP(ip);
	if (version === 4) {
		const parts = ip.split(".").map(Number);
		if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
			return true;
		}
		const [a, b] = parts;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 0) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			(a === 198 && b === 51) ||
			(a === 203 && b === 0) ||
			a >= 224
		);
	}

	if (version === 6) {
		const value = ip.toLowerCase().split("%")[0];
		if (value === "::" || value === "::1") return true;
		if (value.startsWith("::ffff:")) {
			const mapped = value.slice("::ffff:".length);
			return isIP(mapped) === 4 ? isPrivateIp(mapped) : true;
		}
		if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // fc00::/7
		if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // fe80::/10
		if (/^ff[0-9a-f]{2}:/.test(value)) return true; // multicast
		if (value.startsWith("2001:db8:") || value === "2001:db8::") return true; // documentation
		return false;
	}

	return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported URL protocol: ${url.protocol}`);
	}
	if (url.username || url.password) {
		throw new Error("URLs with embedded credentials are not allowed");
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		hostname === "0.0.0.0"
	) {
		throw new Error("Fetching local or private network addresses is blocked");
	}

	if (isIP(hostname)) {
		if (isPrivateIp(hostname)) {
			throw new Error("Fetching local or private network addresses is blocked");
		}
		return;
	}

	let addresses: Array<{ address: string }>;
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new Error(`Could not resolve host: ${hostname}`);
	}

	if (addresses.length === 0) {
		throw new Error(`Could not resolve host: ${hostname}`);
	}
	if (addresses.some(({ address }) => isPrivateIp(address))) {
		throw new Error("Fetching local or private network addresses is blocked");
	}
}

const ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	bull: "•",
	middot: "·",
	copy: "©",
	reg: "®",
	trade: "™",
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const code = entity[1]?.toLowerCase() === "x"
				? Number.parseInt(entity.slice(2), 16)
				: Number.parseInt(entity.slice(1), 10);
			if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
				try {
					return String.fromCodePoint(code);
				} catch {
					return match;
				}
			}
			return match;
		}
		return ENTITY_MAP[entity.toLowerCase()] ?? match;
	});
}

function extractTitle(html: string): string | undefined {
	const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	if (!raw) return undefined;
	const title = normalizeWhitespace(decodeEntities(raw));
	return title || undefined;
}

function htmlToText(html: string): string {
	const text = html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<head[\s\S]*?<\/head>/gi, "")
		.replace(/<(script|style|noscript|svg|canvas|template|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, "")
		.replace(/<(nav|footer|aside|form|button|select|textarea)[^>]*>[\s\S]*?<\/\1>/gi, "")
		.replace(/<(br|hr)\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|section|article|header|main|li|h[1-6]|tr|blockquote|pre|table|dt|dd)>/gi, "\n")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, "");

	return normalizePlainText(decodeEntities(text));
}

function normalizePlainText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
	const charset = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1];
	for (const candidate of [charset, "utf-8"]) {
		if (!candidate) continue;
		try {
			return new TextDecoder(candidate).decode(bytes);
		} catch {
			// Try the next supported encoding.
		}
	}
	return new TextDecoder().decode(bytes);
}

async function readBodyText(response: Response, contentType: string): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(declaredLength) && declaredLength > MAX_FETCH_BYTES) {
		throw new Error(`Response is too large (${declaredLength} bytes; limit is ${MAX_FETCH_BYTES})`);
	}

	const reader = response.body?.getReader();
	if (!reader) return "";

	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_FETCH_BYTES) {
				await reader.cancel();
				throw new Error(`Response is too large (limit is ${MAX_FETCH_BYTES} bytes)`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return decodeBody(bytes, contentType);
}

function isReadableMime(mime: string): boolean {
	return mime === "text/html" || mime === "application/xhtml+xml" || mime.startsWith("text/");
}

async function fetchPublicUrl(
	rawUrl: string,
	signal?: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> {
	let current: URL;
	try {
		current = new URL(rawUrl);
	} catch {
		throw new Error("Invalid URL");
	}

	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
		await assertPublicUrl(current);
		const response = await fetch(current, {
			redirect: "manual",
			headers: {
				Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
				"Accept-Language": "en-US,en;q=0.8",
				"User-Agent": "Mozilla/5.0 (compatible; pi-web-fetch/1.0)",
			},
			signal: signal
				? AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), signal])
				: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!REDIRECT_STATUSES.has(response.status)) {
			return { response, finalUrl: current };
		}

		const location = response.headers.get("location");
		await response.body?.cancel();
		if (!location) {
			throw new Error(`Redirect ${response.status} did not include a Location header`);
		}
		try {
			current = new URL(location, current);
		} catch {
			throw new Error("Redirected to an invalid URL");
		}
	}

	throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`);
}

const webFetchParams = Type.Object({
	url: Type.String({
		description: "Absolute http(s) URL to fetch.",
	}),
	maxChars: Type.Optional(
		Type.Integer({
			description: "Maximum characters of readable text to return (1000-50000, default 12000).",
			minimum: 1_000,
			maximum: MAX_FETCH_CHARS,
			default: DEFAULT_FETCH_CHARS,
		}),
	),
});

const webFetchTool = defineTool({
	name: "web_fetch",
	label: "Web Fetch",
	description:
		"Fetch an http(s) URL and return its readable text. Supports HTML and plain-text pages, follows up to 5 redirects, blocks local/private network addresses, limits responses to 2 MB, and truncates output. Use this after web_search when a snippet is not enough.",
	promptSnippet: "Fetch and read the text of a web page",
	promptGuidelines: [
		"Use web_fetch to read a page found by web_search or supplied by the user when the snippet is insufficient.",
		"Localhost, private network addresses, and URLs with embedded credentials are blocked by the tool.",
	],
	parameters: webFetchParams,

	async execute(_toolCallId, params, signal) {
		const url = params.url.trim();
		if (!url) {
			throw new Error("URL must not be empty");
		}

		const maxChars = params.maxChars ?? DEFAULT_FETCH_CHARS;
		const { response, finalUrl } = await fetchPublicUrl(url, signal);

		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Fetch failed: HTTP ${response.status} ${response.statusText}`.trim());
		}

		const contentType = response.headers.get("content-type") ?? "";
		const mime = contentType.split(";")[0].trim().toLowerCase();
		if (mime && !isReadableMime(mime)) {
			await response.body?.cancel();
			throw new Error(`Unsupported content type: ${mime}. Only HTML and plain text are supported.`);
		}

		const raw = await readBodyText(response, contentType);
		const isHtml =
			mime === "text/html" ||
			mime === "application/xhtml+xml" ||
			(!mime && /^\s*</.test(raw));
		const title = isHtml ? extractTitle(raw) : undefined;

		let text = isHtml ? htmlToText(raw) : normalizePlainText(raw);
		if (!text) text = "(No readable text extracted from the page.)";

		const totalChars = text.length;
		const truncated = totalChars > maxChars;
		if (truncated) {
			text = `${text.slice(0, maxChars).trimEnd()}\n\n[truncated: showing ${maxChars} of ${totalChars} characters]`;
		}

		const header = [
			`Fetched: ${finalUrl.href}`,
			title ? `Title: ${title}` : "",
			`Content-Type: ${mime || "unknown"}`,
		].filter(Boolean).join("\n");

		return {
			content: [{ type: "text", text: `${header}\n\n${text}` }],
			details: {
				url,
				finalUrl: finalUrl.href,
				title,
				contentType: mime || "unknown",
				truncated,
				totalChars,
				returnedChars: Math.min(totalChars, maxChars),
			} satisfies FetchDetails,
		};
	},
});

const webSearchTool = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the web for current information. Returns titles, URLs, and snippets. Use this when the answer depends on recent events, external documentation, or facts not available in the repository. Follow up with `web_fetch` when a snippet is insufficient, and cite the URLs you use.",
	promptSnippet: "Search the web for current information",
	promptGuidelines: [
		"Use web_search when the answer depends on current events, external documentation, or facts not present in the repository.",
		"Cite the URLs of sources you rely on.",
		"Use web_fetch to read a result when its snippet is not enough.",
	],
	parameters: webSearchParams,

	async execute(_toolCallId, params, signal) {
		const query = params.query.trim();
		if (!query) {
			throw new Error("Search query must not be empty");
		}

		const numResults = params.numResults ?? 5;
		const apiKey = process.env.EXA_API_KEY?.trim();
		const provider: SearchDetails["provider"] = apiKey ? "exa-api" : "exa-mcp";
		const results = apiKey
			? await searchWithExaApi(query, numResults, apiKey, signal)
			: await searchWithExaMcp(query, numResults, signal);

		return {
			content: [{ type: "text", text: formatResults(query, results) }],
			details: {
				query,
				provider,
				count: results.length,
				results,
			} satisfies SearchDetails,
		};
	},
});

export default function webSearchExtension(pi: ExtensionAPI) {
	pi.registerTool(webSearchTool);
	pi.registerTool(webFetchTool);
}

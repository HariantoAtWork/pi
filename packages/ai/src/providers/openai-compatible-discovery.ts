import type { RefreshModelsContext } from "../models.ts";
import type { Model } from "../types.ts";
import type { OpenAICompletionsCompat } from "./compat-schema.ts";

/** Chat API served by an OpenAI-compatible `/models` listing. */
type OpenAICompletionsModel = Model<"openai-completions">;

/** One entry of an OpenAI-compatible `GET {baseUrl}/models` response. */
export interface OpenAICompatibleModelEntry {
	id: string;
	name?: string;
	created?: number;
	owned_by?: string;
}

/**
 * Normalize an endpoint the user typed into the API base URL: add the missing
 * scheme, drop the trailing slash, and drop a trailing `/models` so pasting the
 * listing URL itself still yields the request base URL.
 */
export function normalizeOpenAICompatibleBaseUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) throw new Error("OpenAI-compatible base URL must not be empty.");
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		throw new Error(`Invalid OpenAI-compatible base URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported OpenAI-compatible base URL protocol: ${parsed.protocol}`);
	}
	let baseUrl = withScheme.replace(/\/+$/, "");
	if (/\/models$/.test(baseUrl)) baseUrl = baseUrl.slice(0, -"/models".length);
	return baseUrl;
}

/** Fetch the models an OpenAI-compatible server serves at `{baseUrl}/models`. */
export async function listOpenAICompatibleModels(
	baseUrl: string,
	options: { apiKey?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<readonly OpenAICompatibleModelEntry[]> {
	const { apiKey, headers, signal } = options;
	const response = await fetch(`${normalizeOpenAICompatibleBaseUrl(baseUrl)}/models`, {
		headers: {
			accept: "application/json",
			...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
			...headers,
		},
		signal,
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch models from ${baseUrl}/models: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as unknown;
	// Standard OpenAI replies `{ object: "list", data: [...] }`; some servers omit the wrapper.
	const data = Array.isArray(body)
		? body
		: Array.isArray((body as { data?: unknown }).data)
			? (body as { data: unknown[] }).data
			: undefined;
	if (!data) throw new Error(`Invalid models response from ${baseUrl}/models: expected a "data" array.`);

	return data
		.map((entry): OpenAICompatibleModelEntry | undefined => {
			if (typeof entry === "string") return { id: entry };
			if (typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string") {
				return entry as OpenAICompatibleModelEntry;
			}
			return undefined;
		})
		.filter((entry): entry is OpenAICompatibleModelEntry => entry !== undefined);
}

/**
 * Build a chat model from a listed entry. Endpoints report only the id, so the
 * rest is defaults plus `overrides` and `transform`.
 */
export function openAICompatibleModelFromEntry(
	entry: OpenAICompatibleModelEntry,
	options: {
		provider: string;
		baseUrl: string;
		compat?: OpenAICompletionsCompat;
		overrides?: Partial<OpenAICompletionsModel>;
		transform?: (entry: OpenAICompatibleModelEntry) => Partial<OpenAICompletionsModel> | undefined;
	},
): OpenAICompletionsModel {
	const { provider, baseUrl, compat, overrides, transform } = options;
	// Endpoints report no metadata beyond the id, so fall back to the same defaults models.json uses.
	const base: OpenAICompletionsModel = {
		id: entry.id,
		name: entry.name ?? entry.id,
		api: "openai-completions",
		provider,
		baseUrl: normalizeOpenAICompatibleBaseUrl(baseUrl),
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
		...(compat ? { compat } : {}),
	};
	return { ...base, ...overrides, ...transform?.(entry) };
}

export interface OpenAICompatibleDiscoveryOptions {
	/** Provider id the discovered models belong to. */
	provider: string;
	/** Base URL override. Defaults to `RefreshModelsContext.baseUrl`. */
	baseUrl?: string;
	/** API key override. Defaults to the refreshed credential. */
	apiKey?: string;
	headers?: Record<string, string>;
	/** Compat settings applied to every discovered model. */
	compat?: OpenAICompletionsCompat;
	/** Metadata applied to every discovered model, merged over the defaults. */
	overrides?: Partial<OpenAICompletionsModel>;
	/** Per-entry metadata merged over `overrides`, or `undefined` for no per-entry changes. */
	transform?: (entry: OpenAICompatibleModelEntry) => Partial<OpenAICompletionsModel> | undefined;
	/** Keeps entries whose `transform` result is defined. Omit to keep every entry. */
	filter?: (entry: OpenAICompatibleModelEntry) => boolean;
}

/**
 * Build a `createProvider({ fetchModels })` implementation for an OpenAI-compatible
 * endpoint: list the served models and turn each into a chat model.
 */
export function createOpenAICompatibleModelFetcher(
	options: OpenAICompatibleDiscoveryOptions,
): (context: RefreshModelsContext) => Promise<readonly OpenAICompletionsModel[]> {
	return async (context) => {
		const baseUrl = options.baseUrl ?? context.baseUrl;
		if (!baseUrl) throw new Error(`Provider ${options.provider}: "baseUrl" is required for model discovery.`);
		const apiKey =
			options.apiKey ??
			(context.credential?.type === "api_key"
				? context.credential.key
				: context.credential?.type === "oauth"
					? context.credential.access
					: undefined);
		const entries = await listOpenAICompatibleModels(baseUrl, {
			apiKey,
			headers: options.headers,
			signal: context.signal,
		});
		return entries
			.filter((entry) => !options.filter || options.filter(entry))
			.map((entry) =>
				openAICompatibleModelFromEntry(entry, {
					provider: options.provider,
					baseUrl,
					compat: options.compat,
					overrides: options.overrides,
					transform: options.transform,
				}),
			);
	};
}

/**
 * Add a custom OpenAI-compatible endpoint: probe `GET {baseUrl}/models` and turn the
 * reply into a models.json provider, so the endpoint's models become selectable without
 * hand-writing model entries.
 */

import {
	listOpenAICompatibleModels,
	normalizeOpenAICompatibleBaseUrl,
} from "@earendil-works/pi-ai/providers/openai-compatible-discovery";
import type { ModelsJsonModel, ModelsJsonProvider } from "./model-config.ts";
import { upsertModelsJsonProvider } from "./models-json-writer.ts";

export interface OpenAICompatibleProviderPlan {
	providerId: string;
	provider: ModelsJsonProvider;
	modelIds: readonly string[];
}

export interface PlanOpenAICompatibleProviderInput {
	/** Endpoint URL, with or without scheme and `/models` suffix. */
	baseUrl: string;
	/** Omitted or empty for keyless local servers. */
	apiKey?: string;
	/** Display name. Defaults to the derived provider id. */
	name?: string;
	/** Provider ids already in models.json; the derived id avoids them. */
	existingProviderIds?: Iterable<string>;
	signal?: AbortSignal;
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Derive a provider id from the endpoint host and port, e.g.
 * `http://localhost:11434/v1` -> `localhost-11434`. Suffixes on collision with an
 * existing provider that points elsewhere.
 */
export function deriveProviderId(baseUrl: string, existingProviderIds: Iterable<string> = []): string {
	const url = new URL(normalizeOpenAICompatibleBaseUrl(baseUrl));
	const slug = slugify(url.port ? `${url.hostname}-${url.port}` : url.hostname) || "openai-compatible";
	const taken = new Set(existingProviderIds);
	if (!taken.has(slug)) return slug;
	for (let suffix = 2; ; suffix++) {
		if (!taken.has(`${slug}-${suffix}`)) return `${slug}-${suffix}`;
	}
}

/** Probe the endpoint and build the provider entry without writing it. */
export async function planOpenAICompatibleProvider(
	input: PlanOpenAICompatibleProviderInput,
): Promise<OpenAICompatibleProviderPlan> {
	const baseUrl = normalizeOpenAICompatibleBaseUrl(input.baseUrl);
	const apiKey = input.apiKey?.trim() || undefined;
	const entries = await listOpenAICompatibleModels(baseUrl, {
		// Keyless local servers still need a non-empty models.json apiKey; the id works as one.
		apiKey,
		signal: input.signal,
	});
	if (entries.length === 0) throw new Error(`No models served by ${baseUrl}/models.`);

	const models: ModelsJsonModel[] = entries.map((entry) =>
		entry.name && entry.name !== entry.id ? { id: entry.id, name: entry.name } : { id: entry.id },
	);
	const providerId = deriveProviderId(baseUrl, input.existingProviderIds);
	return {
		providerId,
		provider: {
			name: input.name?.trim() || providerId,
			baseUrl,
			api: "openai-completions",
			apiKey: apiKey ?? providerId,
			models,
		},
		modelIds: entries.map((entry) => entry.id),
	};
}

/** Probe the endpoint and persist the provider to models.json. */
export async function addOpenAICompatibleProvider(
	modelsJsonPath: string,
	input: PlanOpenAICompatibleProviderInput,
): Promise<OpenAICompatibleProviderPlan> {
	const plan = await planOpenAICompatibleProvider(input);
	await upsertModelsJsonProvider(modelsJsonPath, plan.providerId, plan.provider);
	return plan;
}

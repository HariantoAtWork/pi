import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAICompletionsApi } from "../src/api/openai-completions.lazy.ts";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { envApiKeyAuth } from "../src/auth/helpers.ts";
import { createModels, createProvider } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import {
	createOpenAICompatibleModelFetcher,
	listOpenAICompatibleModels,
	normalizeOpenAICompatibleBaseUrl,
	openAICompatibleModelFromEntry,
} from "../src/providers/openai-compatible-discovery.ts";

function stubResponse(data: unknown): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => data })),
	);
}

describe("openAICompletions model discovery", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("normalizes a base URL the user typed", () => {
		expect(normalizeOpenAICompatibleBaseUrl("proxy.example.com/v1")).toBe("https://proxy.example.com/v1");
		expect(normalizeOpenAICompatibleBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
		// Pasting the listing URL itself still yields the API base URL.
		expect(normalizeOpenAICompatibleBaseUrl("https://proxy.example.com/v1/models")).toBe(
			"https://proxy.example.com/v1",
		);
		expect(() => normalizeOpenAICompatibleBaseUrl("ftp://proxy.example.com")).toThrow(/protocol/);
	});

	it("lists models and sends the credential", async () => {
		stubResponse({ object: "list", data: [{ id: "gpt-4o", object: "model" }, { id: "llama-3.1-70b" }] });

		const entries = await listOpenAICompatibleModels("https://proxy.example.com/v1", { apiKey: "test-key" });

		expect(vi.mocked(fetch)).toHaveBeenCalledWith(
			"https://proxy.example.com/v1/models",
			expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer test-key" }) }),
		);
		expect(entries.map((entry) => entry.id)).toEqual(["gpt-4o", "llama-3.1-70b"]);
	});

	it("rejects a failed request", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) })),
		);
		await expect(listOpenAICompatibleModels("https://proxy.example.com/v1")).rejects.toThrow("401 Unauthorized");
	});

	it("rejects a body without a model list", async () => {
		stubResponse({ object: "list" });
		await expect(listOpenAICompatibleModels("https://proxy.example.com/v1")).rejects.toThrow(/data/);
	});

	it("fills chat metadata the endpoint does not report", () => {
		const model = openAICompatibleModelFromEntry(
			{ id: "gpt-4o" },
			{ provider: "proxy", baseUrl: "https://proxy/v1" },
		);
		expect(model).toMatchObject({
			id: "gpt-4o",
			name: "gpt-4o",
			api: "openai-completions",
			provider: "proxy",
			baseUrl: "https://proxy/v1",
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 16384,
		});
	});

	it("applies compat, overrides, and per-entry transforms", () => {
		const compat = { supportsDeveloperRole: false, maxTokensField: "max_tokens" } as const;
		const model = openAICompatibleModelFromEntry(
			{ id: "o1-preview" },
			{
				provider: "proxy",
				baseUrl: "https://proxy/v1",
				compat,
				overrides: { contextWindow: 32768 },
				transform: (entry) => (entry.id.startsWith("o1") ? { reasoning: true, maxTokens: 65536 } : {}),
			},
		);

		expect(model.reasoning).toBe(true);
		expect(model.maxTokens).toBe(65536);
		expect(model.contextWindow).toBe(32768);
		expect(model.compat?.maxTokensField).toBe("max_tokens");
		expect(model.compat?.supportsDeveloperRole).toBe(false);
	});

	it("registers fetched models on a provider", async () => {
		stubResponse({ object: "list", data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] });
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("proxy", async () => ({ type: "api_key", key: "test-key" }));
		const models = createModels({ credentials, modelsStore: new InMemoryModelsStore() });

		const provider = createProvider({
			id: "proxy",
			baseUrl: "https://proxy.example.com/v1",
			auth: { apiKey: envApiKeyAuth("Proxy API key", ["PROXY_API_KEY"]) },
			models: [],
			fetchModels: createOpenAICompatibleModelFetcher({ provider: "proxy" }),
			api: openAICompletionsApi(),
		});
		models.setProvider(provider);

		await models.refresh({ providers: ["proxy"] });

		const fetched = provider.getModels();
		expect(fetched.map((model) => model.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
		// The request base URL, not the listing URL, is what the API client appends to.
		expect(fetched[0]?.baseUrl).toBe("https://proxy.example.com/v1");
	});
});

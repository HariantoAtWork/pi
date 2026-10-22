import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelConfig } from "../src/core/model-config.ts";
import {
	addOpenAICompatibleProvider,
	deriveProviderId,
	planOpenAICompatibleProvider,
} from "../src/core/openai-compatible-setup.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempModelsPath(): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-openai-compatible-setup-"));
	temporaryDirectories.push(directory);
	return join(directory, "models.json");
}

function stubModels(data: unknown): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => data })),
	);
}

describe("OpenAI-compatible provider setup", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe("deriveProviderId", () => {
		it("slugifies the host and port", () => {
			expect(deriveProviderId("https://api.openai.com/v1")).toBe("api-openai-com");
			expect(deriveProviderId("http://localhost:11434/v1")).toBe("localhost-11434");
		});

		it("suffixes when another endpoint already owns the id", () => {
			expect(deriveProviderId("https://proxy.example.com/v1", ["proxy.example.com", "proxy-example-com"])).toBe(
				"proxy-example-com-2",
			);
			expect(deriveProviderId("https://proxy.example.com/v1", ["proxy-example-com", "proxy-example-com-2"])).toBe(
				"proxy-example-com-3",
			);
		});
	});

	describe("planOpenAICompatibleProvider", () => {
		it("turns the model list into a provider entry", async () => {
			stubModels({ object: "list", data: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-4o-mini" }] });

			const plan = await planOpenAICompatibleProvider({
				baseUrl: "https://proxy.example.com/v1",
				apiKey: "test-key",
				existingProviderIds: ["proxy-example-com"],
			});

			expect(plan.providerId).toBe("proxy-example-com-2");
			expect(plan.modelIds).toEqual(["gpt-4o", "gpt-4o-mini"]);
			expect(plan.provider).toEqual({
				name: "proxy-example-com-2",
				baseUrl: "https://proxy.example.com/v1",
				api: "openai-completions",
				apiKey: "test-key",
				models: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-4o-mini" }],
			});
		});

		it("uses the provider id as the key for keyless endpoints and honors a name", async () => {
			stubModels({ data: [{ id: "llama-3.1-70b" }] });

			const plan = await planOpenAICompatibleProvider({
				baseUrl: "http://localhost:11434/v1",
				apiKey: "  ",
				name: "Local Ollama",
			});

			expect(plan.provider.name).toBe("Local Ollama");
			expect(plan.provider.apiKey).toBe("localhost-11434");
		});

		it("fails when the endpoint serves nothing", async () => {
			stubModels({ object: "list", data: [] });
			await expect(planOpenAICompatibleProvider({ baseUrl: "https://proxy.example.com/v1" })).rejects.toThrow(
				/No models served/,
			);
		});
	});

	describe("addOpenAICompatibleProvider", () => {
		it("persists the provider so pi can load it", async () => {
			stubModels({ data: [{ id: "gpt-4o" }] });
			const path = tempModelsPath();

			const plan = await addOpenAICompatibleProvider(path, { baseUrl: "https://proxy.example.com/v1", apiKey: "k" });

			const config = await ModelConfig.load(path);
			expect(config.getError()).toBeUndefined();
			expect(config.getProvider(plan.providerId)).toEqual(plan.provider);
			expect(JSON.parse(readFileSync(path, "utf-8")).providers[plan.providerId].api).toBe("openai-completions");
		});
	});
});

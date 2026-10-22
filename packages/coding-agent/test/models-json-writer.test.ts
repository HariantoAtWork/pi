import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelConfig, type ModelsJsonProvider } from "../src/core/model-config.ts";
import { MODELS_JSON_SCHEMA_URL, upsertModelsJsonProvider } from "../src/core/models-json-writer.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempPath(name = "models.json"): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-models-json-writer-"));
	temporaryDirectories.push(directory);
	return join(directory, name);
}

const provider: ModelsJsonProvider = {
	name: "Proxy",
	baseUrl: "https://proxy.example.com/v1",
	api: "openai-completions",
	apiKey: "test-key",
	models: [{ id: "gpt-4o" }],
};

describe("models.json writer", () => {
	it("creates a missing file with the schema url", async () => {
		const path = tempPath();
		await upsertModelsJsonProvider(path, "proxy", provider);

		expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({
			$schema: MODELS_JSON_SCHEMA_URL,
			providers: { proxy: provider },
		});
	});

	it("replaces one provider and keeps the others, their fields, and comments-stripped content intact", async () => {
		const path = tempPath();
		writeFileSync(
			path,
			`// hand-written config\n{
	"providers": {
		"anthropic": { "baseUrl": "https://api.anthropic.com", "apiKey": "sk", "models": [{ "id": "claude-x", "name": "Claude X" }] },
		"proxy": { "baseUrl": "https://old.example.com/v1", "apiKey": "old", "models": [] }
	}
}`,
		);

		await upsertModelsJsonProvider(path, "proxy", provider);

		const config = await ModelConfig.load(path);
		expect(config.getError()).toBeUndefined();
		expect(config.getProviderIds()).toEqual(["anthropic", "proxy"]);
		expect(config.getProvider("anthropic")).toEqual({
			baseUrl: "https://api.anthropic.com",
			apiKey: "sk",
			models: [{ id: "claude-x", name: "Claude X" }],
		});
		expect(config.getProvider("proxy")).toEqual(provider);
	});

	it("refuses to write content that fails schema validation", async () => {
		const path = tempPath();
		writeFileSync(path, "{ not json");

		await expect(upsertModelsJsonProvider(path, "proxy", provider)).rejects.toThrow("Failed to parse models.json");
		expect(readFileSync(path, "utf-8")).toBe("{ not json");
	});
});

/** Write-side helpers for models.json. Reads go through `ModelConfig`. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizePath } from "../utils/paths.ts";
import { type ModelsJsonFile, type ModelsJsonProvider, parseModelsJson } from "./model-config.ts";

export const MODELS_JSON_SCHEMA_URL = "https://pi.dev/schemas/models.schema.json";

export function serializeModelsJson(file: ModelsJsonFile): string {
	return `${JSON.stringify({ $schema: file.$schema ?? MODELS_JSON_SCHEMA_URL, providers: file.providers }, null, 2)}\n`;
}

/** Read and validate models.json, treating a missing file as an empty config. */
export async function readModelsJsonFile(modelsJsonPath: string): Promise<ModelsJsonFile> {
	const path = normalizePath(modelsJsonPath);
	let content: string;
	try {
		content = await readFile(path, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { providers: {} };
		throw error;
	}
	const parsed = parseModelsJson(content, path);
	if (!parsed.file) throw new Error(parsed.error);
	return parsed.file;
}

/** Serialize, validate, then replace the file. An invalid config is never written. */
export async function writeModelsJsonFile(modelsJsonPath: string, file: ModelsJsonFile): Promise<void> {
	const path = normalizePath(modelsJsonPath);
	const content = serializeModelsJson(file);
	// Validate the exact bytes we are about to write so a bad merge cannot truncate the config.
	const parsed = parseModelsJson(content, path);
	if (!parsed.file) throw new Error(parsed.error);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf-8");
}

/** Add or replace one provider, keeping `$schema` and every other provider intact. */
export async function upsertModelsJsonProvider(
	modelsJsonPath: string,
	providerId: string,
	provider: ModelsJsonProvider,
): Promise<void> {
	const file = await readModelsJsonFile(modelsJsonPath);
	await writeModelsJsonFile(modelsJsonPath, { ...file, providers: { ...file.providers, [providerId]: provider } });
}

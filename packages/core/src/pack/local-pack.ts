import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { PackManifest } from "./types.js";

export interface LocalPack {
  sourcePath: string;
  manifestPath: string;
  manifest: PackManifest;
  schemas: Array<{
    path: string;
    schema: Record<string, unknown>;
  }>;
  queries: Array<{
    path: string;
    query: Record<string, unknown>;
  }>;
}

export async function loadLocalPack(sourcePath: string): Promise<LocalPack> {
  const resolvedSourcePath = resolve(sourcePath);
  const manifestPath = resolve(resolvedSourcePath, "pack.json");
  const manifest = parseManifest(await readJson(manifestPath));

  const referencedFiles = [
    ...(manifest.schemas ?? []),
    ...(manifest.extractors ?? []),
    ...(manifest.queries ?? []),
    ...(manifest.validators ?? []),
    ...(manifest.tools ? [manifest.tools] : [])
  ];

  await Promise.all(referencedFiles.map((filePath) => access(resolve(resolvedSourcePath, filePath))));

  const schemas = await Promise.all(
    (manifest.schemas ?? []).map(async (schemaPath) => ({
      path: schemaPath,
      schema: await readJson(resolve(resolvedSourcePath, schemaPath))
    }))
  );

  const queries = await Promise.all(
    (manifest.queries ?? []).map(async (queryPath) => ({
      path: queryPath,
      query: await readJson(resolve(resolvedSourcePath, queryPath))
    }))
  );

  return {
    sourcePath: resolvedSourcePath,
    manifestPath,
    manifest,
    schemas,
    queries
  };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`Expected JSON object in ${path}`);
  }
  return parsed;
}

function parseManifest(value: Record<string, unknown>): PackManifest {
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error("Pack manifest must include a non-empty name");
  }
  if (typeof value.version !== "string" || value.version.length === 0) {
    throw new Error("Pack manifest must include a non-empty version");
  }

  assertStringArray(value.schemas, "schemas");
  assertStringArray(value.extractors, "extractors");
  assertStringArray(value.queries, "queries");
  assertStringArray(value.validators, "validators");

  if (value.tools !== undefined && typeof value.tools !== "string") {
    throw new Error("Pack manifest tools must be a string");
  }

  return value as unknown as PackManifest;
}

function assertStringArray(value: unknown, field: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Pack manifest ${field} must be an array of strings`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function schemaNameFromJson(schema: Record<string, unknown>): string {
  const id = schema.$id;
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  const title = schema.title;
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  throw new Error("Schema must include $id or title");
}

export function schemaVersionFromJson(schema: Record<string, unknown>): string {
  const version = schema.version;
  return typeof version === "string" && version.length > 0 ? version : "1";
}

export function queryNameFromJson(query: Record<string, unknown>, path: string): string {
  const name = query.name;
  if (typeof name === "string" && name.length > 0) {
    return name;
  }
  return basename(path, ".query.json");
}

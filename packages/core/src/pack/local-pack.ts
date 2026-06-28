import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ObserveExtractionRule, PackManifest } from "./types.js";

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

  const observeRules = (
    await Promise.all(
      (manifest.extractors ?? [])
        .filter((extractorPath) => extractorPath.endsWith(".rules.json"))
        .map(async (rulesPath) => parseObserveRules(await readJson(resolve(resolvedSourcePath, rulesPath)), rulesPath))
    )
  ).flat();

  return {
    sourcePath: resolvedSourcePath,
    manifestPath,
    manifest: {
      ...manifest,
      observe: {
        ...(manifest.observe ?? {}),
        ...(observeRules.length > 0 ? { rules: observeRules } : {})
      }
    },
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

function parseObserveRules(value: Record<string, unknown>, path: string): ObserveExtractionRule[] {
  const rules = value.rules;
  if (!Array.isArray(rules)) {
    throw new Error(`Observe rules file must include a rules array: ${path}`);
  }

  return rules.map((rule, index) => {
    if (!isObject(rule)) {
      throw new Error(`Observe rule at ${path}#${index} must be an object`);
    }
    if (typeof rule.schema !== "string" || rule.schema.length === 0) {
      throw new Error(`Observe rule at ${path}#${index} must include a schema`);
    }
    if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
      throw new Error(`Observe rule at ${path}#${index} must include a pattern`);
    }
    if (!isObject(rule.fields)) {
      throw new Error(`Observe rule at ${path}#${index} must include fields`);
    }
    assertValidRegExp(rule.pattern, rule.flags, `${path}#${index}`);
    assertObserveFields(rule.fields, `${path}#${index}`);

    return rule as unknown as ObserveExtractionRule;
  });
}

function assertValidRegExp(pattern: unknown, flags: unknown, location: string): void {
  try {
    new RegExp(String(pattern), typeof flags === "string" ? flags : undefined);
  } catch (error) {
    throw new Error(`Invalid observe rule regex at ${location}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertObserveFields(fields: Record<string, unknown>, location: string): void {
  for (const [field, mapping] of Object.entries(fields)) {
    if (!isObject(mapping)) {
      throw new Error(`Observe rule field mapping at ${location}.${field} must be an object`);
    }
    if (mapping.group !== undefined && !Number.isInteger(mapping.group)) {
      throw new Error(`Observe rule field mapping at ${location}.${field} group must be an integer`);
    }
    if (mapping.event !== undefined && mapping.event !== "occurred_at") {
      throw new Error(`Observe rule field mapping at ${location}.${field} event must be occurred_at`);
    }
    if (
      mapping.type !== undefined &&
      mapping.type !== "string" &&
      mapping.type !== "number" &&
      mapping.type !== "integer"
    ) {
      throw new Error(`Observe rule field mapping at ${location}.${field} has unsupported type`);
    }
  }
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

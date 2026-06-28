export interface PackManifest {
  name: string;
  version: string;
  memtable?: string;
  description?: string;
  observe?: {
    eventTypes?: string[];
    keywords?: string[];
    rules?: ObserveExtractionRule[];
  };
  writePolicy?: {
    default?: "proposal" | "auto";
    autoCommitConfidence?: number;
    sensitive?: boolean;
  };
  schemas?: string[];
  extractors?: string[];
  queries?: string[];
  validators?: string[];
  tools?: string;
}

export interface ObserveExtractionRule {
  name?: string;
  schema: string;
  pattern: string;
  flags?: string;
  confidence?: number;
  fields: Record<string, ObserveFieldMapping>;
}

export interface ObserveFieldMapping {
  group?: number;
  value?: unknown;
  event?: "occurred_at";
  type?: "string" | "number" | "integer";
  map?: Record<string, unknown>;
}

export interface InstalledPack {
  id: string;
  name: string;
  version: string;
  source: string;
  manifest: PackManifest;
  status: string;
  installed_at: string;
  updated_at: string;
}

export interface RegisteredSchema {
  id: string;
  pack_id?: string;
  name: string;
  version: string;
  schema: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface QueryTemplate {
  id: string;
  pack_id?: string;
  name: string;
  description?: string;
  query: Record<string, unknown>;
  created_at: string;
}

export interface PackInstallResult {
  pack: InstalledPack;
  schemas: RegisteredSchema[];
  query_templates: QueryTemplate[];
}

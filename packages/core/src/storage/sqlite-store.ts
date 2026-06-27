import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  CommitOptions,
  Proposal,
  ProposalInput,
  ProposalStatus,
  RecordEntry,
  RejectOptions,
  Source,
  SourceInput
} from "../ledger/types.js";
import type { ObserveResult } from "../observe/types.js";
import type {
  InstalledPack,
  PackManifest,
  QueryTemplate,
  RegisteredSchema
} from "../pack/types.js";

const SCHEMA_VERSION = 2;

type Row = Record<string, unknown>;

export class SqliteStore {
  private constructor(
    readonly path: string,
    private readonly db: DatabaseSync
  ) {}

  static async open(path = ".memtable/memtable.db"): Promise<SqliteStore> {
    const resolvedPath = resolve(path);
    await mkdir(dirname(resolvedPath), { recursive: true });
    const db = new DatabaseSync(resolvedPath);
    const store = new SqliteStore(resolvedPath, db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mt_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const current = this.db
      .prepare("SELECT MAX(version) AS version FROM mt_migrations")
      .get() as { version: number | null };

    const currentVersion = current.version ?? 0;
    if (currentVersion >= SCHEMA_VERSION) {
      return;
    }

    if (currentVersion < 1) {
      this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS mt_packs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          source TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          status TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name)
        );

        CREATE TABLE IF NOT EXISTS mt_sources (
          id TEXT PRIMARY KEY,
          agent TEXT,
          event_type TEXT,
          session_id TEXT,
          conversation_id TEXT,
          message_id TEXT,
          kind TEXT NOT NULL,
          reference TEXT,
          excerpt TEXT,
          metadata_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mt_schemas (
          id TEXT PRIMARY KEY,
          pack_id TEXT,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          schema_json TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name, version)
        );

        CREATE TABLE IF NOT EXISTS mt_proposals (
          id TEXT PRIMARY KEY,
          schema_name TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          data_json TEXT NOT NULL,
          source_id TEXT,
          confidence REAL,
          status TEXT NOT NULL,
          validation_errors_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mt_records (
          id TEXT PRIMARY KEY,
          schema_name TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          data_json TEXT NOT NULL,
          occurred_at TEXT,
          source_id TEXT,
          confidence REAL,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS mt_audit_log (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          before_json TEXT,
          after_json TEXT,
          actor TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mt_observed_events (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          external_event_id TEXT,
          fingerprint TEXT NOT NULL,
          status TEXT NOT NULL,
          result_json TEXT,
          observed_at TEXT NOT NULL,
          UNIQUE(agent, fingerprint)
        );

        CREATE INDEX IF NOT EXISTS idx_mt_sources_agent_session ON mt_sources(agent, session_id);
        CREATE INDEX IF NOT EXISTS idx_mt_sources_message ON mt_sources(message_id);
        CREATE INDEX IF NOT EXISTS idx_mt_records_schema ON mt_records(schema_name);
        CREATE INDEX IF NOT EXISTS idx_mt_records_occurred_at ON mt_records(occurred_at);
        CREATE INDEX IF NOT EXISTS idx_mt_records_source_id ON mt_records(source_id);
        CREATE INDEX IF NOT EXISTS idx_mt_proposals_status ON mt_proposals(status);
        CREATE INDEX IF NOT EXISTS idx_mt_observed_events_agent ON mt_observed_events(agent);
      `);
      this.db
        .prepare("INSERT OR IGNORE INTO mt_migrations (version, applied_at) VALUES (?, ?)")
        .run(1, now());
      });
    }

    if (currentVersion < 2) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS mt_query_templates (
            id TEXT PRIMARY KEY,
            pack_id TEXT,
            name TEXT NOT NULL,
            description TEXT,
            query_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(pack_id, name)
          );
        `);
        this.db
          .prepare("INSERT OR IGNORE INTO mt_migrations (version, applied_at) VALUES (?, ?)")
          .run(2, now());
      });
    }
  }

  upsertPack(input: {
    name: string;
    version: string;
    source: string;
    manifest: PackManifest;
    status?: string;
  }): InstalledPack {
    const timestamp = now();
    const existing = this.db.prepare("SELECT * FROM mt_packs WHERE name = ?").get(input.name) as Row | undefined;
    const pack: InstalledPack = {
      id: existing ? String(existing.id) : randomUUID(),
      name: input.name,
      version: input.version,
      source: input.source,
      manifest: input.manifest,
      status: input.status ?? "installed",
      installed_at: existing ? String(existing.installed_at) : timestamp,
      updated_at: timestamp
    };

    this.db
      .prepare(`
        INSERT INTO mt_packs (
          id, name, version, source, manifest_json, status, installed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          version = excluded.version,
          source = excluded.source,
          manifest_json = excluded.manifest_json,
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .run(
        pack.id,
        pack.name,
        pack.version,
        pack.source,
        JSON.stringify(pack.manifest),
        pack.status,
        pack.installed_at,
        pack.updated_at
      );

    return pack;
  }

  listPacks(): InstalledPack[] {
    return (this.db.prepare("SELECT * FROM mt_packs ORDER BY name ASC").all() as Row[]).map(packFromRow);
  }

  upsertSchema(input: {
    pack_id?: string;
    name: string;
    version?: string;
    schema: Record<string, unknown>;
    status?: string;
  }): RegisteredSchema {
    const timestamp = now();
    const version = input.version ?? "1";
    const existing = this.db
      .prepare("SELECT * FROM mt_schemas WHERE name = ? AND version = ?")
      .get(input.name, version) as Row | undefined;
    const schema: RegisteredSchema = {
      id: existing ? String(existing.id) : randomUUID(),
      name: input.name,
      version,
      schema: input.schema,
      status: input.status ?? "active",
      created_at: existing ? String(existing.created_at) : timestamp,
      updated_at: timestamp
    };
    assignOptional(schema, "pack_id", input.pack_id);

    this.db
      .prepare(`
        INSERT INTO mt_schemas (
          id, pack_id, name, version, schema_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name, version) DO UPDATE SET
          pack_id = excluded.pack_id,
          schema_json = excluded.schema_json,
          status = excluded.status,
          updated_at = excluded.updated_at
      `)
      .run(
        schema.id,
        schema.pack_id ?? null,
        schema.name,
        schema.version,
        JSON.stringify(schema.schema),
        schema.status,
        schema.created_at,
        schema.updated_at
      );

    return schema;
  }

  listSchemas(): RegisteredSchema[] {
    return (this.db.prepare("SELECT * FROM mt_schemas ORDER BY name ASC, version ASC").all() as Row[]).map(
      schemaFromRow
    );
  }

  upsertQueryTemplate(input: {
    pack_id?: string;
    name: string;
    description?: string;
    query: Record<string, unknown>;
  }): QueryTemplate {
    const existing = this.db
      .prepare("SELECT * FROM mt_query_templates WHERE pack_id IS ? AND name = ?")
      .get(input.pack_id ?? null, input.name) as Row | undefined;
    const template: QueryTemplate = {
      id: existing ? String(existing.id) : randomUUID(),
      name: input.name,
      query: input.query,
      created_at: existing ? String(existing.created_at) : now()
    };
    assignOptional(template, "pack_id", input.pack_id);
    assignOptional(template, "description", input.description);

    this.db
      .prepare(`
        INSERT INTO mt_query_templates (
          id, pack_id, name, description, query_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(pack_id, name) DO UPDATE SET
          description = excluded.description,
          query_json = excluded.query_json
      `)
      .run(
        template.id,
        template.pack_id ?? null,
        template.name,
        template.description ?? null,
        JSON.stringify(template.query),
        template.created_at
      );

    return template;
  }

  listQueryTemplates(): QueryTemplate[] {
    return (this.db.prepare("SELECT * FROM mt_query_templates ORDER BY name ASC").all() as Row[]).map(
      queryTemplateFromRow
    );
  }

  getObservedEvent(agent: string, fingerprint: string): ObserveResult | undefined {
    const row = this.db
      .prepare("SELECT result_json FROM mt_observed_events WHERE agent = ? AND fingerprint = ?")
      .get(agent, fingerprint) as Row | undefined;
    if (!row?.result_json) {
      return undefined;
    }
    return JSON.parse(String(row.result_json)) as ObserveResult;
  }

  insertObservedEvent(input: {
    agent: string;
    external_event_id?: string;
    fingerprint: string;
    status: string;
    result?: ObserveResult;
  }): boolean {
    const result = this.db
      .prepare(`
        INSERT OR IGNORE INTO mt_observed_events (
          id, agent, external_event_id, fingerprint, status, result_json, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.agent,
        input.external_event_id ?? null,
        input.fingerprint,
        input.status,
        input.result ? JSON.stringify(input.result) : null,
        now()
      );
    return result.changes > 0;
  }

  updateObservedEventResult(agent: string, fingerprint: string, result: ObserveResult): void {
    this.db
      .prepare("UPDATE mt_observed_events SET status = ?, result_json = ? WHERE agent = ? AND fingerprint = ?")
      .run(result.status, JSON.stringify(result), agent, fingerprint);
  }

  createSource(input: SourceInput): Source {
    const source: Source = {
      id: randomUUID(),
      kind: input.kind,
      created_at: now()
    };
    assignOptional(source, "reference", input.reference);
    assignOptional(source, "excerpt", input.excerpt);
    assignOptional(source, "agent", input.agent);
    assignOptional(source, "event_type", input.event_type);
    assignOptional(source, "session_id", input.session_id);
    assignOptional(source, "conversation_id", input.conversation_id);
    assignOptional(source, "message_id", input.message_id);
    assignOptional(source, "metadata", input.metadata);

    this.db
      .prepare(`
        INSERT INTO mt_sources (
          id, agent, event_type, session_id, conversation_id, message_id,
          kind, reference, excerpt, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source.id,
        source.agent ?? null,
        source.event_type ?? null,
        source.session_id ?? null,
        source.conversation_id ?? null,
        source.message_id ?? null,
        source.kind,
        source.reference ?? null,
        source.excerpt ?? null,
        source.metadata ? JSON.stringify(source.metadata) : null,
        source.created_at
      );

    return source;
  }

  createProposal(input: ProposalInput): Proposal {
    return this.transaction(() => {
      const sourceId = input.source ? this.createSource(input.source).id : input.source_id;
      const timestamp = now();
      const proposal: Proposal = {
        id: randomUUID(),
        schema_name: input.schema_name,
        schema_version: input.schema_version ?? "1",
        data: input.data,
        status: input.status ?? "pending",
        created_at: timestamp,
        updated_at: timestamp
      };
      assignOptional(proposal, "source_id", sourceId);
      assignOptional(proposal, "confidence", input.confidence);
      assignOptional(proposal, "validation_errors", input.validation_errors);

      this.db
        .prepare(`
          INSERT INTO mt_proposals (
            id, schema_name, schema_version, data_json, source_id, confidence,
            status, validation_errors_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          proposal.id,
          proposal.schema_name,
          proposal.schema_version,
          JSON.stringify(proposal.data),
          proposal.source_id ?? null,
          proposal.confidence ?? null,
          proposal.status,
          proposal.validation_errors ? JSON.stringify(proposal.validation_errors) : null,
          proposal.created_at,
          proposal.updated_at
        );

      this.insertAuditLog("proposal", proposal.id, "create", null, proposal, "runtime");
      return proposal;
    });
  }

  listProposals(status?: ProposalStatus): Proposal[] {
    const rows = status
      ? (this.db
          .prepare("SELECT * FROM mt_proposals WHERE status = ? ORDER BY created_at ASC")
          .all(status) as Row[])
      : (this.db.prepare("SELECT * FROM mt_proposals ORDER BY created_at ASC").all() as Row[]);
    return rows.map(proposalFromRow);
  }

  getProposal(id: string): Proposal | undefined {
    const row = this.db.prepare("SELECT * FROM mt_proposals WHERE id = ?").get(id) as Row | undefined;
    return row ? proposalFromRow(row) : undefined;
  }

  commitProposal(id: string, options: CommitOptions = {}): RecordEntry {
    return this.transaction(() => {
      const proposal = this.getProposal(id);
      if (!proposal) {
        throw new Error(`Proposal not found: ${id}`);
      }
      if (proposal.status === "committed") {
        throw new Error(`Proposal already committed: ${id}`);
      }
      if (proposal.status === "rejected") {
        throw new Error(`Cannot commit rejected proposal: ${id}`);
      }

      const timestamp = now();
      const record: RecordEntry = {
        id: randomUUID(),
        schema_name: proposal.schema_name,
        schema_version: proposal.schema_version,
        data: proposal.data,
        created_at: timestamp,
        updated_at: timestamp
      };
      assignOptional(record, "occurred_at", getString(proposal.data, "occurred_at"));
      assignOptional(record, "source_id", proposal.source_id);
      assignOptional(record, "confidence", proposal.confidence);
      assignOptional(record, "created_by", options.actor ?? "runtime");

      this.db
        .prepare(`
          INSERT INTO mt_records (
            id, schema_name, schema_version, data_json, occurred_at, source_id,
            confidence, created_by, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          record.id,
          record.schema_name,
          record.schema_version,
          JSON.stringify(record.data),
          record.occurred_at ?? null,
          record.source_id ?? null,
          record.confidence ?? null,
          record.created_by ?? null,
          record.created_at,
          record.updated_at,
          null
        );

      const updatedProposal = { ...proposal, status: "committed" as const, updated_at: timestamp };
      this.db
        .prepare("UPDATE mt_proposals SET status = ?, updated_at = ? WHERE id = ?")
        .run(updatedProposal.status, updatedProposal.updated_at, id);

      this.insertAuditLog("record", record.id, "create", null, record, options.actor ?? "runtime");
      this.insertAuditLog("proposal", proposal.id, "commit", proposal, updatedProposal, options.actor ?? "runtime");
      return record;
    });
  }

  rejectProposal(id: string, options: RejectOptions = {}): Proposal {
    return this.transaction(() => {
      const proposal = this.getProposal(id);
      if (!proposal) {
        throw new Error(`Proposal not found: ${id}`);
      }
      if (proposal.status === "committed") {
        throw new Error(`Cannot reject committed proposal: ${id}`);
      }

      const updatedProposal = { ...proposal, status: "rejected" as const, updated_at: now() };
      this.db
        .prepare("UPDATE mt_proposals SET status = ?, updated_at = ? WHERE id = ?")
        .run(updatedProposal.status, updatedProposal.updated_at, id);
      this.insertAuditLog("proposal", proposal.id, "reject", proposal, updatedProposal, options.actor ?? "runtime");
      return updatedProposal;
    });
  }

  listRecords(schemaName?: string): RecordEntry[] {
    const rows = schemaName
      ? (this.db
          .prepare("SELECT * FROM mt_records WHERE schema_name = ? AND deleted_at IS NULL ORDER BY created_at ASC")
          .all(schemaName) as Row[])
      : (this.db
          .prepare("SELECT * FROM mt_records WHERE deleted_at IS NULL ORDER BY created_at ASC")
          .all() as Row[]);
    return rows.map(recordFromRow);
  }

  getAuditLog(entityId?: string): Row[] {
    return entityId
      ? (this.db
          .prepare("SELECT * FROM mt_audit_log WHERE entity_id = ? ORDER BY created_at ASC")
          .all(entityId) as Row[])
      : (this.db.prepare("SELECT * FROM mt_audit_log ORDER BY created_at ASC").all() as Row[]);
  }

  private insertAuditLog(
    entityType: string,
    entityId: string,
    action: string,
    before: unknown,
    after: unknown,
    actor: string
  ): void {
    this.db
      .prepare(`
        INSERT INTO mt_audit_log (
          id, entity_type, entity_id, action, before_json, after_json, actor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        entityType,
        entityId,
        action,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        actor,
        now()
      );
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function proposalFromRow(row: Row): Proposal {
  const proposal: Proposal = {
    id: String(row.id),
    schema_name: String(row.schema_name),
    schema_version: String(row.schema_version),
    data: JSON.parse(String(row.data_json)) as Record<string, unknown>,
    status: row.status as ProposalStatus,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
  assignOptional(proposal, "source_id", nullableString(row.source_id));
  assignOptional(proposal, "confidence", nullableNumber(row.confidence));
  assignOptional(proposal, "validation_errors", nullableJsonArray(row.validation_errors_json));
  return proposal;
}

function recordFromRow(row: Row): RecordEntry {
  const record: RecordEntry = {
    id: String(row.id),
    schema_name: String(row.schema_name),
    schema_version: String(row.schema_version),
    data: JSON.parse(String(row.data_json)) as Record<string, unknown>,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
  assignOptional(record, "occurred_at", nullableString(row.occurred_at));
  assignOptional(record, "source_id", nullableString(row.source_id));
  assignOptional(record, "confidence", nullableNumber(row.confidence));
  assignOptional(record, "created_by", nullableString(row.created_by));
  assignOptional(record, "deleted_at", nullableString(row.deleted_at));
  return record;
}

function packFromRow(row: Row): InstalledPack {
  return {
    id: String(row.id),
    name: String(row.name),
    version: String(row.version),
    source: String(row.source),
    manifest: JSON.parse(String(row.manifest_json)) as PackManifest,
    status: String(row.status),
    installed_at: String(row.installed_at),
    updated_at: String(row.updated_at)
  };
}

function schemaFromRow(row: Row): RegisteredSchema {
  const schema: RegisteredSchema = {
    id: String(row.id),
    name: String(row.name),
    version: String(row.version),
    schema: JSON.parse(String(row.schema_json)) as Record<string, unknown>,
    status: String(row.status),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
  assignOptional(schema, "pack_id", nullableString(row.pack_id));
  return schema;
}

function queryTemplateFromRow(row: Row): QueryTemplate {
  const template: QueryTemplate = {
    id: String(row.id),
    name: String(row.name),
    query: JSON.parse(String(row.query_json)) as Record<string, unknown>,
    created_at: String(row.created_at)
  };
  assignOptional(template, "pack_id", nullableString(row.pack_id));
  assignOptional(template, "description", nullableString(row.description));
  return template;
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function now(): string {
  return new Date().toISOString();
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function nullableNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function nullableJsonArray(value: unknown): unknown[] | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(String(value));
  return Array.isArray(parsed) ? parsed : undefined;
}

function getString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

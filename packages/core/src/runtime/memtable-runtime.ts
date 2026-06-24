import type { AgentEvent, ObserveResult } from "../observe/types.js";
import type {
  CommitOptions,
  Proposal,
  ProposalInput,
  ProposalStatus,
  RecordEntry,
  RejectOptions
} from "../ledger/types.js";
import {
  loadLocalPack,
  queryNameFromJson,
  schemaNameFromJson,
  schemaVersionFromJson
} from "../pack/local-pack.js";
import type { InstalledPack, PackInstallResult, QueryTemplate, RegisteredSchema } from "../pack/types.js";
import { SqliteStore } from "../storage/sqlite-store.js";

export interface MemTableRuntimeOptions {
  storage?: {
    driver: "sqlite";
    path: string;
  };
}

export class MemTableRuntime {
  private constructor(
    readonly options: MemTableRuntimeOptions,
    private readonly store: SqliteStore
  ) {}

  static async open(options: MemTableRuntimeOptions = {}): Promise<MemTableRuntime> {
    const storage = options.storage ?? {
      driver: "sqlite" as const,
      path: ".memtable/memtable.db"
    };
    const store = await SqliteStore.open(storage.path);
    return new MemTableRuntime({ ...options, storage }, store);
  }

  close(): void {
    this.store.close();
  }

  async observe(_event: AgentEvent): Promise<ObserveResult> {
    return {
      status: "ignored",
      matched_packs: [],
      proposals_created: 0,
      records_committed: 0,
      needs_review: 0
    };
  }

  async createProposal(input: ProposalInput): Promise<Proposal> {
    return this.store.createProposal(input);
  }

  async installPack(sourcePath: string): Promise<PackInstallResult> {
    const localPack = await loadLocalPack(sourcePath);
    return this.store.transaction(() => {
      const pack = this.store.upsertPack({
        name: localPack.manifest.name,
        version: localPack.manifest.version,
        source: localPack.sourcePath,
        manifest: localPack.manifest
      });
      const schemas = localPack.schemas.map(({ schema }) =>
        this.store.upsertSchema({
          pack_id: pack.id,
          name: schemaNameFromJson(schema),
          version: schemaVersionFromJson(schema),
          schema
        })
      );
      const query_templates = localPack.queries.map(({ path, query }) => {
        const description = typeof query.description === "string" ? query.description : undefined;
        return this.store.upsertQueryTemplate({
          pack_id: pack.id,
          name: queryNameFromJson(query, path),
          query,
          ...(description ? { description } : {})
        });
      });

      return {
        pack,
        schemas,
        query_templates
      };
    });
  }

  async listPacks(): Promise<InstalledPack[]> {
    return this.store.listPacks();
  }

  async listSchemas(): Promise<RegisteredSchema[]> {
    return this.store.listSchemas();
  }

  async listQueryTemplates(): Promise<QueryTemplate[]> {
    return this.store.listQueryTemplates();
  }

  async listProposals(status?: ProposalStatus): Promise<Proposal[]> {
    return this.store.listProposals(status);
  }

  async commitProposal(id: string, options: CommitOptions = {}): Promise<RecordEntry> {
    return this.store.commitProposal(id, options);
  }

  async rejectProposal(id: string, options: RejectOptions = {}): Promise<Proposal> {
    return this.store.rejectProposal(id, options);
  }

  async listRecords(schemaName?: string): Promise<RecordEntry[]> {
    return this.store.listRecords(schemaName);
  }

  async getAuditLog(entityId?: string): Promise<Record<string, unknown>[]> {
    return this.store.getAuditLog(entityId);
  }
}

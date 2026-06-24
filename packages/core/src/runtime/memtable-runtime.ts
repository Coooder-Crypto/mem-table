import type { AgentEvent, ObserveResult } from "../observe/types.js";
import type {
  CommitOptions,
  Proposal,
  ProposalInput,
  ProposalStatus,
  RecordEntry,
  RejectOptions
} from "../ledger/types.js";
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

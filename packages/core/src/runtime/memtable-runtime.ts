import { createHash } from "node:crypto";
import type { AgentEvent, ObserveResult } from "../observe/types.js";
import type {
  CommitOptions,
  Proposal,
  ProposalInput,
  ProposalStatus,
  RecordEntry,
  RejectOptions
} from "../ledger/types.js";
import { extractFitnessProposals } from "../observe/fitness-extractor.js";
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
    const event = normalizeEvent(_event);
    const fingerprint = eventFingerprint(event);
    const previous = this.store.getObservedEvent(event.agent, fingerprint);
    if (previous) {
      return {
        ...previous,
        duplicate: true
      };
    }

    const inserted = this.store.insertObservedEvent({
      agent: event.agent,
      fingerprint,
      status: "processing",
      ...(event.id ? { external_event_id: event.id } : {})
    });
    if (!inserted) {
      const duplicate = this.store.getObservedEvent(event.agent, fingerprint);
      return duplicate
        ? { ...duplicate, duplicate: true }
        : {
            status: "ignored",
            matched_packs: [],
            proposals_created: 0,
            records_committed: 0,
            needs_review: 0,
            duplicate: true
          };
    }

    const packs = this.store.listPacks();
    const matchedPacks = packs.filter((pack) => packMatchesEvent(pack.manifest, event)).map((pack) => pack.name);
    const proposalInputs = matchedPacks.flatMap((packName) =>
      packName === "fitness" ? extractFitnessProposals(event) : []
    );
    const proposals = proposalInputs.map((input) => this.store.createProposal(input));
    const result: ObserveResult = {
      status: matchedPacks.length > 0 ? "ok" : "ignored",
      matched_packs: matchedPacks,
      proposals_created: proposals.length,
      records_committed: 0,
      needs_review: proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "needs_review").length
    };

    this.store.updateObservedEventResult(event.agent, fingerprint, result);
    return result;
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

function normalizeEvent(event: AgentEvent): AgentEvent {
  return {
    ...event,
    occurred_at: event.occurred_at || new Date().toISOString()
  };
}

function eventFingerprint(event: AgentEvent): string {
  const stable = {
    id: event.id,
    agent: event.agent,
    event_type: event.event_type,
    session_id: event.session_id,
    conversation_id: event.conversation_id,
    message_id: event.message_id,
    content: event.content,
    tool_name: event.tool_name,
    tool_input: event.tool_input,
    tool_output: event.tool_output,
    occurred_at: event.occurred_at
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function packMatchesEvent(manifest: { observe?: { eventTypes?: string[]; keywords?: string[] } }, event: AgentEvent): boolean {
  const observe = manifest.observe;
  if (!observe) {
    return false;
  }
  if (observe.eventTypes && observe.eventTypes.length > 0 && !observe.eventTypes.includes(event.event_type)) {
    return false;
  }

  const keywords = observe.keywords ?? [];
  if (keywords.length === 0) {
    return true;
  }

  const content = eventText(event).toLowerCase();
  return keywords.some((keyword) => content.includes(keyword.toLowerCase()));
}

function eventText(event: AgentEvent): string {
  if (typeof event.content === "string") {
    return event.content;
  }
  if (typeof event.tool_output === "string") {
    return event.tool_output;
  }
  if (event.tool_output && typeof event.tool_output === "object") {
    return JSON.stringify(event.tool_output);
  }
  return "";
}

export type ProposalStatus = "pending" | "needs_review" | "committed" | "rejected";

export interface SourceInput {
  kind: string;
  reference?: string;
  excerpt?: string;
  agent?: string;
  event_type?: string;
  session_id?: string;
  conversation_id?: string;
  message_id?: string;
  metadata?: Record<string, unknown>;
}

export interface Source {
  id: string;
  kind: string;
  reference?: string;
  excerpt?: string;
  agent?: string;
  event_type?: string;
  session_id?: string;
  conversation_id?: string;
  message_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ProposalInput {
  schema_name: string;
  schema_version?: string;
  data: Record<string, unknown>;
  source?: SourceInput;
  source_id?: string;
  confidence?: number;
  status?: ProposalStatus;
  validation_errors?: unknown[];
}

export interface Proposal {
  id: string;
  schema_name: string;
  schema_version: string;
  data: Record<string, unknown>;
  source_id?: string;
  confidence?: number;
  status: ProposalStatus;
  validation_errors?: unknown[];
  created_at: string;
  updated_at: string;
}

export interface RecordEntry {
  id: string;
  schema_name: string;
  schema_version: string;
  data: Record<string, unknown>;
  occurred_at?: string;
  source_id?: string;
  confidence?: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface CommitOptions {
  actor?: string;
}

export interface RejectOptions {
  actor?: string;
}


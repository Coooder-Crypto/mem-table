export type AgentName = "hermes" | "openclaw" | "custom";

export type AgentEventType =
  | "session_start"
  | "session_end"
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "agent_end"
  | "subagent_end"
  | "manual_note";

export interface AgentEvent {
  id?: string;
  agent: AgentName;
  event_type: AgentEventType;
  session_id?: string;
  conversation_id?: string;
  message_id?: string;
  parent_event_id?: string;
  role?: "user" | "assistant" | "tool" | "system";
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  occurred_at: string;
  metadata?: Record<string, unknown>;
}

export interface ObserveResult {
  status: "ok" | "ignored" | "error";
  matched_packs: string[];
  proposals_created: number;
  records_committed: number;
  needs_review: number;
  duplicate?: boolean;
}

import type { AgentEvent } from "./types.js";
import type { ProposalInput, SourceInput } from "../ledger/types.js";

export function extractFitnessProposals(event: AgentEvent): ProposalInput[] {
  const content = eventContent(event);
  if (!content) {
    return [];
  }

  const proposals: ProposalInput[] = [];
  const occurredAt = event.occurred_at;
  const source: SourceInput = {
    kind: "agent_event",
    agent: event.agent,
    event_type: event.event_type,
    excerpt: content.slice(0, 500)
  };
  assignOptional(source, "session_id", event.session_id);
  assignOptional(source, "conversation_id", event.conversation_id);
  assignOptional(source, "message_id", event.message_id);
  assignOptional(source, "reference", event.id);
  assignOptional(source, "metadata", event.metadata);

  const bench = content.match(/(?:卧推|bench(?:\s+press)?)\s*([0-9]+(?:\.[0-9]+)?)\s*kg\s*([0-9]+)\s*[x×]\s*([0-9]+)/i);
  if (bench) {
    proposals.push({
      schema_name: "fitness.workout",
      data: {
        exercise: "bench_press",
        weight_kg: Number(bench[1]),
        sets: Number(bench[2]),
        reps: Number(bench[3]),
        occurred_at: occurredAt
      },
      source,
      confidence: 0.95
    });
  }

  const bodyWeight = content.match(/体重\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  if (bodyWeight) {
    proposals.push({
      schema_name: "fitness.body_weight",
      data: {
        weight_kg: Number(bodyWeight[1]),
        occurred_at: occurredAt
      },
      source,
      confidence: 0.95
    });
  }

  return proposals;
}

function eventContent(event: AgentEvent): string {
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

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

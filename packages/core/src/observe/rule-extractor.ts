import type { ProposalInput, SourceInput } from "../ledger/types.js";
import type { AgentEvent } from "./types.js";
import type { InstalledPack, ObserveFieldMapping, ObserveExtractionRule } from "../pack/types.js";

export function extractRuleProposals(event: AgentEvent, pack: InstalledPack): ProposalInput[] {
  const rules = pack.manifest.observe?.rules ?? [];
  if (rules.length === 0) {
    return [];
  }

  const content = eventContent(event);
  if (!content) {
    return [];
  }

  return rules.flatMap((rule) => extractRuleProposal(event, content, rule));
}

function extractRuleProposal(event: AgentEvent, content: string, rule: ObserveExtractionRule): ProposalInput[] {
  const regex = new RegExp(rule.pattern, withGlobalFlag(rule.flags));
  const proposals: ProposalInput[] = [];

  for (const match of content.matchAll(regex)) {
    const data = extractFields(event, match, rule.fields);
    if (!data) {
      continue;
    }
    proposals.push({
      schema_name: rule.schema,
      data,
      source: eventSource(event, content),
      confidence: rule.confidence ?? 0.8
    });
  }

  return proposals;
}

function extractFields(
  event: AgentEvent,
  match: RegExpMatchArray,
  fields: Record<string, ObserveFieldMapping>
): Record<string, unknown> | undefined {
  const data: Record<string, unknown> = {};

  for (const [field, mapping] of Object.entries(fields)) {
    const value = extractFieldValue(event, match, mapping);
    if (value === undefined) {
      return undefined;
    }
    data[field] = value;
  }

  return data;
}

function extractFieldValue(event: AgentEvent, match: RegExpMatchArray, mapping: ObserveFieldMapping): unknown {
  let value: unknown;

  if (mapping.event === "occurred_at") {
    value = event.occurred_at;
  } else if (mapping.group !== undefined) {
    value = match[mapping.group];
  } else if ("value" in mapping) {
    value = mapping.value;
  }

  if (mapping.map && typeof value === "string" && value in mapping.map) {
    value = mapping.map[value];
  }

  if (value === undefined) {
    return undefined;
  }

  if (mapping.type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  if (mapping.type === "integer") {
    const numberValue = Number(value);
    return Number.isInteger(numberValue) ? numberValue : undefined;
  }

  if (mapping.type === "string") {
    return String(value);
  }

  return value;
}

function eventSource(event: AgentEvent, content: string): SourceInput {
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
  return source;
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

function withGlobalFlag(flags = ""): string {
  return flags.includes("g") ? flags : `${flags}g`;
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

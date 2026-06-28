import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { MemTableRuntime } from "../runtime/memtable-runtime.js";
import type { AgentEvent, AgentName, AgentEventType, ObserveResult } from "./types.js";

export interface WatchLogsOptions {
  path: string;
  agent: AgentName;
}

export interface FollowLogsOptions extends WatchLogsOptions {
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onResult?: (result: WatchLogsResult) => void | Promise<void>;
}

export interface WatchLogsResult {
  files_scanned: number;
  lines_scanned: number;
  events_observed: number;
  proposals_created: number;
  duplicates: number;
  results: ObserveResult[];
}

export async function watchLogs(runtime: MemTableRuntime, options: WatchLogsOptions): Promise<WatchLogsResult> {
  return scanLogs(runtime, options);
}

export async function followLogs(runtime: MemTableRuntime, options: FollowLogsOptions): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(`Invalid poll interval: ${String(options.pollIntervalMs)}`);
  }

  const fileStates = new Map<string, FollowFileState>();
  while (!options.signal?.aborted) {
    const result = await scanLogs(runtime, options, fileStates);
    if (result.lines_scanned > 0) {
      await options.onResult?.(result);
    }
    if (options.signal?.aborted) {
      break;
    }
    await delay(pollIntervalMs, options.signal);
  }
}

async function scanLogs(
  runtime: MemTableRuntime,
  options: WatchLogsOptions,
  fileStates?: Map<string, FollowFileState>
): Promise<WatchLogsResult> {
  const files = await logFiles(options.path);
  const results: ObserveResult[] = [];
  let linesScanned = 0;

  for (const file of files) {
    const fileStat = await stat(file);
    const content = await readFile(file, "utf8");
    const fileState = fileStates?.get(file);
    const scan = scanContent(content, {
      previous: fileState,
      holdIncompleteLine: Boolean(fileStates)
    });
    if (fileStates) {
      fileStates.set(file, scan.nextState);
    }

    for (const entry of scan.lines) {
      const line = entry.content.trim();
      if (!line) {
        continue;
      }
      linesScanned += 1;
      const event = mapLogLine(line, {
        agent: options.agent,
        file,
        lineNumber: entry.lineNumber,
        fallbackOccurredAt: fileStat.mtime.toISOString()
      });
      results.push(await runtime.observe(event));
    }
  }

  return {
    files_scanned: files.length,
    lines_scanned: linesScanned,
    events_observed: results.length,
    proposals_created: results.reduce((sum, result) => sum + result.proposals_created, 0),
    duplicates: results.filter((result) => result.duplicate).length,
    results
  };
}

interface FollowFileState {
  offset: number;
  lineNumber: number;
  pending: string;
}

interface ScannedLine {
  lineNumber: number;
  content: string;
}

function scanContent(
  content: string,
  options: {
    previous: FollowFileState | undefined;
    holdIncompleteLine: boolean;
  }
): {
  lines: ScannedLine[];
  nextState: FollowFileState;
} {
  const previous = options.previous;
  const reset = previous && previous.offset > content.length;
  const offset = reset ? 0 : previous?.offset ?? 0;
  const pending = reset ? "" : previous?.pending ?? "";
  let lineNumber = reset ? 0 : previous?.lineNumber ?? 0;
  const nextContent = `${pending}${content.slice(offset)}`;
  const parts = nextContent.split(/\r?\n/);
  const hasTrailingNewline = /\r?\n$/.test(nextContent);
  const nextPending = options.holdIncompleteLine && !hasTrailingNewline ? parts.pop() ?? "" : "";
  const completedParts = hasTrailingNewline ? parts.slice(0, -1) : parts;
  const lines: ScannedLine[] = [];

  for (const line of completedParts) {
    lineNumber += 1;
    lines.push({
      lineNumber,
      content: line
    });
  }

  return {
    lines,
    nextState: {
      offset: content.length,
      lineNumber,
      pending: nextPending
    }
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function logFiles(path: string): Promise<string[]> {
  const inputStat = await stat(path);
  if (inputStat.isFile()) {
    return isLogFile(path) ? [path] : [];
  }
  if (!inputStat.isDirectory()) {
    return [];
  }

  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        return logFiles(entryPath);
      }
      return isLogFile(entryPath) ? [entryPath] : [];
    })
  );
  return files.flat().sort();
}

function isLogFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".jsonl" || extension === ".log";
}

function mapLogLine(
  line: string,
  context: {
    agent: AgentName;
    file: string;
    lineNumber: number;
    fallbackOccurredAt: string;
  }
): AgentEvent {
  const parsed = parseLine(line);
  if (context.agent === "hermes") {
    return mapHermesLine(parsed, line, context) ?? mapGenericLine(parsed, line, context);
  }
  if (context.agent === "openclaw") {
    return mapOpenClawLine(parsed, line, context) ?? mapGenericLine(parsed, line, context);
  }
  return mapGenericLine(parsed, line, context);
}

function mapGenericLine(
  parsed: Record<string, unknown>,
  line: string,
  context: {
    agent: AgentName;
    file: string;
    lineNumber: number;
    fallbackOccurredAt: string;
  }
): AgentEvent {
  const payload = linePayload(parsed);
  const occurredAt = occurredAtValue(payload, context.fallbackOccurredAt);
  const eventType = eventTypeValue(payload.event_type ?? payload.type) ?? "user_message";
  const content = stringValue(payload.content ?? payload.message ?? payload.text ?? payload.output) ?? line;

  const event: AgentEvent = {
    id: eventIdValue(payload) ?? stableLogEventId(context.file, context.lineNumber, line),
    agent: context.agent,
    event_type: eventType,
    role: roleValue(payload.role) ?? (eventType === "tool_result" ? "tool" : "user"),
    content,
    occurred_at: occurredAt,
    metadata: logMetadata(line, context)
  };
  assignCommonFields(event, payload);
  assignOptional(event, "tool_name", stringValue(payload.tool_name ?? payload.toolName));
  assignOptional(event, "tool_input", payload.tool_input ?? payload.input);
  assignOptional(event, "tool_output", payload.tool_output ?? payload.output);
  return event;
}

function mapHermesLine(
  parsed: Record<string, unknown>,
  line: string,
  context: {
    agent: AgentName;
    file: string;
    lineNumber: number;
    fallbackOccurredAt: string;
  }
): AgentEvent | undefined {
  const eventName = logEventName(parsed);
  if (!eventName) {
    return undefined;
  }

  const payload = linePayload(parsed);
  const occurredAt = occurredAtValue(payload, context.fallbackOccurredAt);
  if (eventName === "pre_gateway_dispatch") {
    const event = baseAgentEvent("hermes", "user_message", "user", occurredAt, line, context, eventName);
    assignOptional(event, "content", stringValue(payload.content ?? payload.message ?? payload.text ?? payload.prompt));
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "post_llm_call") {
    const event = baseAgentEvent("hermes", "assistant_message", "assistant", occurredAt, line, context, eventName);
    assignOptional(event, "content", stringValue(payload.content ?? payload.message ?? payload.output ?? payload.response));
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "post_tool_call") {
    const event = baseAgentEvent("hermes", "tool_result", "tool", occurredAt, line, context, eventName);
    assignOptional(event, "tool_name", stringValue(payload.tool_name ?? payload.toolName ?? payload.name));
    assignOptional(event, "tool_input", payload.params ?? payload.input ?? payload.arguments);
    assignOptional(event, "tool_output", payload.result ?? payload.output);
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "on_session_start") {
    const event = baseAgentEvent("hermes", "session_start", undefined, occurredAt, line, context, eventName);
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "on_session_end") {
    const event = baseAgentEvent("hermes", "session_end", undefined, occurredAt, line, context, eventName);
    assignCommonFields(event, payload);
    return event;
  }

  return undefined;
}

function mapOpenClawLine(
  parsed: Record<string, unknown>,
  line: string,
  context: {
    agent: AgentName;
    file: string;
    lineNumber: number;
    fallbackOccurredAt: string;
  }
): AgentEvent | undefined {
  const eventName = logEventName(parsed);
  if (!eventName) {
    return undefined;
  }

  const payload = linePayload(parsed);
  const occurredAt = occurredAtValue(payload, context.fallbackOccurredAt);
  if (eventName === "message_received") {
    const event = baseAgentEvent("openclaw", "user_message", "user", occurredAt, line, context, eventName);
    assignOptional(event, "content", stringValue(payload.content ?? payload.message ?? payload.text));
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "message_sent" || eventName === "llm_output") {
    const event = baseAgentEvent("openclaw", "assistant_message", "assistant", occurredAt, line, context, eventName);
    assignOptional(event, "content", stringValue(payload.content ?? payload.message ?? payload.output));
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "after_tool_call" || eventName === "tool_result_persist") {
    const event = baseAgentEvent("openclaw", "tool_result", "tool", occurredAt, line, context, eventName);
    assignOptional(event, "tool_name", stringValue(payload.toolName ?? payload.tool_name ?? payload.name));
    assignOptional(event, "tool_input", payload.params ?? payload.input);
    assignOptional(event, "tool_output", payload.result ?? payload.output);
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "agent_end") {
    const event = baseAgentEvent("openclaw", "agent_end", undefined, occurredAt, line, context, eventName);
    assignOptional(event, "content", stringValue(payload.output ?? payload.content ?? payload.message));
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "session_start") {
    const event = baseAgentEvent("openclaw", "session_start", undefined, occurredAt, line, context, eventName);
    assignCommonFields(event, payload);
    return event;
  }

  if (eventName === "session_end") {
    const event = baseAgentEvent("openclaw", "session_end", undefined, occurredAt, line, context, eventName);
    assignCommonFields(event, payload);
    return event;
  }

  return undefined;
}

function baseAgentEvent(
  agent: "hermes" | "openclaw",
  eventType: AgentEventType,
  role: AgentEvent["role"] | undefined,
  occurredAt: string,
  line: string,
  context: {
    file: string;
    lineNumber: number;
  },
  eventName: string
): AgentEvent {
  const event: AgentEvent = {
    id: stableLogEventId(context.file, context.lineNumber, line),
    agent,
    event_type: eventType,
    occurred_at: occurredAt,
    metadata: logMetadata(line, context, eventName)
  };
  assignOptional(event, "role", role);
  return event;
}

function parseLine(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function logEventName(parsed: Record<string, unknown>): string | undefined {
  return stringValue(parsed.event_name ?? parsed.eventName ?? parsed.hook ?? parsed.hook_name ?? parsed.lifecycle_event);
}

function linePayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const embedded = objectValue(parsed.payload ?? parsed.data ?? parsed.event);
  return embedded ? { ...parsed, ...embedded } : parsed;
}

function occurredAtValue(payload: Record<string, unknown>, fallback: string): string {
  return stringValue(payload.occurred_at ?? payload.timestamp ?? payload.time) ?? fallback;
}

function eventIdValue(payload: Record<string, unknown>): string | undefined {
  return stringValue(payload.id ?? payload.event_id ?? payload.eventId);
}

function assignCommonFields(event: AgentEvent, payload: Record<string, unknown>): void {
  assignOptional(event, "session_id", stringValue(payload.session_id ?? payload.sessionId));
  assignOptional(event, "conversation_id", stringValue(payload.conversation_id ?? payload.conversationId));
  assignOptional(event, "message_id", stringValue(payload.message_id ?? payload.messageId));
}

function logMetadata(
  line: string,
  context: {
    file: string;
    lineNumber: number;
  },
  eventName?: string
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: "log_watcher",
    file: context.file,
    line: context.lineNumber,
    raw: line
  };
  assignOptional(metadata, "event_name", eventName);
  return metadata;
}

function stableLogEventId(file: string, lineNumber: number, line: string): string {
  const hash = createHash("sha256").update(`${file}:${lineNumber}:${line}`).digest("hex").slice(0, 16);
  return `log_${hash}`;
}

function eventTypeValue(value: unknown): AgentEventType | undefined {
  return typeof value === "string" && isAgentEventType(value) ? value : undefined;
}

function isAgentEventType(value: string): value is AgentEventType {
  return [
    "session_start",
    "session_end",
    "user_message",
    "assistant_message",
    "tool_call",
    "tool_result",
    "agent_end",
    "subagent_end",
    "manual_note"
  ].includes(value);
}

function roleValue(value: unknown): AgentEvent["role"] | undefined {
  return value === "user" || value === "assistant" || value === "tool" || value === "system" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

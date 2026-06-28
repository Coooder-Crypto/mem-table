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
      const event = lineToEvent(line, {
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

function lineToEvent(
  line: string,
  context: {
    agent: AgentName;
    file: string;
    lineNumber: number;
    fallbackOccurredAt: string;
  }
): AgentEvent {
  const parsed = parseLine(line);
  const occurredAt = stringValue(parsed.occurred_at ?? parsed.timestamp ?? parsed.time) ?? context.fallbackOccurredAt;
  const eventType = eventTypeValue(parsed.event_type ?? parsed.type) ?? "user_message";
  const content = stringValue(parsed.content ?? parsed.message ?? parsed.text ?? parsed.output) ?? line;

  const event: AgentEvent = {
    id: stringValue(parsed.id) ?? stableLogEventId(context.file, context.lineNumber, line),
    agent: context.agent,
    event_type: eventType,
    role: roleValue(parsed.role) ?? (eventType === "tool_result" ? "tool" : "user"),
    content,
    occurred_at: occurredAt,
    metadata: {
      source: "log_watcher",
      file: context.file,
      line: context.lineNumber,
      raw: line
    }
  };
  assignOptional(event, "session_id", stringValue(parsed.session_id ?? parsed.sessionId));
  assignOptional(event, "conversation_id", stringValue(parsed.conversation_id ?? parsed.conversationId));
  assignOptional(event, "message_id", stringValue(parsed.message_id ?? parsed.messageId));
  assignOptional(event, "tool_name", stringValue(parsed.tool_name ?? parsed.toolName));
  assignOptional(event, "tool_input", parsed.tool_input ?? parsed.input);
  assignOptional(event, "tool_output", parsed.tool_output ?? parsed.output);
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

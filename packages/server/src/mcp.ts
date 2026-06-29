import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { MemTableRuntime, type AgentEvent } from "@memtable/core";
import {
  commitAllProposals,
  listFilteredProposals,
  proposalStatusValue,
  rejectAllProposals,
  stringFilterValue
} from "./proposal-review.js";

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface McpStdioOptions {
  runtime?: MemTableRuntime;
  storagePath?: string;
  input?: Readable;
  output?: Writable;
}

const TOOL_DEFINITIONS = [
  {
    name: "memtable.observe",
    description: "Observe an agent event and create structured proposals when installed packs match.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["agent", "event_type", "occurred_at"],
      properties: {
        agent: { type: "string" },
        event_type: { type: "string" },
        content: { type: "string" },
        occurred_at: { type: "string" }
      }
    }
  },
  {
    name: "memtable.ask",
    description: "Ask the structured ledger a natural language data question.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string" }
      }
    }
  },
  {
    name: "memtable.query",
    description: "Run a query template or structured query against the ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        template: { type: "string" },
        query: { type: "object" }
      }
    }
  },
  {
    name: "memtable.proposal.list",
    description: "List structured ledger proposals.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        schema: { type: "string" }
      }
    }
  },
  {
    name: "memtable.proposal.show",
    description: "Show a proposal with its source and audit log.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    }
  },
  {
    name: "memtable.proposal.commit",
    description: "Commit a proposal into a record.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    }
  },
  {
    name: "memtable.proposal.commit_all",
    description: "Commit matching pending MemTable proposals into records.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        schema: { type: "string" }
      }
    }
  },
  {
    name: "memtable.proposal.reject",
    description: "Reject a proposal.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    }
  },
  {
    name: "memtable.proposal.reject_all",
    description: "Reject matching pending MemTable proposals.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        schema: { type: "string" }
      }
    }
  },
  {
    name: "memtable.record.show",
    description: "Show a committed record with its source and audit log.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    }
  },
  {
    name: "memtable.pack.list",
    description: "List installed MemTable packs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "memtable.schema.list",
    description: "List registered MemTable schemas.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  }
] as const;

export async function handleMcpRequest(runtime: MemTableRuntime, request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  if (request.id === undefined) {
    return undefined;
  }

  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "memtable",
          version: "0.0.0"
        }
      });
    }

    if (request.method === "tools/list") {
      return response(request.id, {
        tools: TOOL_DEFINITIONS
      });
    }

    if (request.method === "tools/call") {
      const params = request.params as { name?: unknown; arguments?: unknown };
      if (typeof params?.name !== "string") {
        return errorResponse(request.id, -32602, "tools/call requires a tool name");
      }
      const result = await callTool(runtime, params.name, params.arguments);
      return response(request.id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    }

    return errorResponse(request.id, -32601, `Unknown MCP method: ${request.method}`);
  } catch (error) {
    return errorResponse(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

export async function startMcpStdioServer(options: McpStdioOptions = {}): Promise<void> {
  const ownsRuntime = !options.runtime;
  const runtime =
    options.runtime ??
    (await MemTableRuntime.open({
      storage: {
        driver: "sqlite",
        path: options.storagePath ?? ".memtable/memtable.db"
      }
    }));
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const lines = createInterface({ input });

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const request = JSON.parse(line) as JsonRpcRequest;
      const result = await handleMcpRequest(runtime, request);
      if (result) {
        output.write(`${JSON.stringify(result)}\n`);
      }
    }
  } finally {
    if (ownsRuntime) {
      runtime.close();
    }
  }
}

async function callTool(runtime: MemTableRuntime, name: string, input: unknown): Promise<unknown> {
  const args = isObject(input) ? input : {};

  switch (name) {
    case "memtable.observe":
      return runtime.observe(args as unknown as AgentEvent);
    case "memtable.ask":
      return runtime.ask(requiredString(args, "question"));
    case "memtable.query":
      return typeof args.template === "string"
        ? runtime.queryTemplate(args.template)
        : runtime.query(args.query as Parameters<typeof runtime.query>[0]);
    case "memtable.proposal.list":
      return listFilteredProposals(runtime, {
        status: proposalStatusValue(args.status),
        schema: stringFilterValue(args.schema)
      });
    case "memtable.proposal.show":
      return runtime.traceProposal(requiredString(args, "id"));
    case "memtable.proposal.commit":
      return runtime.commitProposal(requiredString(args, "id"), { actor: "mcp" });
    case "memtable.proposal.commit_all":
      return commitAllProposals(
        runtime,
        {
          status: proposalStatusValue(args.status),
          schema: stringFilterValue(args.schema)
        },
        "mcp"
      );
    case "memtable.proposal.reject":
      return runtime.rejectProposal(requiredString(args, "id"), { actor: "mcp" });
    case "memtable.proposal.reject_all":
      return rejectAllProposals(
        runtime,
        {
          status: proposalStatusValue(args.status),
          schema: stringFilterValue(args.schema)
        },
        "mcp"
      );
    case "memtable.record.show":
      return runtime.traceRecord(requiredString(args, "id"));
    case "memtable.pack.list":
      return runtime.listPacks();
    case "memtable.schema.list":
      return runtime.listSchemas();
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

function response(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function requiredString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${field}`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

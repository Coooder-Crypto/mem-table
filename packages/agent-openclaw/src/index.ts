export interface OpenClawMemTableConfig {
  endpoint: string;
  observe: boolean;
}

export interface OpenClawPluginApi {
  registerTool(tool: OpenClawTool): void;
  on(eventName: string, handler: (event: unknown) => Promise<void> | void): void;
}

export interface OpenClawTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(id: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface AgentEvent {
  agent: "openclaw";
  event_type: "session_start" | "session_end" | "user_message" | "assistant_message" | "tool_result" | "agent_end";
  session_id?: string;
  conversation_id?: string;
  message_id?: string;
  role?: "user" | "assistant" | "tool" | "system";
  content?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  occurred_at: string;
  metadata?: Record<string, unknown>;
}

export const defaultOpenClawMemTableConfig: OpenClawMemTableConfig = {
  endpoint: "http://127.0.0.1:3838",
  observe: true
};

export function registerMemTableOpenClawPlugin(
  api: OpenClawPluginApi,
  config: Partial<OpenClawMemTableConfig> = {}
): OpenClawMemTableConfig {
  const resolvedConfig = {
    ...defaultOpenClawMemTableConfig,
    ...config
  };

  registerTools(api, resolvedConfig);
  if (resolvedConfig.observe) {
    registerHooks(api, resolvedConfig);
  }

  return resolvedConfig;
}

export function mapOpenClawEvent(eventName: string, event: unknown): AgentEvent | undefined {
  const payload = isObject(event) ? event : {};
  const occurred_at = new Date().toISOString();

  if (eventName === "message_received") {
    const event: AgentEvent = {
      agent: "openclaw",
      event_type: "user_message",
      role: "user",
      occurred_at
    };
    assignOptional(event, "content", stringValue(payload.content ?? payload.message ?? payload.text));
    return withOptionalFields(event, payload);
  }

  if (eventName === "message_sent" || eventName === "llm_output") {
    const event: AgentEvent = {
      agent: "openclaw",
      event_type: "assistant_message",
      role: "assistant",
      occurred_at
    };
    assignOptional(event, "content", stringValue(payload.content ?? payload.message ?? payload.output));
    return withOptionalFields(event, payload);
  }

  if (eventName === "after_tool_call" || eventName === "tool_result_persist") {
    const event: AgentEvent = {
      agent: "openclaw",
      event_type: "tool_result",
      role: "tool",
      occurred_at
    };
    assignOptional(event, "tool_name", stringValue(payload.toolName ?? payload.tool_name ?? payload.name));
    assignOptional(event, "tool_input", payload.params ?? payload.input);
    assignOptional(event, "tool_output", payload.result ?? payload.output);
    return withOptionalFields(event, payload);
  }

  if (eventName === "agent_end") {
    const event: AgentEvent = {
      agent: "openclaw",
      event_type: "agent_end",
      occurred_at
    };
    assignOptional(event, "content", stringValue(payload.output ?? payload.content ?? payload.message));
    return withOptionalFields(event, payload);
  }

  if (eventName === "session_start") {
    return withOptionalFields(
      {
        agent: "openclaw",
        event_type: "session_start",
        occurred_at
      },
      payload
    );
  }

  if (eventName === "session_end") {
    return withOptionalFields(
      {
        agent: "openclaw",
        event_type: "session_end",
        occurred_at
      },
      payload
    );
  }

  return undefined;
}

function registerTools(api: OpenClawPluginApi, config: OpenClawMemTableConfig): void {
  api.registerTool({
    name: "memtable_ask",
    description: "Ask MemTable structured ledger a data question.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string" }
      }
    },
    execute: async (_id, params) => postJson(config.endpoint, "/v1/ask", params)
  });

  api.registerTool({
    name: "memtable_propose",
    description: "Observe an OpenClaw event and create MemTable proposals.",
    parameters: {
      type: "object",
      additionalProperties: true
    },
    execute: async (_id, params) =>
      postJson(config.endpoint, "/v1/observe", {
        agent: "openclaw",
        event_type: "manual_note",
        content: typeof params.content === "string" ? params.content : JSON.stringify(params),
        occurred_at: new Date().toISOString(),
        metadata: params
      })
  });

  api.registerTool({
    name: "memtable_list_proposals",
    description: "List pending MemTable proposals.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" }
      }
    },
    execute: async (_id, params) => getJson(config.endpoint, `/v1/proposals${queryString(params)}`)
  });

  api.registerTool({
    name: "memtable_commit_proposal",
    description: "Commit a MemTable proposal into a record.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" }
      }
    },
    execute: async (_id, params) => postJson(config.endpoint, `/v1/proposals/${requiredString(params, "id")}/commit`, {})
  });
}

function registerHooks(api: OpenClawPluginApi, config: OpenClawMemTableConfig): void {
  for (const eventName of ["message_received", "after_tool_call", "agent_end", "session_start", "session_end"]) {
    api.on(eventName, async (event) => {
      const agentEvent = mapOpenClawEvent(eventName, event);
      if (!agentEvent) {
        return;
      }
      await observe(config.endpoint, agentEvent);
    });
  }
}

async function observe(endpoint: string, event: AgentEvent): Promise<void> {
  try {
    await postJson(endpoint, "/v1/observe", event);
  } catch {
    // OpenClaw execution should not fail just because the MemTable sidecar is unavailable.
  }
}

async function postJson(endpoint: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return response.json() as Promise<unknown>;
}

async function getJson(endpoint: string, path: string): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`);
  return response.json() as Promise<unknown>;
}

function withOptionalFields(event: AgentEvent, payload: Record<string, unknown>): AgentEvent {
  assignOptional(event, "session_id", stringValue(payload.sessionId ?? payload.session_id));
  assignOptional(event, "conversation_id", stringValue(payload.conversationId ?? payload.conversation_id));
  assignOptional(event, "message_id", stringValue(payload.messageId ?? payload.message_id));
  assignOptional(event, "metadata", payload);
  return event;
}

function queryString(params: Record<string, unknown>): string {
  if (typeof params.status === "string") {
    return `?status=${encodeURIComponent(params.status)}`;
  }
  return "";
}

function requiredString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${field}`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function assignOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

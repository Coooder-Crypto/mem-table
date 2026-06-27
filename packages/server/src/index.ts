import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MemTableRuntime, type AgentEvent } from "@memtable/core";

export interface ServerOptions {
  http?: boolean;
  mcp?: boolean;
  port?: number;
  host?: string;
  storagePath?: string;
  runtime?: MemTableRuntime;
}

export function describeServer(options: ServerOptions = {}): string {
  const modes = [
    options.http ? "http" : undefined,
    options.mcp ? "mcp" : undefined
  ].filter(Boolean);

  return `memtable server modes: ${modes.length > 0 ? modes.join(",") : "none"}`;
}

export interface HttpServerHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export interface HttpRequestInput {
  method: string;
  url: string;
  body?: unknown;
}

export interface HttpResponseOutput {
  statusCode: number;
  body: unknown;
}

export async function startHttpServer(options: ServerOptions = {}): Promise<HttpServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3838;
  const ownsRuntime = !options.runtime;
  const runtime =
    options.runtime ??
    (await MemTableRuntime.open({
      storage: {
        driver: "sqlite",
        path: options.storagePath ?? ".memtable/memtable.db"
      }
    }));

  const server = createServer((request, response) => {
    void handleNodeRequest(runtime, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    server,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (ownsRuntime) {
        runtime.close();
      }
    }
  };
}

export async function handleHttpRequest(runtime: MemTableRuntime, request: HttpRequestInput): Promise<HttpResponseOutput> {
  try {
    const url = new URL(request.url, "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      return { statusCode: 200, body: { status: "ok" } };
    }

    if (request.method === "POST" && url.pathname === "/v1/observe") {
      const result = await runtime.observe(request.body as AgentEvent);
      return { statusCode: 200, body: result };
    }

    if (request.method === "POST" && url.pathname === "/v1/query") {
      const body = request.body as { query?: unknown; template?: unknown };
      const result =
        typeof body.template === "string"
          ? await runtime.queryTemplate(body.template)
          : await runtime.query(body.query as Parameters<typeof runtime.query>[0]);
      return { statusCode: 200, body: result };
    }

    if (request.method === "POST" && url.pathname === "/v1/ask") {
      const body = request.body as { question?: unknown };
      if (typeof body.question !== "string") {
        return { statusCode: 400, body: { error: "question must be a string" } };
      }
      const result = await runtime.ask(body.question);
      return { statusCode: 200, body: result };
    }

    if (request.method === "GET" && url.pathname === "/v1/proposals") {
      const status = url.searchParams.get("status") ?? undefined;
      const proposals = await runtime.listProposals(status as Parameters<typeof runtime.listProposals>[0]);
      return { statusCode: 200, body: proposals };
    }

    const commitMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/commit$/);
    if (request.method === "POST" && commitMatch?.[1]) {
      const record = await runtime.commitProposal(decodeURIComponent(commitMatch[1]), { actor: "http" });
      return { statusCode: 200, body: record };
    }

    const rejectMatch = url.pathname.match(/^\/v1\/proposals\/([^/]+)\/reject$/);
    if (request.method === "POST" && rejectMatch?.[1]) {
      const proposal = await runtime.rejectProposal(decodeURIComponent(rejectMatch[1]), { actor: "http" });
      return { statusCode: 200, body: proposal };
    }

    return { statusCode: 404, body: { error: "not_found" } };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function handleNodeRequest(
  runtime: MemTableRuntime,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = request.method === "POST" ? await readJson(request) : undefined;
  const output = await handleHttpRequest(runtime, {
    method: request.method ?? "GET",
    url: request.url ?? "/",
    ...(body !== undefined ? { body } : {})
  });
  writeJson(response, output.statusCode, output.body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemTableRuntime } from "@memtable/core";
import { startHttpServer, startMcpStdioServer } from "@memtable/server";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "init") {
    await init();
  } else if (command === "pack") {
    await pack(args.slice(1));
  } else if (command === "schema") {
    await schema(args.slice(1));
  } else if (command === "query-template") {
    await queryTemplate(args.slice(1));
  } else if (command === "query") {
    await query(args.slice(1));
  } else if (command === "ask") {
    await ask(args.slice(1));
  } else if (command === "serve") {
    await serve(args.slice(1));
  } else if (command === "agent") {
    await agent(args.slice(1));
  } else if (command === "proposal") {
    await proposal(args.slice(1));
  } else if (command === "record") {
    await record(args.slice(1));
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`memtable commands:
  init
  pack install <path>
  pack list
  schema list
  query-template list
  query <template_name>
  ask <question>
  serve --http [--port 3838]
  serve --mcp
  agent enable hermes [--endpoint http://127.0.0.1:3838]
  agent enable openclaw [--endpoint http://127.0.0.1:3838]
  proposal list [status]
  proposal commit <id>
  proposal reject <id>
  record list [schema_name]`);
}

async function init(): Promise<void> {
  const dbPath = ".memtable/memtable.db";
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(
    ".memtable/config.json",
    `${JSON.stringify(
      {
        storage: {
          driver: "sqlite",
          path: dbPath
        },
        packsDir: ".memtable/packs"
      },
      null,
      2
    )}\n`
  );

  const runtime = await openRuntime();
  runtime.close();
  console.log(`Initialized MemTable at ${dbPath}`);
}

async function serve(args: string[]): Promise<void> {
  const http = args.includes("--http");
  const mcp = args.includes("--mcp");
  if (!http && !mcp) {
    throw new Error("Expected --http or --mcp serve mode");
  }
  if (http && mcp) {
    throw new Error("Use one serve mode at a time");
  }

  if (mcp) {
    console.error("MemTable MCP server listening on stdio");
    await startMcpStdioServer({
      storagePath: ".memtable/memtable.db"
    });
    return;
  }

  const port = Number(readFlag(args, "--port") ?? "3838");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port value: ${String(readFlag(args, "--port"))}`);
  }

  const handle = await startHttpServer({
    http: true,
    port,
    storagePath: ".memtable/memtable.db"
  });
  console.log(`MemTable HTTP observer listening at ${handle.url}`);

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

async function agent(args: string[]): Promise<void> {
  const subcommand = args[0];
  const agentName = args[1];
  if (subcommand !== "enable") {
    throw new Error(`Unknown agent command: ${subcommand ?? ""}`);
  }

  const endpoint = readFlag(args, "--endpoint") ?? "http://127.0.0.1:3838";
  if (agentName === "hermes") {
    await writeAgentConfig({
      agent: "hermes",
      endpoint,
      packageName: "@memtable/agent-hermes",
      pluginId: "memtable",
      install: [
        "npm install -g @memtable/agent-hermes",
        "hermes plugins install Coooder-Crypto/memtable-hermes --enable",
        "hermes gateway restart"
      ]
    });
    console.log(`Configured Hermes enhancer at ${endpoint}`);
    console.log("Install with: hermes plugins install Coooder-Crypto/memtable-hermes --enable");
    return;
  }

  if (agentName === "openclaw") {
    await writeAgentConfig({
      agent: "openclaw",
      endpoint,
      packageName: "@memtable/openclaw-plugin",
      pluginId: "memtable",
      install: [
        "openclaw plugins install npm:@memtable/openclaw-plugin",
        "openclaw plugins enable memtable",
        "openclaw gateway restart"
      ]
    });
    console.log(`Configured OpenClaw enhancer at ${endpoint}`);
    console.log("Install with: openclaw plugins install npm:@memtable/openclaw-plugin");
    return;
  }

  throw new Error(`Unsupported agent enhancer: ${agentName ?? ""}`);
}

async function writeAgentConfig(input: {
  agent: string;
  endpoint: string;
  packageName: string;
  pluginId: string;
  install: string[];
}): Promise<void> {
  if (!input.agent) {
    throw new Error("Missing agent enhancer name");
  }

  await mkdir(".memtable/agents", { recursive: true });
  await writeFile(
    `.memtable/agents/${input.agent}.json`,
    `${JSON.stringify(
      {
        agent: input.agent,
        endpoint: input.endpoint,
        package: input.packageName,
        pluginId: input.pluginId,
        enabledAt: new Date().toISOString(),
        install: input.install
      },
      null,
      2
    )}\n`
  );
}

async function pack(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  const runtime = await openRuntime();
  try {
    if (subcommand === "install") {
      const sourcePath = requiredArg(args[1], "pack path");
      const result = await runtime.installPack(sourcePath);
      printJson(result);
    } else if (subcommand === "list") {
      const packs = await runtime.listPacks();
      printJson(packs);
    } else {
      throw new Error(`Unknown pack command: ${subcommand}`);
    }
  } finally {
    runtime.close();
  }
}

async function schema(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  if (subcommand !== "list") {
    throw new Error(`Unknown schema command: ${subcommand}`);
  }

  const runtime = await openRuntime();
  try {
    const schemas = await runtime.listSchemas();
    printJson(schemas);
  } finally {
    runtime.close();
  }
}

async function queryTemplate(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  if (subcommand !== "list") {
    throw new Error(`Unknown query-template command: ${subcommand}`);
  }

  const runtime = await openRuntime();
  try {
    const templates = await runtime.listQueryTemplates();
    printJson(templates);
  } finally {
    runtime.close();
  }
}

async function query(args: string[]): Promise<void> {
  const templateName = requiredArg(args[0], "query template name");
  const runtime = await openRuntime();
  try {
    const result = await runtime.queryTemplate(templateName);
    printJson(result);
  } finally {
    runtime.close();
  }
}

async function ask(args: string[]): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    throw new Error("Missing question");
  }

  const runtime = await openRuntime();
  try {
    const result = await runtime.ask(question);
    printJson(result);
  } finally {
    runtime.close();
  }
}

async function proposal(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  const runtime = await openRuntime();
  try {
    if (subcommand === "list") {
      const status = args[1] as Parameters<typeof runtime.listProposals>[0];
      const proposals = await runtime.listProposals(status);
      printJson(proposals);
    } else if (subcommand === "commit") {
      const id = requiredArg(args[1], "proposal id");
      const record = await runtime.commitProposal(id, { actor: "cli" });
      printJson(record);
    } else if (subcommand === "reject") {
      const id = requiredArg(args[1], "proposal id");
      const rejected = await runtime.rejectProposal(id, { actor: "cli" });
      printJson(rejected);
    } else {
      throw new Error(`Unknown proposal command: ${subcommand}`);
    }
  } finally {
    runtime.close();
  }
}

async function record(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  if (subcommand !== "list") {
    throw new Error(`Unknown record command: ${subcommand}`);
  }

  const runtime = await openRuntime();
  try {
    const records = await runtime.listRecords(args[1]);
    printJson(records);
  } finally {
    runtime.close();
  }
}

async function openRuntime(): Promise<MemTableRuntime> {
  return MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: ".memtable/memtable.db"
    }
  });
}

function requiredArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

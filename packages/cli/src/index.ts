#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
  } else if (command === "doctor") {
    await doctor(args.slice(1));
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
  doctor [--endpoint http://127.0.0.1:3838]
  agent enable hermes [--endpoint http://127.0.0.1:3838]
  agent enable openclaw [--endpoint http://127.0.0.1:3838]
  agent doctor hermes [--endpoint http://127.0.0.1:3838]
  agent doctor openclaw [--endpoint http://127.0.0.1:3838]
  proposal list [status]
  proposal show <id>
  proposal commit <id>
  proposal reject <id>
  record list [schema_name]
  record show <id>`);
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

type DoctorStatus = "ok" | "warn" | "error";

interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  fix?: string;
}

interface DoctorReport {
  status: DoctorStatus;
  checks: DoctorCheck[];
}

async function doctor(args: string[]): Promise<void> {
  const endpoint = readFlag(args, "--endpoint") ?? "http://127.0.0.1:3838";
  const checks: DoctorCheck[] = [];

  checks.push(await fileCheck("config", ".memtable/config.json", "Run `memtable init`."));
  checks.push(await fileCheck("sqlite_database", ".memtable/memtable.db", "Run `memtable init`."));

  if (await fileExists(".memtable/memtable.db")) {
    const runtime = await openRuntime();
    try {
      const packs = await runtime.listPacks();
      checks.push({
        name: "runtime",
        status: "ok",
        message: "SQLite runtime opened successfully."
      });
      checks.push(
        packs.some((pack) => pack.name === "fitness")
          ? {
              name: "fitness_pack",
              status: "ok",
              message: "fitness pack is installed."
            }
          : {
              name: "fitness_pack",
              status: "warn",
              message: "fitness pack is not installed.",
              fix: "Run `memtable pack install packs/fitness`."
            }
      );
    } catch (error) {
      checks.push({
        name: "runtime",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        fix: "Check `.memtable/memtable.db` or rerun `memtable init`."
      });
    } finally {
      runtime.close();
    }
  } else {
    checks.push({
      name: "runtime",
      status: "error",
      message: "SQLite runtime cannot be opened because `.memtable/memtable.db` is missing.",
      fix: "Run `memtable init`."
    });
    checks.push({
      name: "fitness_pack",
      status: "warn",
      message: "fitness pack cannot be checked before MemTable is initialized.",
      fix: "Run `memtable init` then `memtable pack install packs/fitness`."
    });
  }

  checks.push(await httpHealthCheck(endpoint));
  printJson({
    status: reportStatus(checks),
    checks
  } satisfies DoctorReport);
}

async function fileCheck(name: string, path: string, fix: string): Promise<DoctorCheck> {
  if (await fileExists(path)) {
    return {
      name,
      status: "ok",
      message: `${path} exists.`
    };
  }

  return {
    name,
    status: "error",
    message: `${path} is missing.`,
    fix
  };
}

async function httpHealthCheck(endpoint: string): Promise<DoctorCheck> {
  try {
    const response = await fetchWithTimeout(`${endpoint.replace(/\/$/, "")}/health`, 2000);
    if (!response.ok) {
      return {
        name: "http_sidecar",
        status: "error",
        message: `HTTP sidecar returned ${response.status}.`,
        fix: "Run `memtable serve --http`."
      };
    }
    const body = (await response.json()) as { status?: unknown };
    return body.status === "ok"
      ? {
          name: "http_sidecar",
          status: "ok",
          message: `HTTP sidecar is reachable at ${endpoint}.`
        }
      : {
          name: "http_sidecar",
          status: "warn",
          message: `HTTP sidecar responded, but health payload was unexpected.`,
          fix: "Restart with `memtable serve --http`."
        };
  } catch {
    return {
      name: "http_sidecar",
      status: "warn",
      message: `HTTP sidecar is not reachable at ${endpoint}.`,
      fix: "Run `memtable serve --http`."
    };
  }
}

async function agent(args: string[]): Promise<void> {
  const subcommand = args[0];
  const agentName = args[1];
  if (subcommand === "doctor") {
    await agentDoctor(args);
    return;
  }

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

interface AgentConfig {
  agent?: unknown;
  endpoint?: unknown;
  package?: unknown;
  pluginId?: unknown;
  install?: unknown;
}

async function agentDoctor(args: string[]): Promise<void> {
  const agentName = supportedAgentName(requiredArg(args[1], "agent name"));
  const configPath = `.memtable/agents/${agentName}.json`;
  const checks: DoctorCheck[] = [];
  const config = await readAgentConfig(configPath, checks, agentName);
  const expectedPackage = agentName === "hermes" ? "@memtable/agent-hermes" : "@memtable/openclaw-plugin";
  const expectedInstallCommand =
    agentName === "hermes"
      ? "hermes plugins install Coooder-Crypto/memtable-hermes --enable"
      : "openclaw plugins install npm:@memtable/openclaw-plugin";

  if (config) {
    checks.push(
      config.agent === agentName
        ? {
            name: "agent_name",
            status: "ok",
            message: `Agent config targets ${agentName}.`
          }
        : {
            name: "agent_name",
            status: "error",
            message: `Agent config has unexpected agent value: ${String(config.agent)}.`,
            fix: `Run \`memtable agent enable ${agentName}\`.`
          }
    );

    checks.push(
      config.package === expectedPackage
        ? {
            name: "agent_package",
            status: "ok",
            message: `Agent package is ${expectedPackage}.`
          }
        : {
            name: "agent_package",
            status: "warn",
            message: `Agent package is not ${expectedPackage}.`,
            fix: `Run \`memtable agent enable ${agentName}\`.`
          }
    );

    checks.push(
      config.pluginId === "memtable"
        ? {
            name: "plugin_id",
            status: "ok",
            message: "Plugin id is memtable."
          }
        : {
            name: "plugin_id",
            status: "warn",
            message: `Plugin id is unexpected: ${String(config.pluginId)}.`,
            fix: `Run \`memtable agent enable ${agentName}\`.`
          }
    );

    const install = Array.isArray(config.install) ? config.install : [];
    checks.push(
      install.includes(expectedInstallCommand)
        ? {
            name: "install_hint",
            status: "ok",
            message: "Install command is recorded."
          }
        : {
            name: "install_hint",
            status: "warn",
            message: "Expected install command is missing from agent config.",
            fix: expectedInstallCommand
          }
    );
  }

  const endpoint = readFlag(args, "--endpoint") ?? stringValue(config?.endpoint) ?? "http://127.0.0.1:3838";
  checks.push(await httpHealthCheck(endpoint));
  printJson({
    status: reportStatus(checks),
    agent: agentName,
    checks
  });
}

async function readAgentConfig(
  configPath: string,
  checks: DoctorCheck[],
  agentName: "hermes" | "openclaw"
): Promise<AgentConfig | undefined> {
  if (!(await fileExists(configPath))) {
    checks.push({
      name: "agent_config",
      status: "error",
      message: `${configPath} is missing.`,
      fix: `Run \`memtable agent enable ${agentName}\`.`
    });
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    if (!isObject(parsed)) {
      checks.push({
        name: "agent_config",
        status: "error",
        message: `${configPath} does not contain a JSON object.`,
        fix: `Run \`memtable agent enable ${agentName}\`.`
      });
      return undefined;
    }
    checks.push({
      name: "agent_config",
      status: "ok",
      message: `${configPath} exists.`
    });
    return parsed;
  } catch (error) {
    checks.push({
      name: "agent_config",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      fix: `Run \`memtable agent enable ${agentName}\`.`
    });
    return undefined;
  }
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
    } else if (subcommand === "show") {
      const id = requiredArg(args[1], "proposal id");
      printJson(await runtime.traceProposal(id));
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
  const runtime = await openRuntime();
  try {
    if (subcommand === "list") {
      const records = await runtime.listRecords(args[1]);
      printJson(records);
    } else if (subcommand === "show") {
      const id = requiredArg(args[1], "record id");
      printJson(await runtime.traceRecord(id));
    } else {
      throw new Error(`Unknown record command: ${subcommand}`);
    }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function reportStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "ok";
}

function supportedAgentName(value: string): "hermes" | "openclaw" {
  if (value === "hermes" || value === "openclaw") {
    return value;
  }
  throw new Error(`Unsupported agent enhancer: ${value}`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

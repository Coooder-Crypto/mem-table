#!/usr/bin/env node

import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { followLogs, MemTableRuntime, watchLogs, type AgentName } from "@memtable/core";
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
  } else if (command === "watch") {
    await watch(args.slice(1));
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
  watch <path> --agent <hermes|openclaw|custom> [--follow] [--interval-ms 1000]
  serve --http [--port 3838]
  serve --mcp
  doctor [--endpoint http://127.0.0.1:3838]
  agent enable hermes [--endpoint http://127.0.0.1:3838]
  agent enable openclaw [--endpoint http://127.0.0.1:3838]
  agent install hermes --local [--hermes-home ~/.hermes] [--endpoint http://127.0.0.1:3838]
  agent doctor hermes [--endpoint http://127.0.0.1:3838]
  agent doctor openclaw [--endpoint http://127.0.0.1:3838]
  proposal list [status] [--schema <schema_name>]
  proposal show <id>
  proposal commit <id|--all> [--schema <schema_name>]
  proposal reject <id|--all> [--schema <schema_name>]
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

interface AgentDoctorReport extends DoctorReport {
  agent: "hermes" | "openclaw";
  watch: AgentWatchSuggestion;
}

interface AgentWatchSuggestion {
  mode: "log_watch";
  agent: "hermes" | "openclaw";
  path: string;
  command: string;
  interval_ms: number;
  candidates: AgentWatchCandidate[];
  note: string;
}

interface AgentWatchCandidate {
  path: string;
  exists: boolean;
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
  if (subcommand === "install") {
    await agentInstall(args);
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
        "memtable agent install hermes --local",
        "hermes gateway restart"
      ]
    });
    console.log(`Configured Hermes enhancer at ${endpoint}`);
    console.log("Install with: memtable agent install hermes --local");
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

async function agentInstall(args: string[]): Promise<void> {
  const agentName = supportedAgentName(requiredArg(args[1], "agent name"));
  if (agentName !== "hermes") {
    throw new Error(`Local installer is not available for ${agentName}`);
  }
  if (!args.includes("--local")) {
    throw new Error("Hermes installer currently requires --local");
  }

  const endpoint = readFlag(args, "--endpoint") ?? "http://127.0.0.1:3838";
  const hermesHome = hermesHomePath(args);
  const pluginDir = join(hermesHome, "plugins", "memtable");
  const sourceDir = hermesPluginSourceDir();

  await mkdir(dirname(pluginDir), { recursive: true });
  await rm(pluginDir, { recursive: true, force: true });
  await cp(sourceDir, pluginDir, {
    recursive: true,
    filter: (source) => !source.includes("__pycache__") && !source.endsWith(".pyc")
  });
  await enableHermesPlugin(hermesHome, "memtable");
  await writeAgentConfig({
    agent: "hermes",
    endpoint,
    packageName: "@memtable/agent-hermes",
    pluginId: "memtable",
    install: ["memtable agent install hermes --local", "hermes gateway restart"]
  });

  printJson({
    status: "ok",
    agent: "hermes",
    hermes_home: hermesHome,
    plugin_dir: pluginDir,
    enabled: true,
    next_steps: [
      "node packages/cli/dist/index.js serve --http",
      "hermes gateway restart",
      "node packages/cli/dist/index.js agent doctor hermes"
    ]
  });
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
      ? "memtable agent install hermes --local"
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
  if (agentName === "hermes") {
    checks.push(...(await hermesInstallChecks(hermesHomePath(args))));
  }
  const watchSuggestion = await agentWatchSuggestion(agentName);
  checks.push(watchPathCheck(watchSuggestion));
  printJson({
    status: reportStatus(checks),
    agent: agentName,
    watch: watchSuggestion,
    checks
  } satisfies AgentDoctorReport);
}

async function agentWatchSuggestion(agentName: "hermes" | "openclaw"): Promise<AgentWatchSuggestion> {
  const candidates = await Promise.all(
    agentLogCandidatePaths(agentName).map(async (path) => ({
      path,
      exists: await fileExists(expandHome(path))
    }))
  );
  const selected = candidates.find((candidate) => candidate.exists) ?? candidates[0];
  const path = selected?.path ?? (agentName === "hermes" ? "~/.hermes/logs" : "~/.openclaw/runs");
  const command = `memtable watch ${path} --agent ${agentName} --follow`;
  return {
    mode: "log_watch",
    agent: agentName,
    path,
    command,
    interval_ms: 1000,
    candidates,
    note: selected?.exists
      ? "Use this command for lightweight log-based ingestion without installing the native enhancer."
      : "No known log path was found. Use the command after confirming the agent log directory, or replace the path with your actual log directory."
  };
}

function watchPathCheck(suggestion: AgentWatchSuggestion): DoctorCheck {
  const found = suggestion.candidates.find((candidate) => candidate.exists);
  if (found) {
    return {
      name: "log_watch_path",
      status: "ok",
      message: `Detected log path ${found.path}.`,
      fix: suggestion.command
    };
  }

  return {
    name: "log_watch_path",
    status: "warn",
    message: "No known log path was detected for lightweight watch mode.",
    fix: suggestion.command
  };
}

function agentLogCandidatePaths(agentName: "hermes" | "openclaw"): string[] {
  if (agentName === "hermes") {
    return ["~/.hermes/logs", "~/.local/share/hermes/logs"];
  }
  return ["~/.openclaw/runs", "~/.openclaw/logs"];
}

function hermesHomePath(args: string[]): string {
  return expandHome(readFlag(args, "--hermes-home") ?? process.env.HERMES_HOME ?? "~/.hermes");
}

function hermesPluginSourceDir(): string {
  return fileURLToPath(new URL("../../agent-hermes/memtable_hermes", import.meta.url));
}

async function enableHermesPlugin(hermesHome: string, pluginName: string): Promise<void> {
  await mkdir(hermesHome, { recursive: true });
  const configPath = join(hermesHome, "config.yaml");
  const existing = (await fileExists(configPath)) ? await readFile(configPath, "utf8") : "";
  await writeFile(configPath, enablePluginInYaml(existing, pluginName));
}

function enablePluginInYaml(input: string, pluginName: string): string {
  if (pluginsEnabledListContains(input, pluginName)) {
    return input.endsWith("\n") ? input : `${input}\n`;
  }

  const lines = input.length > 0 ? input.replace(/\s+$/u, "").split(/\r?\n/) : [];
  const pluginsIndex = lines.findIndex((line) => line.trim() === "plugins:");
  if (pluginsIndex < 0) {
    return [...lines, "plugins:", "  enabled:", `    - ${pluginName}`, ""].join("\n");
  }

  const enabledIndex = findYamlChildKey(lines, pluginsIndex, "enabled");
  if (enabledIndex < 0) {
    lines.splice(pluginsIndex + 1, 0, "  enabled:", `    - ${pluginName}`);
    return `${lines.join("\n")}\n`;
  }

  lines.splice(enabledIndex + 1, 0, `    - ${pluginName}`);
  return `${lines.join("\n")}\n`;
}

function pluginsEnabledListContains(input: string, value: string): boolean {
  const lines = input.split(/\r?\n/);
  const pluginsIndex = lines.findIndex((line) => line.trim() === "plugins:");
  if (pluginsIndex < 0) {
    return false;
  }
  const enabledIndex = findYamlChildKey(lines, pluginsIndex, "enabled");
  if (enabledIndex < 0) {
    return false;
  }
  const enabledIndent = leadingSpaceCount(lines[enabledIndex] ?? "");
  for (let index = enabledIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      continue;
    }
    if (leadingSpaceCount(line) <= enabledIndent) {
      return false;
    }
    if (line.trim() === `- ${value}`) {
      return true;
    }
  }
  return false;
}

function findYamlChildKey(lines: string[], parentIndex: number, key: string): number {
  const parentIndent = leadingSpaceCount(lines[parentIndex] ?? "");
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      continue;
    }
    const indent = leadingSpaceCount(line);
    if (indent <= parentIndent) {
      return -1;
    }
    if (indent === parentIndent + 2 && line.trim() === `${key}:`) {
      return index;
    }
  }
  return -1;
}

function leadingSpaceCount(input: string): number {
  return input.length - input.trimStart().length;
}

async function hermesInstallChecks(hermesHome: string): Promise<DoctorCheck[]> {
  const pluginDir = join(hermesHome, "plugins", "memtable");
  const configPath = join(hermesHome, "config.yaml");
  const checks: DoctorCheck[] = [];

  checks.push(await fileCheck("hermes_plugin_dir", pluginDir, "Run `memtable agent install hermes --local`."));
  checks.push(await fileCheck("hermes_plugin_manifest", join(pluginDir, "plugin.yaml"), "Run `memtable agent install hermes --local`."));
  checks.push(await fileCheck("hermes_plugin_entrypoint", join(pluginDir, "__init__.py"), "Run `memtable agent install hermes --local`."));

  const config = (await fileExists(configPath)) ? await readFile(configPath, "utf8") : "";
  checks.push(
    pluginsEnabledListContains(config, "memtable")
      ? {
          name: "hermes_plugin_enabled",
          status: "ok",
          message: "Hermes config enables the memtable plugin."
        }
      : {
          name: "hermes_plugin_enabled",
          status: "error",
          message: "Hermes config does not enable the memtable plugin.",
          fix: "Run `memtable agent install hermes --local`."
        }
  );

  return checks;
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

async function watch(args: string[]): Promise<void> {
  const path = requiredArg(args[0], "log path");
  const agent = agentNameValue(readFlag(args, "--agent") ?? "custom");
  const follow = args.includes("--follow");
  const pollIntervalMs = Number(readFlag(args, "--interval-ms") ?? "1000");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(`Invalid --interval-ms value: ${String(readFlag(args, "--interval-ms"))}`);
  }

  const runtime = await openRuntime();
  try {
    if (follow) {
      const controller = new AbortController();
      process.once("SIGINT", () => {
        controller.abort();
      });
      process.once("SIGTERM", () => {
        controller.abort();
      });
      console.error(`MemTable watching ${path} for ${agent} logs every ${pollIntervalMs}ms`);
      await followLogs(runtime, {
        path,
        agent,
        pollIntervalMs,
        signal: controller.signal,
        onResult: printJson
      });
      return;
    }

    printJson(
      await watchLogs(runtime, {
        path,
        agent
      })
    );
  } finally {
    runtime.close();
  }
}

async function proposal(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  const runtime = await openRuntime();
  try {
    if (subcommand === "list") {
      const status = proposalStatusValue(readFlag(args, "--status") ?? positionalArg(args, 1));
      const proposals = await listFilteredProposals(runtime, {
        status,
        schema: readFlag(args, "--schema")
      });
      printJson(proposals);
    } else if (subcommand === "show") {
      const id = requiredArg(args[1], "proposal id");
      printJson(await runtime.traceProposal(id));
    } else if (subcommand === "commit") {
      if (args.includes("--all")) {
        printJson(
          await commitAllProposals(runtime, {
            status: proposalStatusValue(readFlag(args, "--status")),
            schema: readFlag(args, "--schema")
          })
        );
        return;
      }
      const id = requiredArg(args[1], "proposal id");
      const record = await runtime.commitProposal(id, { actor: "cli" });
      printJson(record);
    } else if (subcommand === "reject") {
      if (args.includes("--all")) {
        printJson(
          await rejectAllProposals(runtime, {
            status: proposalStatusValue(readFlag(args, "--status")),
            schema: readFlag(args, "--schema")
          })
        );
        return;
      }
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

type ProposalStatusFilter = Parameters<MemTableRuntime["listProposals"]>[0];

interface ProposalFilter {
  status: ProposalStatusFilter | undefined;
  schema: string | undefined;
}

interface BatchProposalResult<T> {
  action: "commit" | "reject";
  matched: number;
  processed: number;
  filters: {
    status: string | string[];
    schema?: string;
  };
  results: T[];
}

async function listFilteredProposals(
  runtime: MemTableRuntime,
  filter: ProposalFilter
): Promise<Awaited<ReturnType<MemTableRuntime["listProposals"]>>> {
  const proposals = await runtime.listProposals(filter.status);
  return filter.schema ? proposals.filter((proposal) => proposal.schema_name === filter.schema) : proposals;
}

async function commitAllProposals(
  runtime: MemTableRuntime,
  filter: ProposalFilter
): Promise<BatchProposalResult<Awaited<ReturnType<MemTableRuntime["commitProposal"]>>>> {
  const proposals = await reviewableProposals(runtime, filter);
  const records = [];
  for (const proposal of proposals) {
    records.push(await runtime.commitProposal(proposal.id, { actor: "cli" }));
  }

  return {
    action: "commit",
    matched: proposals.length,
    processed: records.length,
    filters: batchFilters(filter),
    results: records
  };
}

async function rejectAllProposals(
  runtime: MemTableRuntime,
  filter: ProposalFilter
): Promise<BatchProposalResult<Awaited<ReturnType<MemTableRuntime["rejectProposal"]>>>> {
  const proposals = await reviewableProposals(runtime, filter);
  const rejected = [];
  for (const proposal of proposals) {
    rejected.push(await runtime.rejectProposal(proposal.id, { actor: "cli" }));
  }

  return {
    action: "reject",
    matched: proposals.length,
    processed: rejected.length,
    filters: batchFilters(filter),
    results: rejected
  };
}

async function reviewableProposals(runtime: MemTableRuntime, filter: ProposalFilter): Promise<Awaited<ReturnType<MemTableRuntime["listProposals"]>>> {
  if (filter.status) {
    return listFilteredProposals(runtime, filter);
  }

  const proposals = await listFilteredProposals(runtime, {
    status: undefined,
    schema: filter.schema
  });
  return proposals.filter((proposal) => proposal.status === "pending" || proposal.status === "needs_review");
}

function batchFilters(filter: ProposalFilter): BatchProposalResult<unknown>["filters"] {
  return {
    status: filter.status ?? ["pending", "needs_review"],
    ...(filter.schema ? { schema: filter.schema } : {})
  };
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

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return `${homedir()}${path.slice(1)}`;
  }
  return path;
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

function agentNameValue(value: string): AgentName {
  if (value === "hermes" || value === "openclaw" || value === "custom") {
    return value;
  }
  throw new Error(`Unsupported agent: ${value}`);
}

function proposalStatusValue(value: string | undefined): ProposalStatusFilter {
  if (value === undefined) {
    return undefined;
  }
  if (value === "pending" || value === "needs_review" || value === "committed" || value === "rejected") {
    return value;
  }
  throw new Error(`Unsupported proposal status: ${value}`);
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

function positionalArg(args: string[], index: number): string | undefined {
  const value = args[index];
  return value && !value.startsWith("--") ? value : undefined;
}

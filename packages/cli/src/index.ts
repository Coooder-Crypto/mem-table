#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MemTableRuntime } from "@memtable/core";

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

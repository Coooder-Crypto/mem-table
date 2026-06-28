#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemTableRuntime } from "../packages/core/dist/index.js";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const demoDir = await mkdtemp(join(tmpdir(), "memtable-fitness-demo-"));
const dbPath = join(demoDir, "memtable.db");
const packPath = fileURLToPath(new URL("../packs/fitness", import.meta.url));

const runtime = await MemTableRuntime.open({
  storage: {
    driver: "sqlite",
    path: dbPath
  }
});

try {
  await writeFile(
    join(demoDir, "config.json"),
    `${JSON.stringify(
      {
        storage: {
          driver: "sqlite",
          path: dbPath
        },
        packsDir: join(demoDir, "packs")
      },
      null,
      2
    )}\n`
  );

  const install = await runtime.installPack(packPath);
  console.log(`Installed pack: ${install.pack.name}@${install.pack.version}`);

  const events = [
    {
      id: "demo_bench_1",
      agent: "custom",
      event_type: "user_message",
      role: "user",
      content: "4月1日卧推 60kg 5x5",
      occurred_at: "2026-04-01T10:00:00.000Z"
    },
    {
      id: "demo_bench_2",
      agent: "custom",
      event_type: "user_message",
      role: "user",
      content: "今天卧推 65kg 5x5，体重 90.4kg",
      occurred_at: "2026-06-27T10:00:00.000Z"
    }
  ];

  for (const event of events) {
    const result = await runtime.observe(event);
    console.log(`Observed ${event.id}: ${result.proposals_created} proposals`);
  }

  const proposals = await runtime.listProposals("pending");
  assert.equal(proposals.length, 3);

  for (const proposal of proposals) {
    const record = await runtime.commitProposal(proposal.id, { actor: "demo" });
    console.log(`Committed ${proposal.schema_name}: ${record.id}`);
  }

  const records = await runtime.listRecords();
  const answer = await runtime.ask("我最近三个月卧推进步了吗？");

  assert.equal(records.length, 3);
  assert.equal(answer.status, "ok");
  assert.match(answer.answer, /提升 5kg/);

  console.log("");
  console.log("Question: 我最近三个月卧推进步了吗？");
  console.log(`Answer: ${answer.answer}`);
  console.log("");
  console.log(`Demo database: ${dbPath}`);
  console.log(`Workspace: ${workspaceRoot}`);
} finally {
  runtime.close();
}

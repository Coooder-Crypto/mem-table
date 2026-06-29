import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { followLogs, MemTableRuntime, watchLogs } from "../dist/index.js";

test("runtime initializes sqlite and commits a proposal into a record", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });

  const proposal = await runtime.createProposal({
    schema_name: "fitness.workout",
    data: {
      exercise: "bench_press",
      weight_kg: 65,
      reps: 5,
      sets: 5,
      occurred_at: "2026-06-24T10:00:00.000Z"
    },
    source: {
      kind: "conversation",
      agent: "custom",
      event_type: "user_message",
      excerpt: "今天卧推 65kg 5x5"
    },
    confidence: 0.95
  });

  assert.equal(proposal.status, "pending");
  assert.ok(proposal.source_id);

  const record = await runtime.commitProposal(proposal.id, { actor: "test" });
  assert.equal(record.schema_name, "fitness.workout");
  assert.equal(record.occurred_at, "2026-06-24T10:00:00.000Z");

  const proposalTrace = await runtime.traceProposal(proposal.id);
  assert.equal(proposalTrace.proposal.id, proposal.id);
  assert.equal(proposalTrace.source?.excerpt, "今天卧推 65kg 5x5");
  assert.equal(proposalTrace.audit_log.some((entry) => entry.action === "commit"), true);

  const recordTrace = await runtime.traceRecord(record.id);
  assert.equal(recordTrace.record.id, record.id);
  assert.equal(recordTrace.source?.excerpt, "今天卧推 65kg 5x5");
  assert.equal(recordTrace.audit_log.some((entry) => entry.action === "create"), true);

  const proposals = await runtime.listProposals();
  assert.equal(proposals[0]?.status, "committed");

  const records = await runtime.listRecords("fitness.workout");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, record.id);

  const auditLog = await runtime.getAuditLog(proposal.id);
  assert.equal(auditLog.some((entry) => entry.action === "commit"), true);
  runtime.close();
});

test("runtime rejects a pending proposal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });

  const proposal = await runtime.createProposal({
    schema_name: "fitness.body_weight",
    data: {
      weight_kg: 90.4,
      occurred_at: "2026-06-24T10:00:00.000Z"
    }
  });

  const rejected = await runtime.rejectProposal(proposal.id, { actor: "test" });
  assert.equal(rejected.status, "rejected");
  assert.rejects(() => runtime.commitProposal(proposal.id), /rejected proposal/);
  runtime.close();
});

test("runtime installs the local fitness pack idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));

  const firstInstall = await runtime.installPack(packPath);
  const secondInstall = await runtime.installPack(packPath);

  assert.equal(firstInstall.pack.name, "fitness");
  assert.equal(secondInstall.pack.id, firstInstall.pack.id);
  assert.equal(firstInstall.schemas.length, 2);
  assert.equal(firstInstall.query_templates.length, 2);

  const packs = await runtime.listPacks();
  const schemas = await runtime.listSchemas();
  const queryTemplates = await runtime.listQueryTemplates();

  assert.equal(packs.length, 1);
  assert.equal(packs[0]?.manifest.observe.rules.length, 2);
  assert.deepEqual(
    schemas.map((schema) => schema.name).sort(),
    ["fitness.body_weight", "fitness.workout"]
  );
  assert.deepEqual(
    queryTemplates.map((template) => template.name).sort(),
    ["bench_progress", "weekly_volume"]
  );

  runtime.close();
});

test("runtime observes a fitness event and deduplicates repeated events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  await runtime.installPack(packPath);

  const event = {
    id: "evt_1",
    agent: "custom",
    event_type: "user_message",
    role: "user",
    content: "今天卧推 65kg 5x5，体重 90.4kg",
    occurred_at: "2026-06-27T10:00:00.000Z"
  };

  const firstResult = await runtime.observe(event);
  const secondResult = await runtime.observe(event);

  assert.equal(firstResult.status, "ok");
  assert.deepEqual(firstResult.matched_packs, ["fitness"]);
  assert.equal(firstResult.proposals_created, 2);
  assert.equal(firstResult.needs_review, 2);
  assert.equal(secondResult.duplicate, true);
  assert.equal(secondResult.proposals_created, 2);

  const proposals = await runtime.listProposals();
  assert.equal(proposals.length, 2);
  assert.deepEqual(
    proposals.map((proposal) => proposal.schema_name).sort(),
    ["fitness.body_weight", "fitness.workout"]
  );

  runtime.close();
});

test("runtime answers bench progress from committed records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  await runtime.installPack(packPath);

  await runtime.observe({
    id: "evt_bench_1",
    agent: "custom",
    event_type: "user_message",
    role: "user",
    content: "今天卧推 60kg 5x5",
    occurred_at: "2026-04-01T10:00:00.000Z"
  });
  await runtime.observe({
    id: "evt_bench_2",
    agent: "custom",
    event_type: "user_message",
    role: "user",
    content: "今天卧推 70kg 5x5",
    occurred_at: "2026-06-01T10:00:00.000Z"
  });

  for (const proposal of await runtime.listProposals()) {
    await runtime.commitProposal(proposal.id, { actor: "test" });
  }

  const queryResult = await runtime.queryTemplate("bench_progress");
  assert.equal(queryResult.records_used, 2);
  assert.equal(queryResult.rows.length, 2);

  const askResult = await runtime.ask("最近三个月卧推进步了吗？");
  assert.equal(askResult.status, "ok");
  assert.match(askResult.answer, /提升 10kg/);
  assert.equal(askResult.records_used, 2);

  runtime.close();
});

test("runtime observes agent work events from pack rules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/agent-work", import.meta.url));
  await runtime.installPack(packPath);

  const result = await runtime.observe({
    id: "evt_agent_work_1",
    agent: "custom",
    event_type: "agent_end",
    role: "assistant",
    content: "任务 deploy-api 失败，类型 deploy，耗时 12 分钟",
    occurred_at: "2026-06-27T11:00:00.000Z"
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.matched_packs, ["agent-work"]);
  assert.equal(result.proposals_created, 1);

  const proposals = await runtime.listProposals();
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.schema_name, "agent_work.task_event");
  assert.deepEqual(proposals[0]?.data, {
    task_name: "deploy-api",
    status: "failed",
    task_type: "deploy",
    duration_minutes: 12,
    occurred_at: "2026-06-27T11:00:00.000Z"
  });

  await runtime.commitProposal(proposals[0].id, { actor: "test" });
  const queryResult = await runtime.queryTemplate("agent_failures_by_type");
  assert.equal(queryResult.records_used, 1);
  assert.deepEqual(queryResult.rows, [
    {
      group: "deploy",
      records_used: 1,
      failures: 1
    }
  ]);

  runtime.close();
});

test("log watcher observes jsonl files and deduplicates repeated scans", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  await runtime.installPack(packPath);

  const logPath = join(dir, "agent.jsonl");
  await writeFile(
    logPath,
    `${JSON.stringify({
      id: "log_evt_1",
      event_type: "user_message",
      role: "user",
      content: "今天卧推 65kg 5x5，体重 90.4kg",
      occurred_at: "2026-06-27T10:00:00.000Z"
    })}\n`
  );

  const first = await watchLogs(runtime, {
    path: dir,
    agent: "custom"
  });
  const second = await watchLogs(runtime, {
    path: dir,
    agent: "custom"
  });

  assert.equal(first.files_scanned, 1);
  assert.equal(first.lines_scanned, 1);
  assert.equal(first.events_observed, 1);
  assert.equal(first.proposals_created, 2);
  assert.equal(second.duplicates, 1);
  assert.equal(second.proposals_created, 2);

  const proposals = await runtime.listProposals();
  assert.equal(proposals.length, 2);

  runtime.close();
});

test("log watcher can follow appended log lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  await runtime.installPack(packPath);

  const logPath = join(dir, "agent.jsonl");
  await writeFile(logPath, "");

  const controller = new AbortController();
  const batches = [];
  const safetyTimeout = setTimeout(() => {
    controller.abort();
  }, 1000);

  try {
    const followPromise = followLogs(runtime, {
      path: dir,
      agent: "custom",
      pollIntervalMs: 10,
      signal: controller.signal,
      onResult: (result) => {
        batches.push(result);
        controller.abort();
      }
    });

    await delay(30);
    await appendFile(
      logPath,
      `${JSON.stringify({
        id: "log_evt_follow_1",
        event_type: "user_message",
        role: "user",
        content: "今天卧推 67.5kg 5x5",
        occurred_at: "2026-06-28T10:00:00.000Z"
      })}\n`
    );

    await followPromise;
    assert.equal(batches.length, 1);
    assert.equal(batches[0].files_scanned, 1);
    assert.equal(batches[0].lines_scanned, 1);
    assert.equal(batches[0].events_observed, 1);
    assert.equal(batches[0].proposals_created, 1);

    const proposals = await runtime.listProposals();
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.schema_name, "fitness.workout");
  } finally {
    clearTimeout(safetyTimeout);
    runtime.close();
  }
});

test("log watcher maps Hermes lifecycle log lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  await runtime.installPack(packPath);

  const logPath = join(dir, "hermes.jsonl");
  await writeFile(
    logPath,
    `${JSON.stringify({
      event_name: "pre_gateway_dispatch",
      payload: {
        sessionId: "s-hermes",
        messageId: "m-hermes",
        prompt: "今天卧推 72.5kg 5x5",
        occurred_at: "2026-06-28T12:00:00.000Z"
      }
    })}\n`
  );

  const result = await watchLogs(runtime, {
    path: dir,
    agent: "hermes"
  });

  assert.equal(result.events_observed, 1);
  assert.equal(result.proposals_created, 1);

  const [proposal] = await runtime.listProposals();
  assert.equal(proposal?.schema_name, "fitness.workout");
  const trace = await runtime.traceProposal(proposal.id);
  assert.equal(trace.source?.agent, "hermes");
  assert.equal(trace.source?.event_type, "user_message");
  assert.equal(trace.source?.session_id, "s-hermes");
  assert.equal(trace.source?.message_id, "m-hermes");
  assert.equal(trace.source?.excerpt, "今天卧推 72.5kg 5x5");

  runtime.close();
});

test("log watcher maps OpenClaw tool result log lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-core-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  const packPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  await runtime.installPack(packPath);

  const logPath = join(dir, "openclaw.jsonl");
  await writeFile(
    logPath,
    `${JSON.stringify({
      eventName: "after_tool_call",
      payload: {
        sessionId: "s-openclaw",
        messageId: "m-openclaw",
        toolName: "workout_logger",
        result: "今天体重 89.8kg",
        occurred_at: "2026-06-28T13:00:00.000Z"
      }
    })}\n`
  );

  const result = await watchLogs(runtime, {
    path: dir,
    agent: "openclaw"
  });

  assert.equal(result.events_observed, 1);
  assert.equal(result.proposals_created, 1);

  const [proposal] = await runtime.listProposals();
  assert.equal(proposal?.schema_name, "fitness.body_weight");
  const trace = await runtime.traceProposal(proposal.id);
  assert.equal(trace.source?.agent, "openclaw");
  assert.equal(trace.source?.event_type, "tool_result");
  assert.equal(trace.source?.session_id, "s-openclaw");
  assert.equal(trace.source?.message_id, "m-openclaw");
  assert.equal(trace.source?.excerpt, "今天体重 89.8kg");
  assert.equal(trace.source?.metadata?.event_name, "after_tool_call");

  runtime.close();
});

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

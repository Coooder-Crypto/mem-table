import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MemTableRuntime } from "../dist/index.js";

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

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MemTableRuntime } from "@memtable/core";
import { handleHttpRequest } from "../dist/index.js";

test("server package declares HTTP and MCP modes", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /http/);
  assert.match(source, /mcp/);
});

test("http observer creates fitness proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-server-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  await runtime.installPack(fileURLToPath(new URL("../../../packs/fitness", import.meta.url)));

  try {
    const observeResponse = await handleHttpRequest(runtime, {
      method: "POST",
      url: "/v1/observe",
      body: {
        id: "evt_server_1",
        agent: "custom",
        event_type: "user_message",
        role: "user",
        content: "今天卧推 65kg 5x5，体重 90.4kg",
        occurred_at: "2026-06-27T10:00:00.000Z"
      }
    });
    assert.equal(observeResponse.statusCode, 200);
    const observeResult = observeResponse.body;
    assert.equal(observeResult.proposals_created, 2);

    const proposalsResponse = await handleHttpRequest(runtime, {
      method: "GET",
      url: "/v1/proposals"
    });
    assert.equal(proposalsResponse.statusCode, 200);
    const proposals = proposalsResponse.body;
    assert.equal(proposals.length, 2);
  } finally {
    runtime.close();
  }
});

test("http ask answers bench progress after committed proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-server-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  await runtime.installPack(fileURLToPath(new URL("../../../packs/fitness", import.meta.url)));

  try {
    await handleHttpRequest(runtime, {
      method: "POST",
      url: "/v1/observe",
      body: {
        id: "evt_server_ask_1",
        agent: "custom",
        event_type: "user_message",
        role: "user",
        content: "今天卧推 60kg 5x5",
        occurred_at: "2026-04-01T10:00:00.000Z"
      }
    });
    await handleHttpRequest(runtime, {
      method: "POST",
      url: "/v1/observe",
      body: {
        id: "evt_server_ask_2",
        agent: "custom",
        event_type: "user_message",
        role: "user",
        content: "今天卧推 70kg 5x5",
        occurred_at: "2026-06-01T10:00:00.000Z"
      }
    });

    for (const proposal of await runtime.listProposals()) {
      await runtime.commitProposal(proposal.id, { actor: "test" });
    }

    const askResponse = await handleHttpRequest(runtime, {
      method: "POST",
      url: "/v1/ask",
      body: {
        question: "最近三个月卧推进步了吗？"
      }
    });

    assert.equal(askResponse.statusCode, 200);
    assert.equal(askResponse.body.status, "ok");
    assert.match(askResponse.body.answer, /提升 10kg/);
  } finally {
    runtime.close();
  }
});

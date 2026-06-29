import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MemTableRuntime } from "@memtable/core";
import { handleHttpRequest, handleMcpRequest } from "../dist/index.js";

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

test("http proposal review supports schema filters and batch actions", async () => {
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
        id: "evt_server_batch_1",
        agent: "custom",
        event_type: "user_message",
        role: "user",
        content: "今天卧推 65kg 5x5，体重 90.4kg",
        occurred_at: "2026-06-29T10:00:00.000Z"
      }
    });

    const listResponse = await handleHttpRequest(runtime, {
      method: "GET",
      url: "/v1/proposals?status=pending&schema=fitness.workout"
    });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.body.length, 1);
    assert.equal(listResponse.body[0].schema_name, "fitness.workout");

    const commitAllResponse = await handleHttpRequest(runtime, {
      method: "POST",
      url: "/v1/proposals/commit-all",
      body: {
        schema: "fitness.workout"
      }
    });
    assert.equal(commitAllResponse.statusCode, 200);
    assert.equal(commitAllResponse.body.action, "commit");
    assert.equal(commitAllResponse.body.matched, 1);
    assert.equal(commitAllResponse.body.results[0].schema_name, "fitness.workout");

    const rejectAllResponse = await handleHttpRequest(runtime, {
      method: "POST",
      url: "/v1/proposals/reject-all",
      body: {}
    });
    assert.equal(rejectAllResponse.statusCode, 200);
    assert.equal(rejectAllResponse.body.action, "reject");
    assert.equal(rejectAllResponse.body.matched, 1);
    assert.equal(rejectAllResponse.body.results[0].schema_name, "fitness.body_weight");
    assert.equal(rejectAllResponse.body.results[0].status, "rejected");
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

test("http trace endpoints expose proposal and record sources", async () => {
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
        id: "evt_server_trace_1",
        agent: "custom",
        event_type: "user_message",
        role: "user",
        content: "今天卧推 65kg 5x5",
        occurred_at: "2026-06-27T10:00:00.000Z"
      }
    });

    const [proposal] = await runtime.listProposals();
    const proposalTraceResponse = await handleHttpRequest(runtime, {
      method: "GET",
      url: `/v1/proposals/${proposal.id}`
    });
    assert.equal(proposalTraceResponse.statusCode, 200);
    assert.equal(proposalTraceResponse.body.proposal.id, proposal.id);
    assert.equal(proposalTraceResponse.body.source.excerpt, "今天卧推 65kg 5x5");

    const record = await runtime.commitProposal(proposal.id, { actor: "test" });
    const recordTraceResponse = await handleHttpRequest(runtime, {
      method: "GET",
      url: `/v1/records/${record.id}`
    });
    assert.equal(recordTraceResponse.statusCode, 200);
    assert.equal(recordTraceResponse.body.record.id, record.id);
    assert.equal(recordTraceResponse.body.source.excerpt, "今天卧推 65kg 5x5");

    const missingResponse = await handleHttpRequest(runtime, {
      method: "GET",
      url: "/v1/proposals/missing"
    });
    assert.equal(missingResponse.statusCode, 404);
  } finally {
    runtime.close();
  }
});

test("mcp tools expose observe, ask, and trace tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-server-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  await runtime.installPack(fileURLToPath(new URL("../../../packs/fitness", import.meta.url)));

  try {
    const listResponse = await handleMcpRequest(runtime, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });
    assert.ok(listResponse?.result.tools.some((tool) => tool.name === "memtable.observe"));
    assert.ok(listResponse?.result.tools.some((tool) => tool.name === "memtable.proposal.show"));
    assert.ok(listResponse?.result.tools.some((tool) => tool.name === "memtable.proposal.commit_all"));
    assert.ok(listResponse?.result.tools.some((tool) => tool.name === "memtable.proposal.reject_all"));
    assert.ok(listResponse?.result.tools.some((tool) => tool.name === "memtable.record.show"));

    const observeResponse = await handleMcpRequest(runtime, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "memtable.observe",
        arguments: {
          id: "evt_mcp_1",
          agent: "custom",
          event_type: "user_message",
          role: "user",
          content: "今天卧推 60kg 5x5",
          occurred_at: "2026-04-01T10:00:00.000Z"
        }
      }
    });
    assert.equal(observeResponse?.error, undefined);

    await handleMcpRequest(runtime, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "memtable.observe",
        arguments: {
          id: "evt_mcp_2",
          agent: "custom",
          event_type: "user_message",
          role: "user",
          content: "今天卧推 70kg 5x5",
          occurred_at: "2026-06-01T10:00:00.000Z"
        }
      }
    });

    for (const proposal of await runtime.listProposals()) {
      await runtime.commitProposal(proposal.id, { actor: "test" });
    }

    const [proposal] = await runtime.listProposals();
    const records = await runtime.listRecords("fitness.workout");

    const proposalShowResponse = await handleMcpRequest(runtime, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "memtable.proposal.show",
        arguments: {
          id: proposal.id
        }
      }
    });
    assert.equal(proposalShowResponse?.error, undefined);
    assert.match(proposalShowResponse?.result.content[0].text, /evt_mcp_1/);

    const recordShowResponse = await handleMcpRequest(runtime, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "memtable.record.show",
        arguments: {
          id: records[0].id
        }
      }
    });
    assert.equal(recordShowResponse?.error, undefined);
    assert.match(recordShowResponse?.result.content[0].text, /fitness.workout/);

    const askResponse = await handleMcpRequest(runtime, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "memtable.ask",
        arguments: {
          question: "最近三个月卧推进步了吗？"
        }
      }
    });
    assert.equal(askResponse?.error, undefined);
    const text = askResponse?.result.content[0].text;
    assert.match(text, /提升 10kg/);
  } finally {
    runtime.close();
  }
});

test("mcp proposal review supports schema filters and batch actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-server-"));
  const runtime = await MemTableRuntime.open({
    storage: {
      driver: "sqlite",
      path: join(dir, "memtable.db")
    }
  });
  await runtime.installPack(fileURLToPath(new URL("../../../packs/fitness", import.meta.url)));

  try {
    await callMcpTool(runtime, 1, "memtable.observe", {
      id: "evt_mcp_batch_1",
      agent: "custom",
      event_type: "user_message",
      role: "user",
      content: "今天卧推 65kg 5x5，体重 90.4kg",
      occurred_at: "2026-06-29T10:00:00.000Z"
    });

    const listed = await callMcpTool(runtime, 2, "memtable.proposal.list", {
      status: "pending",
      schema: "fitness.workout"
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].schema_name, "fitness.workout");

    const committed = await callMcpTool(runtime, 3, "memtable.proposal.commit_all", {
      schema: "fitness.workout"
    });
    assert.equal(committed.action, "commit");
    assert.equal(committed.matched, 1);
    assert.equal(committed.results[0].schema_name, "fitness.workout");

    const rejected = await callMcpTool(runtime, 4, "memtable.proposal.reject_all", {});
    assert.equal(rejected.action, "reject");
    assert.equal(rejected.matched, 1);
    assert.equal(rejected.results[0].schema_name, "fitness.body_weight");
    assert.equal(rejected.results[0].status, "rejected");
  } finally {
    runtime.close();
  }
});

async function callMcpTool(runtime, id, name, args) {
  const response = await handleMcpRequest(runtime, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: args
    }
  });
  assert.equal(response?.error, undefined);
  return JSON.parse(response.result.content[0].text);
}

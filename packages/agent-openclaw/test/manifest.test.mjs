import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mapOpenClawEvent, registerMemTableOpenClawPlugin } from "../dist/index.js";

test("openclaw plugin manifest declares the memtable plugin id", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.id, "memtable");
  assert.ok(manifest.contracts.tools.includes("memtable_ask"));
});

test("openclaw event mapper converts messages and tool results", () => {
  const message = mapOpenClawEvent("message_received", {
    sessionId: "s1",
    messageId: "m1",
    content: "今天卧推 65kg 5x5"
  });
  assert.equal(message.agent, "openclaw");
  assert.equal(message.event_type, "user_message");
  assert.equal(message.session_id, "s1");
  assert.equal(message.message_id, "m1");
  assert.equal(message.content, "今天卧推 65kg 5x5");

  const toolResult = mapOpenClawEvent("after_tool_call", {
    toolName: "calendar",
    params: { id: "task" },
    result: { ok: true }
  });
  assert.equal(toolResult.event_type, "tool_result");
  assert.equal(toolResult.tool_name, "calendar");
  assert.deepEqual(toolResult.tool_output, { ok: true });
});

test("openclaw plugin registers memtable tools and hooks", () => {
  const tools = [];
  const hooks = [];
  const api = {
    registerTool(tool) {
      tools.push(tool);
    },
    on(eventName, handler) {
      hooks.push({ eventName, handler });
    }
  };

  const config = registerMemTableOpenClawPlugin(api, {
    endpoint: "http://127.0.0.1:3838",
    observe: true
  });

  assert.equal(config.endpoint, "http://127.0.0.1:3838");
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["memtable_ask", "memtable_commit_proposal", "memtable_list_proposals", "memtable_propose"]
  );
  assert.ok(hooks.some((hook) => hook.eventName === "message_received"));
  assert.ok(hooks.some((hook) => hook.eventName === "after_tool_call"));
});

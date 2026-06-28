import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("hermes plugin manifest declares tools and hooks", async () => {
  const manifest = await readFile(new URL("../memtable_hermes/plugin.yaml", import.meta.url), "utf8");
  assert.match(manifest, /entrypoint: memtable_hermes:register/);
  assert.match(manifest, /memtable_ask/);
  assert.match(manifest, /pre_gateway_dispatch/);
});

test("hermes plugin registers memtable tools and hooks", () => {
  runPython(`
from memtable_hermes import register

class Context:
    def __init__(self):
        self.tools = []
        self.hooks = []
        self.skills = []
    def register_tool(self, **kwargs):
        self.tools.append(kwargs)
    def register_hook(self, event_name, handler):
        self.hooks.append((event_name, handler))
    def register_skill(self, name, path):
        self.skills.append((name, str(path)))

ctx = register(Context(), endpoint="http://127.0.0.1:3838")
tool_names = sorted(tool["name"] for tool in ctx.tools)
hook_names = sorted(name for name, _handler in ctx.hooks)
assert "memtable_ask" in tool_names
assert "memtable_commit_proposal" in tool_names
assert "pre_gateway_dispatch" in hook_names
assert "post_tool_call" in hook_names
assert ctx.skills[0][0] == "memtable"
`);
});

test("hermes event mapper converts messages and tool results", () => {
  runPython(`
from memtable_hermes import map_hermes_event

message = map_hermes_event("pre_gateway_dispatch", {
    "sessionId": "s1",
    "messageId": "m1",
    "content": "今天卧推 65kg 5x5",
})
assert message["agent"] == "hermes"
assert message["event_type"] == "user_message"
assert message["session_id"] == "s1"
assert message["message_id"] == "m1"
assert message["content"] == "今天卧推 65kg 5x5"

tool_result = map_hermes_event("post_tool_call", {
    "tool_name": "calendar",
    "params": {"id": "task"},
    "result": {"ok": True},
})
assert tool_result["event_type"] == "tool_result"
assert tool_result["tool_name"] == "calendar"
assert tool_result["tool_output"] == {"ok": True}
`);
});

test("hermes hook ignores sidecar connection failures", () => {
  runPython(`
from memtable_hermes import register

class Context:
    def __init__(self):
        self.tools = []
        self.hooks = []
    def register_tool(self, **kwargs):
        self.tools.append(kwargs)
    def register_hook(self, event_name, handler):
        self.hooks.append((event_name, handler))

ctx = register(Context(), endpoint="http://127.0.0.1:1")
handler = dict(ctx.hooks)["pre_gateway_dispatch"]
handler({"content": "今天卧推 65kg 5x5"})
`);
});

function runPython(source) {
  const result = spawnSync("python3", ["-c", source], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: new URL("..", import.meta.url).pathname
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

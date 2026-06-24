import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("server package declares HTTP and MCP modes", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /http/);
  assert.match(source, /mcp/);
});


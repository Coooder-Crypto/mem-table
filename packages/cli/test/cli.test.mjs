import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("cli exposes the memtable command list", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /memtable commands/);
  assert.match(source, /doctor \[--endpoint/);
  assert.match(source, /agent enable hermes/);
  assert.match(source, /agent enable openclaw/);
  assert.match(source, /agent doctor hermes/);
  assert.match(source, /agent doctor openclaw/);
  assert.match(source, /proposal show <id>/);
  assert.match(source, /record show <id>/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("openclaw plugin manifest declares the memtable plugin id", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.id, "memtable");
});


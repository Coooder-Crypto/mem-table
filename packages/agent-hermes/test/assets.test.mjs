import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("hermes plugin placeholder exposes a register function", async () => {
  const source = await readFile(
    new URL("../memtable_hermes/__init__.py", import.meta.url),
    "utf8"
  );
  assert.match(source, /def register/);
});


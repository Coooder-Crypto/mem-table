import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("cli exposes the memtable command list", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /memtable commands/);
  assert.match(source, /watch <path> --agent .*--follow/);
  assert.match(source, /doctor \[--endpoint/);
  assert.match(source, /agent enable hermes/);
  assert.match(source, /agent enable openclaw/);
  assert.match(source, /agent doctor hermes/);
  assert.match(source, /agent doctor openclaw/);
  assert.match(source, /proposal show <id>/);
  assert.match(source, /record show <id>/);
});

test("agent doctor includes a lightweight watch command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-cli-"));
  const cliPath = new URL("../dist/index.js", import.meta.url);
  for (const agent of ["hermes", "openclaw"]) {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath.pathname, "agent", "doctor", agent, "--endpoint", "http://127.0.0.1:9"],
      { cwd: dir }
    );
    const report = JSON.parse(stdout);

    assert.equal(report.agent, agent);
    assert.equal(report.watch.mode, "log_watch");
    assert.equal(report.watch.agent, agent);
    assert.equal(report.watch.interval_ms, 1000);
    assert.match(report.watch.command, new RegExp(`memtable watch .* --agent ${agent} --follow`));
    assert.equal(report.checks.some((check) => check.name === "log_watch_path"), true);
  }
});

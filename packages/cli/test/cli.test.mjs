import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  assert.match(source, /proposal list \[status\] \[--schema/);
  assert.match(source, /proposal commit <id\|--all>/);
  assert.match(source, /proposal reject <id\|--all>/);
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

test("proposal review supports schema filters and batch actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memtable-cli-"));
  const cliPath = new URL("../dist/index.js", import.meta.url).pathname;
  const fitnessPackPath = fileURLToPath(new URL("../../../packs/fitness", import.meta.url));
  const logPath = join(dir, "agent.jsonl");

  await runCli(cliPath, ["init"], dir);
  await runCli(cliPath, ["pack", "install", fitnessPackPath], dir);
  await writeFile(
    logPath,
    `${JSON.stringify({
      id: "cli_batch_evt_1",
      event_type: "user_message",
      role: "user",
      content: "今天卧推 65kg 5x5，体重 90.4kg",
      occurred_at: "2026-06-29T10:00:00.000Z"
    })}\n`
  );
  await runCli(cliPath, ["watch", logPath, "--agent", "custom"], dir);

  const workoutProposals = JSON.parse(
    await runCli(cliPath, ["proposal", "list", "pending", "--schema", "fitness.workout"], dir)
  );
  assert.equal(workoutProposals.length, 1);

  const commitResult = JSON.parse(
    await runCli(cliPath, ["proposal", "commit", "--all", "--schema", "fitness.workout"], dir)
  );
  assert.equal(commitResult.action, "commit");
  assert.equal(commitResult.matched, 1);
  assert.equal(commitResult.processed, 1);
  assert.equal(commitResult.results[0].schema_name, "fitness.workout");

  const remainingPending = JSON.parse(await runCli(cliPath, ["proposal", "list", "pending"], dir));
  assert.equal(remainingPending.length, 1);
  assert.equal(remainingPending[0].schema_name, "fitness.body_weight");

  const rejectResult = JSON.parse(await runCli(cliPath, ["proposal", "reject", "--all"], dir));
  assert.equal(rejectResult.action, "reject");
  assert.equal(rejectResult.matched, 1);
  assert.equal(rejectResult.processed, 1);
  assert.equal(rejectResult.results[0].status, "rejected");
});

async function runCli(cliPath, args, cwd) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd });
  return stdout;
}

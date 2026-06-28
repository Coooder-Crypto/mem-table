# MemTable

MemTable is a local-first structured ledger runtime for long-running agents.

It does not replace vector memory, RAG, or long-term text memory. It adds the missing data layer between agents and databases: a way to turn useful facts from conversations, tool results, and agent events into queryable, auditable records.

> Memory recalls what happened. Ledger computes what changed.

## Why

Agents can usually remember text, but they struggle with questions that are really data questions:

- Did my bench press improve over the last three months?
- What is my body weight trend?
- Which projects have been delayed the longest?
- Where did I spend the most this month?

Those questions need records, timestamps, schemas, aggregation, and source tracing. MemTable gives agents a structured ledger instead of asking the model to behave like a database.

## What Is Included

- `@memtable/core`: SQLite-backed ledger runtime
- `@memtable/server`: HTTP observer and MCP stdio server
- `@memtable/cli`: local CLI for init, packs, proposals, queries, and diagnostics
- `packs/fitness`: first domain pack for workouts and body weight
- `packs/agent-work`: agent task outcome pack for failures, completions, and task categories
- `@memtable/agent-hermes`: Hermes enhancer plugin assets
- `@memtable/openclaw-plugin`: OpenClaw enhancer plugin

## Quickstart

Install dependencies and build:

```bash
pnpm install
pnpm build
```

Run the fitness E2E demo:

```bash
pnpm demo:fitness
```

The demo creates a temporary SQLite ledger, installs the `fitness` pack, observes two workout logs, commits generated proposals, and asks:

```text
我最近三个月卧推进步了吗？
```

Expected answer shape:

```text
基于 2 条卧推记录，卧推最高训练重量从 60kg 到 65kg，提升 5kg。
```

## CLI Flow

Initialize a local ledger:

```bash
node packages/cli/dist/index.js init
```

Install the fitness pack:

```bash
node packages/cli/dist/index.js pack install packs/fitness
```

Install the agent work pack:

```bash
node packages/cli/dist/index.js pack install packs/agent-work
```

Start the HTTP observer sidecar:

```bash
node packages/cli/dist/index.js serve --http
```

Scan existing agent logs without installing a native enhancer:

```bash
node packages/cli/dist/index.js watch ~/.hermes/logs --agent hermes
node packages/cli/dist/index.js watch ~/.openclaw/runs --agent openclaw
```

Keep watching appended log lines:

```bash
node packages/cli/dist/index.js watch ~/.hermes/logs --agent hermes --follow
```

In another terminal, inspect health and setup:

```bash
node packages/cli/dist/index.js doctor
```

## Agent Enhancers

MemTable supports three integration surfaces:

- Tool surface: agents call MemTable through MCP or registered tools.
- Observer surface: native plugin hooks send agent events to `memtable serve --http`.
- Log surface: MemTable scans existing `.jsonl` or `.log` files and observes each line.

Enable Hermes:

```bash
node packages/cli/dist/index.js agent enable hermes
node packages/cli/dist/index.js agent doctor hermes
```

Enable OpenClaw:

```bash
node packages/cli/dist/index.js agent enable openclaw
node packages/cli/dist/index.js agent doctor openclaw
```

The enable commands write local config under `.memtable/agents/` and print the native plugin install command for the target agent. The doctor commands also return a lightweight `watch.command` fallback, so users can start log-based ingestion with `memtable watch ... --follow` before installing a native enhancer. The Hermes and OpenClaw enhancers are alpha adapters for the current MVP surface: tool registration, event mapping, and sidecar observation.

## MCP Server

Start the MCP stdio server:

```bash
node packages/cli/dist/index.js serve --mcp
```

Current MCP tools expose observing, asking, structured query, proposals, proposal tracing, record tracing, packs, and schemas.

## Core Workflow

```text
Agent message or tool result
  -> MemTable observer
  -> Pack matching
  -> Structured proposal
  -> User or agent commit
  -> Ledger record
  -> Query / ask
```

For example, this event:

```text
今天卧推 65kg 5x5，体重 90.4kg
```

can become two proposals:

- `fitness.workout`
- `fitness.body_weight`

After commit, MemTable can answer trend questions from records instead of chat history.

The `agent-work` pack can also turn task logs such as:

```text
任务 deploy-api 失败，类型 deploy，耗时 12 分钟
```

into `agent_work.task_event` proposals and query failure counts by task type.

## Diagnostics

Use:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js agent doctor hermes
node packages/cli/dist/index.js agent doctor openclaw
```

These commands return JSON checks with fix commands for missing config, missing SQLite DB, missing packs, offline sidecar, or incomplete agent enhancer config.

## Tracing

Use CLI tracing when you need to inspect why a value exists in the ledger:

```bash
node packages/cli/dist/index.js proposal show <id>
node packages/cli/dist/index.js record show <id>
```

The HTTP sidecar also exposes trace endpoints:

```http
GET /v1/proposals/:id
GET /v1/records/:id
```

MCP exposes the same trace surface through:

```text
memtable.proposal.show
memtable.record.show
```

## Pack Observe Rules

Packs can include `extractors/*.rules.json` files. These rules describe regex-based extraction from observed agent events into structured proposals.

The current rule format supports:

- `schema`: target ledger schema
- `pattern` and `flags`: extraction regex
- `fields`: mapping capture groups, constants, or event fields into record fields
- `confidence`: proposal confidence
- `optional`: optional field mapping

This is intentionally conservative for v0.1. More expressive extractors can be added without changing the ledger runtime contract.

## Alpha Notes

- `memtable watch` scans once by default. Add `--follow` to poll for appended `.jsonl` or `.log` lines; this is a lightweight alpha tailer, not yet a platform-specific file-system watcher.
- `memtable serve --http` and `memtable serve --mcp` are separate modes in the current CLI. Run them in separate processes when both surfaces are needed.
- Node may print an experimental warning for `node:sqlite`; that is expected for this alpha runtime.
- Hermes and OpenClaw enhancers are minimal native adapters. They validate the integration pattern but are not yet version-pinned against every upstream agent release.

## Project Docs

- [Product Document](./PRODUCT.md)
- [Technical Design](./TECHNICAL_DESIGN.md)
- [Implementation Plan](./IMPLEMENTATION_PLAN.md)
- [Pack Format](./docs/pack-format.md)
- [Hermes Example](./examples/hermes/README.md)
- [OpenClaw Example](./examples/openclaw/README.md)

## Status

This repository is in early v0.1 development. The current target is a local-first MVP that proves the agent ledger loop with the `fitness` pack, HTTP observer, MCP tools, Hermes enhancer, and OpenClaw enhancer.

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

Start the HTTP observer sidecar:

```bash
node packages/cli/dist/index.js serve --http
```

In another terminal, inspect health and setup:

```bash
node packages/cli/dist/index.js doctor
```

## Agent Enhancers

MemTable supports two integration surfaces:

- Tool surface: agents call MemTable through MCP or registered tools.
- Observer surface: native plugin hooks send agent events to `memtable serve --http`.

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

The enable commands write local config under `.memtable/agents/` and print the native plugin install command for the target agent.

## MCP Server

Start the MCP stdio server:

```bash
node packages/cli/dist/index.js serve --mcp
```

Current MCP tools expose observing, asking, proposals, records, packs, schemas, and query templates.

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

## Diagnostics

Use:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js agent doctor hermes
node packages/cli/dist/index.js agent doctor openclaw
```

These commands return JSON checks with fix commands for missing config, missing SQLite DB, missing packs, offline sidecar, or incomplete agent enhancer config.

## Project Docs

- [Product Document](./PRODUCT.md)
- [Technical Design](./TECHNICAL_DESIGN.md)
- [Implementation Plan](./IMPLEMENTATION_PLAN.md)
- [Hermes Example](./examples/hermes/README.md)
- [OpenClaw Example](./examples/openclaw/README.md)

## Status

This repository is in early v0.1 development. The current target is a local-first MVP that proves the agent ledger loop with the `fitness` pack, HTTP observer, MCP tools, Hermes enhancer, and OpenClaw enhancer.

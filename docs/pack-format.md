# MemTable Pack Format

This document describes the v0.1-alpha Pack format implemented in this repository.

A Pack gives MemTable domain-specific ledger behavior: schemas, observe rules, query templates, validation metadata, and tool metadata. Packs are installed from a local directory with:

```bash
node packages/cli/dist/index.js pack install packs/fitness
```

## Directory Layout

```text
packs/<pack-name>/
  pack.json
  schemas/
    *.schema.json
  extractors/
    prompts.md
    observe.rules.json
  queries/
    *.query.json
  validators/
    rules.json
  tools/
    mcp.json
  examples/
    logs.md
```

Only `pack.json` is mandatory. Files referenced from `pack.json` must exist. JSON files must contain JSON objects.

## pack.json

`pack.json` is the Pack manifest.

```json
{
  "name": "fitness",
  "version": "0.1.0",
  "memtable": ">=0.1.0",
  "description": "Structured fitness ledger for workouts and body metrics.",
  "observe": {
    "eventTypes": ["user_message", "tool_result", "agent_end"],
    "keywords": ["卧推", "体重", "训练", "bench", "workout"]
  },
  "writePolicy": {
    "default": "proposal",
    "autoCommitConfidence": 0.92
  },
  "schemas": [
    "schemas/workout.schema.json"
  ],
  "extractors": [
    "extractors/prompts.md",
    "extractors/observe.rules.json"
  ],
  "queries": [
    "queries/bench_progress.query.json"
  ],
  "validators": [
    "validators/rules.json"
  ],
  "tools": "tools/mcp.json"
}
```

Fields:

- `name`: required Pack name. It must be non-empty and unique in the local ledger.
- `version`: required Pack version.
- `memtable`: optional compatible MemTable version range. Stored as metadata in v0.1-alpha.
- `description`: optional human-readable description.
- `observe.eventTypes`: optional list of `AgentEvent.event_type` values this Pack can observe.
- `observe.keywords`: optional keyword gate. At least one keyword must appear in event content when provided.
- `writePolicy`: optional metadata for future auto-commit policy. v0.1-alpha creates proposals.
- `schemas`: optional list of JSON Schema files.
- `extractors`: optional list of extractor files. `*.rules.json` files are parsed as observe rules.
- `queries`: optional list of query template files.
- `validators`: optional list of validator metadata files. Stored/validated for existence in v0.1-alpha.
- `tools`: optional path to tool metadata.

## Schemas

Schemas are JSON Schema objects. MemTable uses `$id` as the schema name. If `$id` is absent, it falls back to `title`.

Example:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "fitness.workout",
  "title": "Workout",
  "type": "object",
  "additionalProperties": false,
  "required": ["exercise", "occurred_at"],
  "properties": {
    "exercise": { "type": "string" },
    "weight_kg": { "type": "number", "minimum": 0 },
    "sets": { "type": "integer", "minimum": 1 },
    "reps": { "type": "integer", "minimum": 1 },
    "occurred_at": { "type": "string", "format": "date-time" }
  }
}
```

Schema versions default to `"1"` unless the schema object includes a `version` field.

## Observe Rules

Observe rules live in `extractors/*.rules.json`.

```json
{
  "rules": [
    {
      "name": "bench_press_workout",
      "schema": "fitness.workout",
      "pattern": "(?:卧推|bench(?:\\s+press)?)\\s*([0-9]+(?:\\.[0-9]+)?)\\s*kg\\s*([0-9]+)\\s*[x×]\\s*([0-9]+)",
      "flags": "i",
      "confidence": 0.95,
      "fields": {
        "exercise": { "value": "bench_press" },
        "weight_kg": { "group": 1, "type": "number" },
        "sets": { "group": 2, "type": "integer" },
        "reps": { "group": 3, "type": "integer" },
        "occurred_at": { "event": "occurred_at" }
      }
    }
  ]
}
```

Rule fields:

- `name`: optional rule name.
- `schema`: required target schema name.
- `pattern`: required JavaScript regular expression source.
- `flags`: optional JavaScript regex flags. Runtime adds `g` automatically when missing.
- `confidence`: optional proposal confidence. Defaults to `0.8`.
- `fields`: required object mapping record fields to extraction mappings.

Field mappings:

- `group`: capture group number from the regex match.
- `value`: constant value.
- `event`: currently supports `"occurred_at"`.
- `type`: optional coercion, one of `"string"`, `"number"`, or `"integer"`.
- `map`: optional value map. String values are checked as-is and lowercased.
- `optional`: when `true`, missing or invalid values skip that field instead of dropping the proposal.

If a required field mapping returns `undefined`, the rule match is ignored.

## Query Templates

Query templates are JSON objects consumed by the built-in query engine.

Example:

```json
{
  "name": "agent_failures_by_type",
  "description": "Count failed agent tasks by task type.",
  "collection": "agent_work.task_event",
  "filter": {
    "status": {
      "eq": "failed"
    }
  },
  "aggregate": {
    "failures": {
      "op": "count"
    }
  },
  "groupBy": {
    "field": "task_type"
  },
  "orderBy": {
    "field": "failures",
    "direction": "desc"
  }
}
```

Supported filter operators:

- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`
- `between`
- `exists`

Supported aggregate operators:

- `count`
- `sum`
- `avg`
- `min`
- `max`

Supported `groupBy.interval` values:

- `day`
- `week`
- `month`

## Validators

`validators/rules.json` is validator metadata in v0.1-alpha. The installer checks that the referenced file exists, but runtime validation is not yet enforced.

Current Packs use this shape:

```json
{
  "rules": [
    {
      "field": "weight_kg",
      "op": "between",
      "value": [1, 500]
    },
    {
      "field": "occurred_at",
      "op": "not_future"
    }
  ]
}
```

## Tools Metadata

`tools/mcp.json` describes intended Pack tools.

```json
{
  "tools": [
    {
      "name": "agent_failures_by_type",
      "description": "Count failed agent tasks by task type.",
      "query": "agent_failures_by_type"
    }
  ]
}
```

In v0.1-alpha this file is metadata only. The current MCP server exposes core tools; dynamic Pack-specific MCP tool generation is a later step.

## Install Behavior

When a Pack is installed:

1. `pack.json` is parsed.
2. Referenced files are checked for existence.
3. JSON schemas are loaded and registered.
4. Query templates are loaded and registered.
5. `extractors/*.rules.json` files are parsed and merged into the installed Pack manifest under `observe.rules`.
6. The Pack manifest is stored in SQLite.

Reinstalling a Pack with the same `name` updates the installed Pack record idempotently.

## Alpha Limitations

- Only local directory install is implemented.
- Observe rules are regex-based.
- Runtime validation from `validators/rules.json` is not enforced yet.
- Dynamic MCP tools from `tools/mcp.json` are not generated yet.
- Pack migrations and version upgrades are not implemented yet.
- Pack signing is not implemented yet.

# MemTable 技术方案

## 1. 设计结论

MemTable 不应该只做成一个 SDK，也不应该只做成一个 MCP Server。

结合 Hermes Agent 和 OpenClaw 的插件机制，MemTable 的技术形态应是：

> Local-first Agent Ledger Runtime + Universal MCP Server + Native Agent Enhancers

核心目标是让现有 Agent 在尽量少改动甚至不改动源码的情况下，获得结构化账本能力。

MemTable 对 Agent 提供两类能力：

- 工具面：Agent 主动调用 MemTable，完成记录、查询、提案审核和账本解释。
- 观察面：MemTable 自动观察 Agent 的消息、工具结果、任务结果，从中发现可结构化数据。

这两类能力不能只靠一种协议完成。

MCP 适合工具面，但不天然覆盖每轮交互的旁路观察。原生插件 hooks 适合观察面，但不同 Agent 的插件 API 不一致。因此 MemTable 需要同时提供：

- `memtable serve --mcp`
- `memtable serve --http`
- `memtable agent enable hermes`
- `memtable agent enable openclaw`
- `memtable watch <logs>`

## 2. 调研依据

### 2.1 Hermes Agent

Hermes 的公开扩展面包括：

- MCP Server 配置
- Python 插件
- lifecycle hooks
- skills
- CLI commands
- memory providers

Hermes 插件可以放在 `~/.hermes/plugins/<plugin>/`，典型结构包含 `plugin.yaml`、`__init__.py`、`schemas.py`、`tools.py`。插件通过 `ctx.register_tool(...)` 注册工具，通过 `ctx.register_hook(...)` 注册生命周期 hook。

对 MemTable 有价值的 Hermes hooks 包括：

- `pre_gateway_dispatch`
- `pre_llm_call`
- `post_llm_call`
- `pre_tool_call`
- `post_tool_call`
- `on_session_start`
- `on_session_end`
- `subagent_stop`

Hermes 还支持 skill，因此 MemTable 可以安装一个轻量 `memtable` skill，指导 Agent 什么时候查账本、什么时候写账本。

参考：

- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp

### 2.2 OpenClaw

OpenClaw 的插件系统是 TypeScript 优先的原生插件机制。

OpenClaw 插件包含：

- `package.json` 中的 `openclaw` metadata
- `openclaw.plugin.json` manifest
- TypeScript runtime entry
- `definePluginEntry(...)`
- `api.registerTool(...)`
- `api.on(...)` lifecycle hooks

OpenClaw 插件可以从 ClawHub、npm、git、本地路径安装，并通过 `openclaw plugins enable <plugin-id>` 启用。

对 MemTable 有价值的 OpenClaw hooks 包括：

- `message_received`
- `message_sending`
- `message_sent`
- `before_prompt_build`
- `llm_input`
- `llm_output`
- `before_tool_call`
- `after_tool_call`
- `tool_result_persist`
- `agent_end`
- `gateway_start`
- `gateway_stop`

参考：

- https://github.com/openclaw/openclaw
- https://docs.openclaw.ai/tools/plugin
- https://docs.openclaw.ai/plugins/building-plugins
- https://docs.openclaw.ai/plugins/hooks

## 3. 产品级接入模式

MemTable 支持三种接入模式。

### 3.1 自动观察模式

Agent 每轮交互、工具结果、任务结束事件都会被转成标准事件，发送给 MemTable Observer。

```text
Agent event
  -> Native plugin hook
  -> MemTable observe API
  -> Pack matching
  -> Extract Proposal
  -> Validate
  -> Auto commit or wait for review
  -> Ledger DB
```

适合：

- 用户自然说“今天卧推 65kg 5x5”
- Agent 完成任务后产生任务状态
- 工具调用返回财务、时间、项目或健康数据
- 子 Agent 返回可结构化的工作结果

### 3.2 主动工具模式

Agent 主动调用 MemTable 工具。

```text
Agent
  -> MCP tool / native tool
  -> MemTable Runtime
  -> query / record / propose
```

适合：

- 用户明确说“查一下最近三个月卧推趋势”
- Agent 在回答前需要查账本
- Agent 显式记录任务状态
- 用户确认 proposal

### 3.3 日志导入模式

对不支持插件或 MCP 的 Agent，MemTable 通过日志文件或 transcript 旁路接入。

```text
Agent logs
  -> memtable watch
  -> normalize events
  -> observe
```

适合：

- 无插件能力的 Agent
- 只能拿到 JSONL / Markdown / SQLite 日志的 Agent
- 历史数据迁移

## 4. 总体架构

```text
                    Existing Agents
         +---------------+----------------+
         |                                |
     Hermes Agent                    OpenClaw
         |                                |
  Hermes Plugin                  OpenClaw Plugin
         |                                |
         +---------------+----------------+
                         |
              MemTable Agent Event
                         |
        +----------------+----------------+
        |                                 |
  HTTP Observer API                 MCP Server
        |                                 |
        +----------------+----------------+
                         |
                 MemTable Runtime
                         |
    +----------+---------+----------+----------+
    |          |         |          |          |
  Pack      Extract    Write      Query     Audit
 Manager    Engine     Guard      Engine   Provenance
    |          |         |          |          |
    +----------+---------+----------+----------+
                         |
                 Storage Adapter
                         |
                    SQLite v0.1
```

## 5. 仓库结构

```text
mem-table/
  PRODUCT.md
  TECHNICAL_DESIGN.md
  package.json
  pnpm-workspace.yaml
  packages/
    core/
      src/
        runtime/
        observe/
        pack/
        schema/
        extract/
        proposal/
        record/
        query/
        storage/
        audit/
    cli/
      src/
    server/
      src/
        http/
        mcp/
    agent-hermes/
      memtable_hermes/
        plugin.yaml
        __init__.py
        schemas.py
        tools.py
        skill/
          SKILL.md
    agent-openclaw/
      src/
        index.ts
      package.json
      openclaw.plugin.json
  packs/
    fitness/
    agent-work/
  examples/
    hermes/
    openclaw/
```

### 5.1 包职责

`packages/core`：

- Runtime
- Pack Manager
- Schema Registry
- Proposal / Record
- Query Engine
- Audit / Provenance

`packages/server`：

- HTTP Observer API
- MCP Server
- 本地 sidecar 进程

`packages/cli`：

- 初始化
- Pack 安装
- Agent enhancer 安装
- 日志监听
- 调试查询

`packages/agent-hermes`：

- Hermes Python 插件
- Hermes hooks
- Hermes tools
- Hermes skill
- 安装脚本模板

`packages/agent-openclaw`：

- OpenClaw TypeScript 插件
- OpenClaw hooks
- OpenClaw tools
- manifest 和发布配置

## 6. MemTable Runtime

Runtime 是核心业务层，不直接依赖 Hermes 或 OpenClaw。

### 6.1 核心 API

```ts
interface MemTableRuntime {
  installPack(source: PackSource): Promise<InstalledPack>
  observe(event: AgentEvent): Promise<ObserveResult>
  propose(input: ProposeInput): Promise<Proposal[]>
  commitProposal(id: string, options?: CommitOptions): Promise<Record>
  record(schemaName: string, data: unknown, options?: RecordOptions): Promise<Record>
  query(query: QueryDsl): Promise<QueryResult>
  ask(question: string, options?: AskOptions): Promise<AskResult>
}
```

### 6.2 Runtime 不做什么

Runtime 不关心：

- 事件来自 Hermes 还是 OpenClaw
- Agent 的会话模型
- 插件如何安装
- MCP 工具如何注册
- 日志如何读取

这些由 adapter 层处理。

## 7. 标准事件模型

所有 Agent adapter 必须把自身事件转换为 `AgentEvent`。

```ts
type AgentEventType =
  | "session_start"
  | "session_end"
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "agent_end"
  | "subagent_end"
  | "manual_note"
```

```ts
interface AgentEvent {
  id?: string
  agent: "hermes" | "openclaw" | "custom"
  event_type: AgentEventType
  session_id?: string
  conversation_id?: string
  message_id?: string
  parent_event_id?: string
  role?: "user" | "assistant" | "tool" | "system"
  content?: string
  tool_name?: string
  tool_input?: unknown
  tool_output?: unknown
  occurred_at: string
  metadata?: Record<string, unknown>
}
```

### 7.1 Source 映射

每个 `AgentEvent` 都会生成或关联一个 `Source`。

```text
AgentEvent
  -> mt_sources
  -> mt_proposals.source_id
  -> mt_records.source_id
```

这保证每条结构化记录都能追溯到原始 Agent 事件。

## 8. Observer Pipeline

### 8.1 流程

```text
AgentEvent
  -> deduplicate
  -> classify relevance
  -> match installed packs
  -> build extraction job
  -> run extractor
  -> normalize fields
  -> validate schema
  -> apply validators
  -> duplicate detection
  -> policy decision
  -> save proposals or commit records
```

### 8.2 Pack 匹配

每个 Pack 可以声明匹配规则。

```json
{
  "observe": {
    "eventTypes": ["user_message", "tool_result", "agent_end"],
    "keywords": ["卧推", "体重", "bench", "workout"],
    "minConfidence": 0.75
  }
}
```

v0.1 使用轻量规则：

- event type allowlist
- keyword matching
- schema description matching
- optional LLM classifier

### 8.3 写入策略

```text
high confidence + low risk
  -> auto commit

medium confidence
  -> proposal pending

low confidence
  -> ignored or needs_review

sensitive pack
  -> proposal pending
```

Pack 可以声明默认策略：

```json
{
  "writePolicy": {
    "default": "proposal",
    "autoCommitConfidence": 0.92,
    "sensitive": false
  }
}
```

## 9. HTTP Observer API

MemTable sidecar 暴露本地 HTTP API。

### 9.1 启动

```bash
memtable serve --http --port 3838
```

默认只监听 `127.0.0.1`。

### 9.2 Observe

```http
POST /v1/observe
Content-Type: application/json
```

```json
{
  "agent": "hermes",
  "event_type": "user_message",
  "session_id": "s_123",
  "message_id": "m_123",
  "role": "user",
  "content": "今天卧推 65kg 5x5，体重 90.4kg",
  "occurred_at": "2026-06-24T10:00:00+08:00"
}
```

返回：

```json
{
  "status": "ok",
  "matched_packs": ["fitness"],
  "proposals_created": 2,
  "records_committed": 0,
  "needs_review": 2
}
```

### 9.3 Query

```http
POST /v1/query
```

### 9.4 Ask

```http
POST /v1/ask
```

### 9.5 Proposals

```http
GET /v1/proposals
POST /v1/proposals/:id/commit
POST /v1/proposals/:id/reject
```

## 10. MCP Server

MCP Server 是工具面入口。

### 10.1 启动

```bash
memtable serve --mcp
```

或同时启动：

```bash
memtable serve --http --mcp
```

### 10.2 Core tools

```text
memtable.observe
memtable.ask
memtable.query
memtable.record.create
memtable.proposal.list
memtable.proposal.commit
memtable.proposal.reject
memtable.pack.list
memtable.schema.list
```

### 10.3 Pack tools

安装 Pack 后动态生成领域工具。

例如安装 `fitness`：

```text
memtable.fitness.propose
memtable.fitness.record_workout
memtable.fitness.record_body_weight
memtable.fitness.query_bench_progress
memtable.fitness.query_weekly_volume
```

### 10.4 MCP 与 Native Plugin 的关系

MCP 负责让 Agent 主动调用 MemTable。

Native Plugin 负责自动观察 Agent 事件。

最佳接入是二者同时启用。

```text
Agent -> MCP tools -> MemTable
Agent hooks -> HTTP observe -> MemTable
```

## 11. Hermes Enhancer 设计

Hermes 适配包命名：

```text
@memtable/agent-hermes
```

实际安装到 Hermes 后是一个 Python 插件。

### 11.1 安装体验

```bash
memtable agent enable hermes
```

执行步骤：

```text
1. 检查 Hermes 是否已安装
2. 初始化 MemTable 本地目录
3. 安装或确认 memtable sidecar
4. 写入 ~/.hermes/plugins/memtable/
5. 写入 plugin.yaml、__init__.py、schemas.py、tools.py
6. 注册或提示启用 Hermes plugin
7. 可选写入 Hermes MCP 配置
8. 安装 MemTable skill
9. 提示用户重启 Hermes gateway
```

### 11.2 Hermes 插件结构

```text
~/.hermes/plugins/memtable/
  plugin.yaml
  __init__.py
  schemas.py
  tools.py
  skill/
    SKILL.md
```

### 11.3 Hermes 工具

Hermes 插件注册工具：

```text
memtable_ask
memtable_record
memtable_propose
memtable_list_proposals
memtable_commit_proposal
```

这些工具内部调用本地 sidecar：

```text
Hermes tool
  -> http://127.0.0.1:3838/v1/*
  -> MemTable Runtime
```

### 11.4 Hermes hooks

注册 hooks：

```python
def register(ctx):
    ctx.register_tool(...)
    ctx.register_hook("pre_gateway_dispatch", on_pre_gateway_dispatch)
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("post_llm_call", on_post_llm_call)
    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)
    ctx.register_skill("memtable", Path(__file__).parent / "skill" / "SKILL.md")
```

事件映射：

```text
pre_gateway_dispatch -> user_message
post_tool_call       -> tool_result
post_llm_call        -> assistant_message / agent_end
on_session_start     -> session_start
on_session_end       -> session_end
subagent_stop        -> subagent_end
```

### 11.5 Hermes MCP 配置

如果用户只想启用工具面，可写入 MCP 配置：

```yaml
mcp_servers:
  memtable:
    command: "memtable"
    args: ["serve", "--mcp"]
```

### 11.6 Hermes Skill

Skill 用于指导 Agent 使用账本。

内容要点：

- 当用户给出数字化日志时，优先调用 `memtable_propose`
- 当用户问趋势、统计、变化、最长、最多、平均时，优先调用 `memtable_ask`
- 不要从聊天历史手算趋势
- 查询结果不足时明确说明 insufficient data

## 12. OpenClaw Enhancer 设计

OpenClaw 适配包命名：

```text
@memtable/openclaw-plugin
```

### 12.1 安装体验

```bash
memtable agent enable openclaw
```

执行步骤：

```text
1. 检查 openclaw CLI 是否可用
2. 初始化 MemTable 本地目录
3. 安装或确认 memtable sidecar
4. 安装 OpenClaw 插件
5. 写入插件配置
6. 启用插件
7. 提示或执行 gateway restart
```

也可使用 OpenClaw 原生命令：

```bash
openclaw plugins install npm:@memtable/openclaw-plugin
openclaw plugins enable memtable
openclaw gateway restart
```

### 12.2 OpenClaw 插件文件

```text
packages/agent-openclaw/
  package.json
  openclaw.plugin.json
  src/
    index.ts
```

`openclaw.plugin.json`：

```json
{
  "id": "memtable",
  "name": "MemTable",
  "description": "Structured ledger enhancer for OpenClaw agents.",
  "contracts": {
    "tools": [
      "memtable_ask",
      "memtable_record",
      "memtable_propose",
      "memtable_list_proposals",
      "memtable_commit_proposal"
    ]
  },
  "activation": {
    "onStartup": true
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "endpoint": {
        "type": "string",
        "default": "http://127.0.0.1:3838"
      },
      "observe": {
        "type": "boolean",
        "default": true
      }
    }
  }
}
```

### 12.3 OpenClaw 工具注册

```ts
export default definePluginEntry({
  id: "memtable",
  name: "MemTable",
  register(api) {
    api.registerTool({
      name: "memtable_ask",
      description: "Ask MemTable structured ledger a data question.",
      parameters: Type.Object({
        question: Type.String(),
      }),
      async execute(_id, params) {
        return postToMemTable("/v1/ask", params)
      },
    })
  },
})
```

### 12.4 OpenClaw hooks

```ts
api.on("message_received", async (event) => {
  await observe({
    agent: "openclaw",
    event_type: "user_message",
    content: event.content,
    message_id: event.messageId,
    session_id: event.sessionId,
    occurred_at: new Date().toISOString(),
    metadata: event.metadata,
  })
})

api.on("after_tool_call", async (event) => {
  await observe({
    agent: "openclaw",
    event_type: "tool_result",
    tool_name: event.toolName,
    tool_input: event.params,
    tool_output: event.result,
    occurred_at: new Date().toISOString(),
  })
})

api.on("agent_end", async (event) => {
  await observe({
    agent: "openclaw",
    event_type: "agent_end",
    content: event.output,
    occurred_at: new Date().toISOString(),
  })
})
```

### 12.5 Gateway lifecycle

`gateway_start`：

- 检查 MemTable sidecar 是否可达
- 如果配置允许，启动 sidecar
- 检查 Pack 是否安装
- 上报插件诊断信息

`gateway_stop`：

- flush pending observe events
- 关闭插件内队列

## 13. Log Watcher

Log Watcher 是 fallback 接入。

```bash
memtable watch ~/.hermes/logs --agent hermes
memtable watch ~/.openclaw/runs --agent openclaw
memtable ingest ./transcript.jsonl --agent custom
```

Watcher 职责：

- 读取新增日志
- 解析 JSONL / Markdown / plain text
- 转成 `AgentEvent`
- 调用 `/v1/observe`
- 保存 cursor，避免重复导入

v0.1 不保证完全适配所有 Hermes/OpenClaw 日志格式，优先作为历史导入和兜底模式。

## 14. Pack 设计

Pack 定义领域记账能力。

```text
packs/fitness/
  pack.json
  schemas/
    workout.schema.json
    body_weight.schema.json
  extractors/
    prompts.md
  queries/
    bench_progress.query.json
    weekly_volume.query.json
  validators/
    rules.json
  tools/
    mcp.json
  examples/
    logs.md
```

### 14.1 pack.json

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
    "schemas/workout.schema.json",
    "schemas/body_weight.schema.json"
  ],
  "extractors": [
    "extractors/prompts.md"
  ],
  "queries": [
    "queries/bench_progress.query.json",
    "queries/weekly_volume.query.json"
  ],
  "validators": [
    "validators/rules.json"
  ],
  "tools": "tools/mcp.json"
}
```

## 15. 数据模型

v0.1 使用 SQLite。

### 15.1 核心表

```sql
CREATE TABLE mt_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  status TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name)
);

CREATE TABLE mt_sources (
  id TEXT PRIMARY KEY,
  agent TEXT,
  event_type TEXT,
  session_id TEXT,
  conversation_id TEXT,
  message_id TEXT,
  kind TEXT NOT NULL,
  reference TEXT,
  excerpt TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE mt_schemas (
  id TEXT PRIMARY KEY,
  pack_id TEXT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(name, version)
);

CREATE TABLE mt_proposals (
  id TEXT PRIMARY KEY,
  schema_name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  data_json TEXT NOT NULL,
  source_id TEXT,
  confidence REAL,
  status TEXT NOT NULL,
  validation_errors_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mt_records (
  id TEXT PRIMARY KEY,
  schema_name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  data_json TEXT NOT NULL,
  occurred_at TEXT,
  source_id TEXT,
  confidence REAL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE mt_audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor TEXT,
  created_at TEXT NOT NULL
);
```

### 15.2 事件去重表

```sql
CREATE TABLE mt_observed_events (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  external_event_id TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE(agent, fingerprint)
);
```

### 15.3 索引

```sql
CREATE INDEX idx_mt_sources_agent_session ON mt_sources(agent, session_id);
CREATE INDEX idx_mt_sources_message ON mt_sources(message_id);
CREATE INDEX idx_mt_records_schema ON mt_records(schema_name);
CREATE INDEX idx_mt_records_occurred_at ON mt_records(occurred_at);
CREATE INDEX idx_mt_records_source_id ON mt_records(source_id);
CREATE INDEX idx_mt_proposals_status ON mt_proposals(status);
CREATE INDEX idx_mt_observed_events_agent ON mt_observed_events(agent);
```

## 16. Query DSL

MemTable 不允许 Agent 直接执行 SQL。

```ts
await ledger.query({
  collection: "fitness.workout",
  filter: {
    exercise: { eq: "bench_press" },
    occurred_at: { gte: "2026-03-24" }
  },
  aggregate: {
    max_weight: {
      op: "max",
      field: "weight_kg"
    }
  },
  groupBy: {
    field: "occurred_at",
    interval: "week"
  }
})
```

Query Engine 规则：

- collection 必须来自已注册 Schema
- field 必须来自 JSON Schema properties
- operator 必须来自 allowlist
- SQL 必须参数化
- 返回结果必须包含 `records_used` 或 `source_ids`

## 17. 自然语言查询

`ask` 不直接让 LLM 凭空回答。

```text
question
  -> select installed packs
  -> select query template or build query plan
  -> validate query plan
  -> execute query
  -> synthesize answer with evidence
```

无数据时返回：

```json
{
  "status": "insufficient_data",
  "reason": "需要至少两条卧推训练记录才能判断趋势。",
  "records_used": 1
}
```

## 18. 安装与启用

### 18.1 全量本地安装

```bash
npm install -g memtable
memtable init
memtable pack install fitness
memtable serve --http --mcp
```

### 18.2 Hermes 增强

```bash
memtable agent enable hermes
```

可选手动方式：

```bash
hermes plugins install Coooder-Crypto/memtable-hermes --enable
```

### 18.3 OpenClaw 增强

```bash
memtable agent enable openclaw
```

可选手动方式：

```bash
openclaw plugins install npm:@memtable/openclaw-plugin
openclaw plugins enable memtable
openclaw gateway restart
```

## 19. 安全设计

### 19.1 Sidecar 安全

- 默认只监听 `127.0.0.1`
- 默认不启用远程访问
- HTTP API 支持本地 token
- Agent plugin 配置中只保存 endpoint 和 token reference
- 敏感 Pack 默认 proposal-first

### 19.2 插件安全

Hermes：

- 第三方插件需要用户显式启用
- MemTable 插件只向本地 sidecar 发请求
- 插件不直接写数据库

OpenClaw：

- 插件 manifest 声明 tools
- hooks 有 timeout
- 插件配置可禁用 observe
- 插件不直接写数据库

### 19.3 写入安全

- 所有写入绑定 Schema
- 所有写入保存 Source
- 所有写入经过 validation
- Proposal 提交使用事务
- Record 更新和删除写 audit log
- 删除默认软删除

## 20. 测试策略

### 20.1 Core tests

- Pack manifest validation
- Schema registry
- Observer pipeline
- Proposal state machine
- Query DSL compiler
- Audit log
- Deduplication

### 20.2 Hermes adapter tests

- 生成插件目录
- 注册工具 schema
- hook event 转 `AgentEvent`
- HTTP sidecar 调用失败时不阻塞 Hermes 主流程
- Skill 文件安装

### 20.3 OpenClaw adapter tests

- `openclaw.plugin.json` manifest 校验
- `api.registerTool` 工具注册
- `api.on` hooks 注册
- hook event 转 `AgentEvent`
- gateway_start health check

### 20.4 End-to-end tests

```text
memtable init
memtable pack install ./packs/fitness
memtable serve --http --mcp
simulate hermes user_message
simulate openclaw after_tool_call
proposal list
commit proposal
ask trend question
```

## 21. v0.1 实施计划

### Milestone 1：Core Runtime

- TypeScript monorepo
- SQLite storage
- Pack Manager
- Schema Registry
- Proposal / Record
- Audit Log

### Milestone 2：Observer API

- `AgentEvent` 标准模型
- `/v1/observe`
- event dedup
- pack matching
- extraction pipeline
- write policy

### Milestone 3：Fitness Pack

- workout schema
- body_weight schema
- extractor prompt
- query templates
- validators
- example logs

### Milestone 4：CLI

- `memtable init`
- `memtable pack install`
- `memtable serve`
- `memtable proposal list`
- `memtable proposal commit`
- `memtable ask`
- `memtable agent enable hermes`
- `memtable agent enable openclaw`

### Milestone 5：MCP Server

- Core tools
- Pack tools
- stdio transport
- HTTP sidecar bridge

### Milestone 6：Hermes Enhancer

- Python plugin template
- tool handlers
- hooks
- skill
- installer

### Milestone 7：OpenClaw Enhancer

- TypeScript plugin
- manifest
- tool handlers
- hooks
- installer

## 22. v0.1 验收标准

### 22.1 本地闭环

```bash
memtable init
memtable pack install ./packs/fitness
memtable ingest ./packs/fitness/examples/logs.md --pack fitness
memtable proposal commit --all
memtable ask "最近三个月卧推进步了吗？"
```

必须返回：

- 结论
- 使用记录数
- 时间范围
- 来源引用
- insufficient data 判断

### 22.2 Hermes 闭环

```bash
memtable agent enable hermes
```

用户在 Hermes 中输入：

```text
今天卧推 65kg 5x5，体重 90.4kg
```

MemTable 应创建 fitness proposals。

用户再问：

```text
最近三个月卧推进步了吗？
```

Hermes 应能通过 MemTable 工具查询结构化账本。

### 22.3 OpenClaw 闭环

```bash
memtable agent enable openclaw
```

OpenClaw 收到用户消息或工具结果后，MemTable 应通过 plugin hook 接收事件，并创建 proposal 或 record。

OpenClaw 应能通过注册工具查询 MemTable。

## 23. 延后能力

以下能力不进入 v0.1：

- 远程 Pack Registry
- GitHub Pack 安装
- Pack 签名
- 多用户权限
- Dashboard
- PostgreSQL adapter
- DuckDB adapter
- 任意代码 validator
- 跨 Pack join
- 全自动 Schema 生成
- 云同步

## 24. 关键风险

### 24.1 Hook 事件格式不稳定

Hermes 和 OpenClaw 的 hooks 可能随版本变化。

应对：

- Adapter 层隔离版本差异
- 保存原始 event metadata
- 为每个 Agent adapter 做 fixture tests
- `memtable agent doctor <agent>` 检查兼容性

### 24.2 自动观察过度写入

自动观察可能把无关内容提取成 proposal。

应对：

- 默认 proposal-first
- Pack observe rules
- dedup
- confidence threshold
- 用户可禁用 Pack observe

### 24.3 插件阻塞 Agent 主流程

MemTable sidecar 不可用时，插件不能拖垮 Agent。

应对：

- hook 超时
- 本地队列
- fail open
- 后台重试
- 插件状态诊断

### 24.4 MCP 只解决主动调用

如果只做 MCP，自动沉淀数据的体验不完整。

应对：

- v0.1 同时做 HTTP Observer
- Hermes/OpenClaw Native Enhancer 是核心交付物

## 25. 总结

MemTable 的技术核心不是数据库，也不是单纯 MCP 工具。

它应该成为现有 Agent 的结构化账本增强层：

```text
Native plugin hooks capture events.
MCP/native tools expose ledger operations.
Pack Manager defines domain structure.
Runtime guarantees validation, provenance, and queryability.
```

v0.1 的最小成功标准是：Hermes 和 OpenClaw 都能在不改核心源码的情况下，通过 MemTable 插件自动观察交互，并通过 MemTable 工具查询和写入结构化账本。

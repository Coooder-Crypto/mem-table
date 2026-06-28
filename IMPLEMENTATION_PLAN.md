# MemTable 实施计划

## 1. 计划目标

本计划用于指导 MemTable 从产品文档和技术方案进入可实现阶段。

v0.1 的目标不是做完整平台，而是完成一个可验证闭环：

```text
Install MemTable
  -> Install fitness Pack
  -> Enable Hermes / OpenClaw enhancer
  -> Observe agent events
  -> Extract proposals
  -> Commit records
  -> Query structured ledger from the agent
```

v0.1 的核心验收标准：

- 本地 SQLite 账本可用
- 本地 Pack 安装可用
- HTTP Observer 可接收标准 AgentEvent
- MCP Server 可暴露基础工具
- Hermes Enhancer 能把 hooks 事件转成 AgentEvent
- OpenClaw Enhancer 能把 hooks 事件转成 AgentEvent
- fitness Pack 能完成自然语言日志到 Proposal 的闭环

## 2. 工作流原则

### 2.1 先闭环，后抽象

只围绕 `fitness` Pack、Hermes、OpenClaw 三个验证对象做 v0.1。

不在 v0.1 做：

- 远程 Pack Registry
- GitHub Pack 安装
- Dashboard
- 多租户
- 云同步
- 任意代码 validator
- 全自动 Schema 生成

### 2.2 先 Observer，后智能化

自动观察能力是 MemTable 区别于普通 MCP 工具的关键。

优先做：

- AgentEvent 标准模型
- HTTP `/v1/observe`
- Pack matching
- Proposal creation
- Source tracing

暂缓：

- 高级 LLM classifier
- 复杂 query planner
- 跨 Pack 分析

### 2.3 先 proposal-first，后 auto-commit

v0.1 默认不自动写入正式 records。

默认策略：

- 自动生成 Proposal
- 用户或 Agent 显式 commit
- 高置信度 auto-commit 作为配置项预留，不作为默认行为

## 3. 版本切分

### v0.0：文档和项目骨架

目标：把仓库从文档项目变成可开发的 TypeScript monorepo。

交付物：

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `packages/core`
- `packages/cli`
- `packages/server`
- `packages/agent-openclaw`
- `packages/agent-hermes`
- `packs/fitness`
- 基础测试框架

验收：

```bash
pnpm install
pnpm build
pnpm test
```

### v0.1-alpha.1：Core Runtime

目标：账本核心能力可用。

交付物：

- SQLite storage adapter
- migration runner
- `mt_packs`
- `mt_schemas`
- `mt_sources`
- `mt_proposals`
- `mt_records`
- `mt_audit_log`
- Runtime open/init
- Schema registry
- Proposal create/list/commit/reject
- Record create/list

验收：

```bash
memtable init
memtable schema list
memtable proposal list
```

测试：

- migration 幂等
- proposal 状态机
- commit 事务
- audit log 写入

### v0.1-alpha.2：Pack Manager + Fitness Pack

目标：领域能力可以通过 Pack 安装。

交付物：

- local Pack installer
- `pack.json` 校验
- Pack asset registry
- fitness Pack
- `fitness.workout` schema
- `fitness.body_weight` schema
- declarative validator
- example logs

验收：

```bash
memtable pack install ./packs/fitness
memtable pack list
memtable schema list
```

测试：

- manifest 校验
- Pack 重复安装
- schema version 注册
- validator 规则校验

### v0.1-alpha.3：HTTP Observer

目标：外部 Agent 可以把事件发送给 MemTable。

交付物：

- `AgentEvent` 类型
- HTTP server
- `POST /v1/observe`
- event dedup
- source creation
- Pack matching
- proposal creation
- `GET /v1/proposals`
- `POST /v1/proposals/:id/commit`
- `POST /v1/proposals/:id/reject`

验收：

```bash
memtable serve --http
curl -X POST http://127.0.0.1:3838/v1/observe \
  -H "Content-Type: application/json" \
  -d '{"agent":"custom","event_type":"user_message","content":"今天卧推 65kg 5x5，体重 90.4kg","occurred_at":"2026-06-24T10:00:00+08:00"}'
memtable proposal list
```

预期：

- 创建 `fitness.workout` Proposal
- 创建 `fitness.body_weight` Proposal
- Proposal 关联 Source

测试：

- 同一事件重复 observe 不重复生成 proposal
- 无关文本不生成 proposal
- sidecar 返回结构化统计

### v0.1-alpha.4：Query Engine + Ask

目标：账本数据可以被稳定查询。

交付物：

- Query DSL
- DSL validation
- SQLite JSON query compiler
- aggregate
- groupBy day/week/month
- `POST /v1/query`
- `POST /v1/ask`
- fitness query templates
- insufficient data 返回

验收：

```bash
memtable proposal commit --all
memtable ask "最近三个月卧推进步了吗？"
```

预期返回：

- answer
- status
- records_used
- time_range
- source_ids

测试：

- 字段必须来自 schema
- operator allowlist
- SQL 参数化
- insufficient data

### v0.1-alpha.5：MCP Server

目标：Agent 能主动调用 MemTable。

交付物：

- `memtable serve --mcp`
- stdio MCP transport
- core tools
- Pack tools
- tool input schema
- tool result schema

Core tools：

```text
memtable.observe
memtable.ask
memtable.query
memtable.proposal.list
memtable.proposal.commit
memtable.proposal.reject
memtable.pack.list
memtable.schema.list
```

Fitness tools：

```text
memtable.fitness.propose
memtable.fitness.record_workout
memtable.fitness.record_body_weight
memtable.fitness.query_bench_progress
```

验收：

- MCP client 能列出工具
- 调用 `memtable.ask` 能返回账本结果
- 调用 `memtable.proposal.commit` 能提交 proposal

### v0.1-alpha.6：Hermes Enhancer

目标：Hermes 不改核心源码即可自动观察和主动查询 MemTable。

交付物：

- `packages/agent-hermes`
- Hermes plugin template
- `plugin.yaml`
- `__init__.py`
- `schemas.py`
- `tools.py`
- Hermes skill
- `memtable agent enable hermes`
- sidecar health check

Hermes tools：

```text
memtable_ask
memtable_record
memtable_propose
memtable_list_proposals
memtable_commit_proposal
```

Hermes hooks：

```text
pre_gateway_dispatch -> user_message
post_tool_call       -> tool_result
post_llm_call        -> assistant_message / agent_end
on_session_start     -> session_start
on_session_end       -> session_end
```

验收：

```bash
memtable agent enable hermes
```

在 Hermes 中输入：

```text
今天卧推 65kg 5x5，体重 90.4kg
```

预期：

- MemTable 收到 Hermes `user_message`
- 创建 fitness proposals
- Hermes 可调用 `memtable_ask`

测试：

- Hermes event 转 AgentEvent
- sidecar 不可用时插件不阻塞 Hermes
- hook timeout
- skill 安装路径正确

### v0.1-alpha.7：OpenClaw Enhancer

目标：OpenClaw 不改核心源码即可自动观察和主动查询 MemTable。

交付物：

- `packages/agent-openclaw`
- `openclaw.plugin.json`
- TypeScript plugin entry
- `api.registerTool(...)`
- `api.on(...)` hooks
- `memtable agent enable openclaw`
- gateway health check

OpenClaw tools：

```text
memtable_ask
memtable_record
memtable_propose
memtable_list_proposals
memtable_commit_proposal
```

OpenClaw hooks：

```text
message_received -> user_message
after_tool_call  -> tool_result
agent_end        -> agent_end
gateway_start    -> health check
gateway_stop     -> flush queue
```

验收：

```bash
memtable agent enable openclaw
```

OpenClaw 收到用户消息或工具结果后：

- MemTable 收到 AgentEvent
- 创建 proposal
- OpenClaw 可调用 MemTable tool 查询账本

测试：

- manifest 校验
- hooks 注册
- event 转换
- sidecar 不可用时 fail open

### v0.1-beta：端到端稳定化

目标：v0.1 发布前稳定性、文档和 demo 完成。

交付物：

- E2E demo script
- README
- Quickstart
- Hermes setup guide
- OpenClaw setup guide
- fitness demo
- troubleshooting
- `memtable doctor`
- `memtable agent doctor hermes`
- `memtable agent doctor openclaw`

验收：

```bash
memtable init
memtable pack install ./packs/fitness
memtable serve --http
memtable serve --mcp
memtable agent enable hermes
memtable agent enable openclaw
```

当前 CLI 中 `serve --http` 与 `serve --mcp` 是两个独立运行模式，需要分别在不同进程启动。

至少完成：

- CLI 本地闭环
- HTTP Observer 闭环
- MCP tools 闭环
- Hermes enhancer 闭环
- OpenClaw enhancer 闭环

## 4. 优先级

### P0

- SQLite storage
- Pack Manager
- fitness Pack
- AgentEvent
- HTTP Observer
- Proposal state machine
- Query DSL
- MCP core tools
- Hermes Enhancer 最小闭环
- OpenClaw Enhancer 最小闭环

### P1

- Ask query template
- Agent Work Pack
- Log Watcher
- `memtable doctor`
- `memtable agent doctor`
- source tracing UI in CLI
- Pack observe rules

### P2

- DuckDB adapter
- Python SDK
- GitHub Pack install
- Pack version upgrades
- Dashboard Inspector
- Pack signing
- more Agent enhancers

## 5. 依赖关系

```text
Project skeleton
  -> Core Runtime
  -> Pack Manager
  -> Fitness Pack
  -> HTTP Observer
  -> Query Engine
  -> MCP Server
  -> Hermes Enhancer
  -> OpenClaw Enhancer
  -> E2E Demo
```

Hermes Enhancer 和 OpenClaw Enhancer 都依赖：

- HTTP Observer
- AgentEvent model
- sidecar health API
- proposal API
- ask API

MCP Server 依赖：

- core runtime
- query engine
- proposal API
- Pack tools manifest

## 6. 验收场景

### 6.1 本地 CLI 场景

输入：

```bash
memtable init
memtable pack install ./packs/fitness
memtable ingest ./packs/fitness/examples/logs.md --pack fitness
memtable proposal commit --all
memtable ask "最近三个月卧推进步了吗？"
```

通过标准：

- 生成 workout 和 body_weight records
- 查询返回基于 records 的趋势
- 返回 records_used、time_range、source_ids

### 6.2 Hermes 场景

输入：

```bash
memtable agent enable hermes
```

用户在 Hermes 中说：

```text
今天卧推 65kg 5x5，体重 90.4kg
```

通过标准：

- Hermes plugin hook 被触发
- MemTable 收到 `agent=hermes` 的 AgentEvent
- 创建 fitness proposals
- Hermes 可通过 MemTable tool 查询

### 6.3 OpenClaw 场景

输入：

```bash
memtable agent enable openclaw
```

OpenClaw 产生 `message_received` 或 `after_tool_call` 事件。

通过标准：

- OpenClaw plugin hook 被触发
- MemTable 收到 `agent=openclaw` 的 AgentEvent
- 创建 proposal 或 record
- OpenClaw 可通过工具调用 `memtable_ask`

### 6.4 失败恢复场景

当 MemTable sidecar 未启动：

- Hermes / OpenClaw 主流程不能被阻塞
- 插件记录本地失败状态
- 用户可运行 `memtable agent doctor <agent>` 查看问题

## 7. 文档任务

v0.1 需要以下文档：

- `README.md`
- `docs/quickstart.md`
- `docs/packs.md`
- `docs/observer.md`
- `docs/mcp.md`
- `docs/hermes.md`
- `docs/openclaw.md`
- `docs/security.md`
- `docs/troubleshooting.md`

## 8. 发布顺序

### Internal alpha

目标用户：项目作者。

要求：

- 本地 demo 可跑
- fitness Pack 可用
- HTTP Observer 可用

### Public alpha

目标用户：Agent 开发者。

要求：

- MCP Server 可用
- Hermes / OpenClaw 至少一个 enhancer 可用
- 文档可跟随完成安装

### Public beta

目标用户：早期开源用户。

要求：

- Hermes 和 OpenClaw enhancer 都可用
- Agent doctor 可用
- E2E demo 可复现
- 已知风险写入文档

## 9. 关键风险和决策

### 9.1 是否先做 Hermes 还是 OpenClaw

建议先做 OpenClaw Enhancer。

原因：

- OpenClaw 插件是 TypeScript，和 MemTable 主工程语言一致
- manifest、tools、hooks 结构更适合工程化测试
- 可以更快验证 AgentEvent 和 Observer 设计

Hermes 放在第二个 enhancer。

原因：

- Hermes 插件是 Python，需要跨语言打包和安装
- 但 Hermes 有 skills 和 MCP，产品展示价值强

### 9.2 是否 v0.1 默认 auto-commit

建议不默认 auto-commit。

原因：

- 自动写入污染账本风险高
- Proposal-first 更符合早期产品信任建立
- auto-commit 可以作为 Pack 配置保留

### 9.3 是否先做 Dashboard

建议不做。

原因：

- CLI 足够支持 v0.1 验证
- Dashboard 会拉大前端工作量
- 早期核心风险在 Agent 接入和写入正确性

## 10. 下一步

建议下一次开发从 v0.0 开始：

1. 初始化 TypeScript monorepo。
2. 搭建 `packages/core`、`packages/cli`、`packages/server`。
3. 实现 SQLite migration 和基础表。
4. 创建 `packs/fitness` 最小 Pack。
5. 写第一个 E2E fixture：自然语言健身日志到 Proposal。

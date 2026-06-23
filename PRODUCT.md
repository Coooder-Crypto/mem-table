# MemTable 产品文档

## 1. 产品定位

MemTable 是一个面向 Agent 的结构化记忆层。

它不试图替代向量数据库、RAG 或长期记忆系统，而是补上 Agent 架构中缺失的一层：将对话、工具结果和用户行为中适合结构化的信息，转化为可验证、可查询、可聚合、可追溯的数据账本。

一句话定位：

> Memory recalls what happened. Ledger computes what changed.

中文表述：

> Memory 解决回忆，Ledger 解决认知。

## 2. 背景与问题

当前 Agent 系统普遍重视 Memory，包括 Conversation History、Vector Database、Long-term Memory、Semantic Recall 和 RAG。

这些能力擅长解决文本召回问题，例如：

- 用户过去说过什么
- 某个概念曾经如何被描述
- 哪些历史上下文与当前问题语义相关

但在长期使用 Agent 时，很多真正重要的问题并不是知识问题，而是数据问题。

例如：

- 最近三个月卧推进步了吗？
- 我的体重变化趋势如何？
- 哪些项目持续拖延时间最长？
- 这个月在哪些方面花钱最多？
- 某个 Agent 最近失败最多的任务类型是什么？

这些问题需要的是结构化记录、时间排序、聚合计算、趋势分析和状态追踪。让大模型从几百上千条自然语言记忆中重新提取、排序和计算，本质上是在让 LLM 扮演数据库。

MemTable 的核心假设是：

> Agent 不缺记忆，缺的是账本。

## 3. 目标用户

### 3.1 Agent 应用开发者

构建个人助理、研究助理、代码 Agent、工作流 Agent 或垂直领域 Agent 的开发者，需要让 Agent 长期维护结构化状态。

### 3.2 AI 工具与框架作者

正在构建 Agent Framework、Memory Framework、RAG 系统或自动化平台的团队，可以将 MemTable 作为结构化记忆组件接入。

### 3.3 高强度个人 Agent 用户

长期使用 Agent 管理健身、财务、项目、时间、习惯、健康记录的人，需要 Agent 能稳定回答趋势类和统计类问题。

## 4. 产品目标

MemTable 的目标不是再造一个数据库。数据库已经足够成熟。

MemTable 真正要解决的是 Agent 与数据库之间的协议层和工作流层。

核心目标包括：

- 自动发现对话和工具结果中适合结构化的信息
- 将自然语言内容映射到明确的数据 Schema
- 提供安全、可验证、可回滚的写入机制
- 保留每条记录的来源、置信度和变更历史
- 为 Agent 提供原生的查询接口
- 让 Agent 知道什么时候应该查账本，而不是查文本记忆
- 让开发者像安装软件包一样，为自己的 Agent 安装某个领域的结构化记账能力

### 4.1 产品形态

MemTable 的第一产品形态应是：

> Agent Ledger Runtime + Pack Manager

它由四个部分组成：

- MemTable Core：本地结构化账本运行时，负责存储、校验、写入、查询和审计
- MemTable SDK：面向 TypeScript、Python 等语言的开发者接入层
- MemTable Packs：面向具体领域的结构化记忆能力包
- MemTable MCP Server：将已安装的 Pack 暴露为 Agent 可调用的工具

开发者的理想接入体验应接近包管理器：

```bash
memtable init
memtable install fitness
memtable install project
memtable install agent-work
```

安装 Pack 后，Agent 不只获得一些表结构，而是获得某个领域完整的记账能力，包括 Schema、提取规则、校验逻辑、查询模板、迁移脚本和工具定义。

## 5. 非目标

MemTable 初期不做以下事情：

- 不替代 PostgreSQL、SQLite、DuckDB、ClickHouse 等数据库
- 不替代向量数据库或语义记忆系统
- 不追求全自动、无约束地生成任意 Schema
- 不让 Agent 直接拼接并执行任意 SQL
- 不优先解决大规模分布式存储问题
- 不把区块链作为账本实现
- 不把 MemTable Pack 设计成普通代码包管理器，Pack 安装的是领域记账能力，而不是任意代码依赖

## 6. 核心概念

### 6.1 Ledger

Ledger 是 Agent 的结构化账本，由一组可查询、可追溯、可版本化的数据记录组成。

Ledger 中的数据适合表达：

- 指标
- 状态
- 事件
- 记录
- 变更
- 时间序列

### 6.2 Record

Record 是 Ledger 中的最小写入单元。

示例：

```json
{
  "type": "fitness.workout",
  "exercise": "bench_press",
  "weight_kg": 65,
  "reps": 5,
  "sets": 5,
  "occurred_at": "2026-06-23",
  "source": {
    "kind": "conversation",
    "message_id": "msg_123"
  },
  "confidence": 0.94
}
```

### 6.3 Schema

Schema 定义一种 Record 的结构、字段类型、单位、约束和校验规则。

MemTable 初期采用半自动 Schema 策略：

- 开发者可以显式定义 Schema
- Agent 可以建议 Schema
- 用户或开发者确认后启用 Schema

### 6.4 Source

Source 记录一条数据从哪里来。

常见来源包括：

- 对话消息
- 工具调用结果
- 文件
- API 响应
- 用户手动输入
- 其他 Agent 的输出

### 6.5 Proposal

Proposal 是待写入的候选记录。

Agent 从文本或工具结果中提取结构化数据后，不一定立即写入 Ledger，而是先形成 Proposal。

Proposal 可以被：

- 自动提交
- 用户确认
- 开发者审核
- 拒绝
- 修改后提交

### 6.6 Query

Query 是面向 Agent 的受控查询接口。

MemTable 不鼓励 Agent 直接生成 SQL，而是提供受限 DSL 或函数接口，再由系统翻译到底层数据库查询。

示例：

```ts
ledger.query({
  collection: "fitness_workouts",
  metric: "max_weight",
  filter: {
    exercise: "bench_press",
    occurred_at: {
      gte: "2026-03-23"
    }
  },
  groupBy: "week"
})
```

### 6.7 Pack

Pack 是 MemTable 的领域能力包。

一个 Pack 描述某个领域中应该如何记账、如何提取数据、如何校验数据、如何查询数据，以及如何把这些能力暴露给 Agent。

示例 Pack：

- fitness
- finance
- project
- health
- habit
- time_tracking
- agent_work
- devlog
- research

Pack 安装的不是普通代码依赖，而是某个领域的结构化记忆能力。

典型目录结构：

```text
fitness/
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
    rules.ts
  migrations/
    001_init.sql
  tools/
    mcp.json
  examples/
    logs.md
```

`pack.json` 是 Pack 的入口文件。

示例：

```json
{
  "name": "fitness",
  "version": "0.1.0",
  "description": "Structured fitness ledger for workouts and body metrics.",
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
    "validators/rules.ts"
  ],
  "migrations": [
    "migrations/001_init.sql"
  ],
  "tools": "tools/mcp.json"
}
```

### 6.8 Registry

Registry 是 Pack 的发现、安装和版本管理机制。

MemTable 初期可以支持三类来源：

- 官方 Pack
- GitHub Pack
- 本地 Pack

示例：

```bash
memtable install fitness
memtable install github:user/memtable-pack-fitness
memtable install ./packs/fitness
```

### 6.9 Tool Surface

Tool Surface 是 Pack 暴露给 Agent 的工具集合。

例如安装 `fitness` Pack 后，MCP Server 可以暴露：

```text
memtable.fitness.record_workout
memtable.fitness.record_body_weight
memtable.fitness.query_progress
memtable.fitness.query_training_volume
```

Agent 不需要直接理解底层数据库表结构，而是通过受控工具完成记录和查询。

## 7. 核心能力

### 7.1 结构化信息发现

从自然语言、工具结果和文件中识别适合写入 Ledger 的信息。

示例输入：

```text
今天卧推 65kg，做了 5 组，每组 5 次。体重 90.4kg。
```

可能生成两个 Proposal：

```json
[
  {
    "type": "fitness.workout",
    "exercise": "bench_press",
    "weight_kg": 65,
    "sets": 5,
    "reps": 5,
    "occurred_at": "2026-06-23"
  },
  {
    "type": "fitness.body_weight",
    "weight_kg": 90.4,
    "occurred_at": "2026-06-23"
  }
]
```

### 7.2 Schema 管理

支持定义、注册、迁移和禁用 Schema。

初期建议支持：

- JSON Schema
- Zod
- Pydantic

不同语言 SDK 可以使用不同 Schema 工具，但底层需要归一为通用 Schema 描述。

### 7.3 安全写入

所有写入都必须经过校验和审计。

写入流程：

```text
Input
  -> Extract
  -> Validate
  -> Propose
  -> Commit
  -> Audit Log
```

安全机制包括：

- 类型校验
- 必填字段校验
- 单位规范化
- 时间规范化
- 置信度评分
- 重复记录检测
- 人工确认策略
- 回滚机制

### 7.4 可追溯性

每条 Record 都应包含来源信息。

Agent 在回答问题时不仅能给出结论，还能解释数据来源。

例如：

```text
过去 12 周你的卧推最高训练重量从 60kg 增长到 72.5kg，增长 12.5kg。
该结论基于 18 条 fitness.workout 记录，时间范围为 2026-04-01 至 2026-06-23。
```

### 7.5 Agent Native 查询

为 Agent 提供比 SQL 更安全、更稳定的查询接口。

接口需要支持：

- 过滤
- 排序
- 分组
- 聚合
- 时间窗口
- 趋势计算
- 异常检测
- 查询解释

### 7.6 查询结果解释

MemTable 不只返回原始数据，也可以返回适合 Agent 使用的结构化结果。

示例：

```json
{
  "answer": {
    "trend": "increasing",
    "start_value": 60,
    "end_value": 72.5,
    "delta": 12.5,
    "unit": "kg"
  },
  "records_used": 18,
  "time_range": {
    "from": "2026-04-01",
    "to": "2026-06-23"
  }
}
```

### 7.7 Pack 管理

MemTable 应支持开发者以包管理器方式安装、升级、移除和发布领域 Pack。

核心命令：

```bash
memtable search fitness
memtable install fitness
memtable install github:user/memtable-pack-fitness
memtable list
memtable upgrade fitness
memtable remove finance
```

安装 Pack 时，MemTable 需要完成：

- 注册 Schema
- 执行 migration
- 安装 extractor
- 安装 validator
- 注册 query template
- 生成或更新 MCP tool manifest
- 写入 Pack 版本和安装状态

### 7.8 MCP 工具生成

MemTable MCP Server 应根据已安装 Pack 动态暴露工具。

例如 `fitness` Pack 可以暴露训练记录和训练分析工具，`agent_work` Pack 可以暴露任务记录、失败分析和项目延期查询工具。

这使得 Agent 接入 MemTable 时，不需要直接写 SQL，也不需要在 prompt 中硬编码每个领域的数据结构。

## 8. MVP 范围

第一版应避免抽象过度，建议聚焦一个清晰场景。

推荐 MVP 场景：

### 8.1 Fitness Ledger

输入自然语言健身日志，自动形成训练账本，并回答趋势问题。

示例问题：

- 最近三个月卧推进步了吗？
- 哪个动作训练频率最高？
- 本月训练总量相比上月如何？
- 体重和训练表现是否有明显相关？

### 8.2 Agent Work Ledger

记录 Agent 自己完成任务的过程、结果和失败原因。

示例问题：

- 最近失败最多的任务类型是什么？
- 哪些项目持续拖延时间最长？
- 哪些工具调用最容易失败？
- 某个 Agent 最近一周主要把时间花在哪里？

两个方向中，Fitness Ledger 更容易演示给普通用户，Agent Work Ledger 更贴近开发者基础设施。

建议第一版选择一个主 demo，另一个作为第二个示例。

从产品形态看，第一版 demo 应以 Pack 形式交付。例如 `fitness` demo 不只是写在示例代码里，而是一个真实可安装的 `memtable-pack-fitness`。

## 9. MVP 功能清单

### 9.1 必须支持

- 定义 Schema
- 安装本地 Pack
- 从文本中提取结构化 Proposal
- 校验 Proposal
- 提交 Record
- 查询 Record
- 聚合和趋势分析
- 查看来源
- 生成基础 MCP tool manifest
- 导出数据

### 9.2 可以暂缓

- 全自动 Schema 生成
- 多 Agent 协作写入
- 复杂权限系统
- 分布式部署
- 高级数据血缘分析
- 可视化 Dashboard
- 多模态输入
- 远程 Pack Registry
- Pack 评分、签名和信任系统

## 10. 推荐技术架构

### 10.1 初期架构

```text
Application / Agent Framework
          |
  MemTable SDK / MCP Server / CLI
          |
  Pack Manager / Extractor / Validator / Query API
          |
      SQLite / DuckDB
```

### 10.2 组件

#### SDK

提供 TypeScript 和 Python SDK。

初期可以优先 TypeScript，因为主流 Agent 应用和工具调用生态较活跃。

#### Pack Manager

负责安装、升级、移除和加载 Pack。

Pack Manager 需要处理：

- Pack manifest 解析
- Schema 注册
- migration 执行
- extractor 加载
- validator 加载
- query template 注册
- tool manifest 生成
- Pack 版本和兼容性检查

#### Extractor

负责调用 LLM，将输入内容转换为候选结构化记录。

#### Schema Registry

管理可用 Schema、版本和字段约束。

#### Write Guard

负责校验、去重、规范化和提交策略。

#### Storage Adapter

适配不同底层数据库。

初期支持：

- SQLite
- DuckDB

后续支持：

- PostgreSQL
- Supabase
- ClickHouse

#### Query Engine

将 Agent 查询 DSL 转换为数据库查询，并返回结构化结果。

#### MCP Server

根据已安装 Pack 暴露 Agent 可调用工具。

MCP Server 是 MemTable 面向 Agent 的主要运行入口之一。

#### CLI

提供初始化、安装 Pack、导入数据、查询、调试和导出能力。

## 11. API 草案

### 11.1 安装 Pack

```ts
await ledger.install("fitness")
await ledger.install("github:user/memtable-pack-fitness")
await ledger.install("./packs/agent-work")
```

### 11.2 定义 Schema

```ts
ledger.defineSchema("fitness.workout", {
  fields: {
    exercise: { type: "string", required: true },
    weight_kg: { type: "number" },
    reps: { type: "number" },
    sets: { type: "number" },
    occurred_at: { type: "datetime", required: true }
  }
})
```

### 11.3 提取候选记录

```ts
const proposals = await ledger.extract({
  text: "今天卧推 65kg，5x5，体重 90.4kg。",
  packs: ["fitness"]
})
```

### 11.4 提交记录

```ts
await ledger.commit(proposals[0].id)
```

### 11.5 查询

```ts
const result = await ledger.query({
  collection: "fitness.workout",
  filter: {
    exercise: "bench_press",
    occurred_at: {
      gte: "2026-03-23"
    }
  },
  aggregate: {
    max_weight: "max(weight_kg)"
  },
  groupBy: "week"
})
```

### 11.6 自然语言查询

```ts
const result = await ledger.ask("最近三个月卧推进步了吗？")
```

`ask` 不直接交给 LLM 回答，而是：

```text
Natural Language Query
  -> Query Plan
  -> Structured Query
  -> Database Result
  -> Answer Synthesis
```

### 11.7 CLI 草案

```bash
memtable init
memtable search fitness
memtable install fitness
memtable install ./packs/fitness
memtable ingest ./logs/fitness.md --pack fitness
memtable query "最近三个月卧推进步了吗？"
memtable inspect proposals
memtable inspect records
memtable export --format json
```

## 12. 数据模型草案

### 12.1 schemas

保存 Schema 定义和版本。

字段：

- id
- name
- version
- definition
- status
- created_at
- updated_at

### 12.2 records

保存结构化记录。

字段：

- id
- schema_name
- schema_version
- data
- occurred_at
- source_id
- confidence
- created_by
- created_at
- updated_at

### 12.3 sources

保存来源信息。

字段：

- id
- kind
- reference
- excerpt
- metadata
- created_at

### 12.4 proposals

保存待确认的候选记录。

字段：

- id
- schema_name
- data
- source_id
- confidence
- status
- validation_errors
- created_at

### 12.5 audit_log

保存写入、修改、删除和回滚历史。

字段：

- id
- entity_type
- entity_id
- action
- before
- after
- actor
- created_at

### 12.6 packs

保存已安装 Pack 的元数据。

字段：

- id
- name
- version
- source
- manifest
- status
- installed_at
- updated_at

### 12.7 pack_assets

保存 Pack 安装后注册的资源。

字段：

- id
- pack_id
- kind
- name
- version
- content
- created_at

## 13. 与现有 Memory 的关系

MemTable 不替代语义记忆，而是与其互补。

```text
                 LLM
                  |
        +---------+---------+
        |                   |
 Semantic Memory     Structured Ledger
        |                   |
 Vector Database       SQL / OLAP
        |                   |
 facts, preferences    metrics, events
 experience, notes     states, records
```

Semantic Memory 适合：

- 偏好
- 事实
- 背景
- 经验
- 模糊知识

Structured Ledger 适合：

- 金额
- 体重
- 训练记录
- 项目状态
- 任务事件
- 时间消耗
- 可计算指标

## 14. 开源策略

### 14.1 第一阶段

发布一个最小可用 SDK、Pack Manager 和 demo。

重点不是覆盖所有场景，而是证明：

- Agent 能稳定发现结构化信息
- 写入过程可控
- 查询结果明显优于纯文本 Memory
- 用户能理解 Ledger 与 Memory 的差异
- 开发者可以通过安装 Pack 快速给 Agent 增加一个领域的结构化记忆能力

### 14.2 第二阶段

增加更多官方 Pack。

候选 Pack：

- fitness
- finance
- project
- time_tracking
- health
- agent_work

### 14.3 第三阶段

接入主流 Agent 框架。

候选集成：

- LangChain
- LlamaIndex
- Mastra
- OpenAI Agents SDK
- Claude / MCP tools
- Cursor / Codex 类开发 Agent

### 14.4 社区生态

MemTable 的开源生态核心应围绕 Pack 展开。

社区贡献的主要对象不是数据库适配器，而是各领域的结构化记账能力。

例如：

- `memtable-pack-fitness`
- `memtable-pack-finance`
- `memtable-pack-project`
- `memtable-pack-agent-work`
- `memtable-pack-research`

长期来看，MemTable Registry 可以成为 Agent 结构化记忆能力的发现入口。

## 15. 成功指标

### 15.1 产品指标

- 从文本中提取结构化记录的准确率
- 写入后的查询正确率
- 用户确认 Proposal 的通过率
- 重复记录率
- 查询延迟
- Schema 迁移成功率
- Pack 安装成功率
- Pack 生成工具的调用成功率

### 15.2 开源指标

- GitHub Stars
- Demo 使用次数
- 外部 Issue 数量
- 外部 PR 数量
- 被其他 Agent 项目集成的数量
- 社区 Pack 数量
- Pack 下载和安装次数

### 15.3 体验指标

核心体验应回答一个问题：

> 用户是否能问出纯 Memory 很难稳定回答，但 Ledger 能稳定回答的问题？

## 16. 主要风险

### 16.1 过度抽象

如果一开始试图支持所有领域，产品会变得难以解释、难以验证、难以落地。

应对方式：

- 从一个垂直 demo 开始
- 用具体问题证明价值
- 让抽象从真实场景中长出来

### 16.2 自动 Schema 生成不稳定

全自动 Schema 生成容易产生字段混乱、重复概念和迁移困难。

应对方式：

- 初期采用半自动 Schema
- Schema suggestion 需要人工确认
- 引入版本管理和迁移机制

### 16.3 Agent 误写污染账本

错误写入会影响长期统计结果。

应对方式：

- Proposal 机制
- 校验机制
- 来源追溯
- 置信度阈值
- 审计日志
- 回滚机制

### 16.4 自然语言查询幻觉

如果 `ask` 直接让 LLM 回答，容易出现看似合理但没有数据依据的结论。

应对方式：

- 强制生成 Query Plan
- 强制执行结构化查询
- 回答中返回 records_used 和 time_range
- 对无数据场景明确返回 insufficient_data

### 16.5 Pack 生态质量参差不齐

如果任何人都能发布 Pack，可能出现 Schema 设计混乱、字段命名不一致、校验不足和恶意代码风险。

应对方式：

- 官方 Pack 与社区 Pack 分层
- Pack manifest 静态校验
- 默认禁用任意代码执行
- validator 和 migration 采用明确权限模型
- 引入 Pack 签名、评分和兼容性声明
- 官方提供 Pack 设计规范

## 17. 路线图

### v0.1

- SQLite 存储
- TypeScript SDK
- 本地 Pack 安装
- 手动定义 Schema
- 文本到 Proposal
- Proposal 校验和提交
- 基础查询 DSL
- Fitness Ledger demo

### v0.2

- Python SDK
- DuckDB 支持
- 来源追溯
- 审计日志
- 趋势查询
- CLI
- 基础 MCP Server
- Agent Work Ledger demo

### v0.3

- Schema suggestion
- 自然语言查询到 Query Plan
- PostgreSQL Adapter
- 导入导出
- GitHub Pack 安装
- Pack 版本管理

### v0.4

- 多领域官方 Pack
- 远程 Pack Registry
- LangChain / LlamaIndex 集成
- Dashboard 原型

## 18. 文档与传播表达

### 18.1 项目 Slogan

候选：

- Agent 不缺记忆，缺的是账本
- Memory recalls. Ledger computes.
- Structured memory for long-running agents
- The missing data layer for agents
- Install structured memory for your agents

### 18.2 README 首屏表达

```text
MemTable is a structured ledger for long-running agents.

It helps agents turn conversations, tool results, and user activity into
verifiable, queryable, and auditable records.

Install domain packs like fitness, finance, project, or agent-work to give
your agent structured memory for a specific area.

Memory helps agents remember what happened.
MemTable helps agents compute what changed.
```

### 18.3 Demo 问题

用于展示价值的问题应避免泛泛的知识问答，而要强调传统 Memory 的弱点：

- 最近三个月卧推最大重量增长了多少？
- 哪些训练动作连续两周没有做？
- 本月训练总量相比上月变化多少？
- 哪些 Agent 任务重复失败超过三次？
- 哪些项目延期时间最长？

## 19. 总结

MemTable 的核心价值不是让 Agent 记住更多文本，而是让 Agent 知道什么应该被记成数据。

当信息被写入结构化账本后，Agent 不再需要每次从上下文中重新提取和计算，而可以直接基于可信数据进行分析、比较和决策。

Pack Manager 让这种能力可以被复用和分发。开发者不需要每次从零设计 Schema、提取规则和查询模板，而是可以像安装软件包一样，为自己的 Agent 安装某个领域的结构化记忆能力。

长期来看，Agent 的记忆系统可能会分成两类：

- Semantic Memory：负责回忆
- Structured Ledger：负责认知

MemTable 要做的是后者。

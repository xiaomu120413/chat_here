# Clowder-lite 实施计划

本文把 `docs/clowder-lite-essence.md` 中提炼的设计点转成 `chat_here` 的实施计划。目标是把当前 Tauri demo 改造成一个轻量 Gateway：桌面端运行 Codex / Copilot CLI，手机端通过 Web/PWA 访问，同一个 Gateway 管理线程、队列、调用、上下文和审计。

## 总目标

`chat_here` 最终应具备：

- 桌面端能真实调度 Codex / Copilot CLI
- 手机端能访问同一 Gateway，查看 thread、发消息、看实时回复
- 每次 agent 执行都有 invocation 状态，可追踪、可重试、可取消
- 多 agent 协作由 queue + router + lifecycle 驱动，而不是固定轮流发言
- 长会话使用 context packet 和 handoff digest，不再拼全量历史
- UI 消息以稳定 bubble key 渲染，不重复、不串线

## 非目标

第一阶段不做：

- Redis
- MCP marketplace
- 多 connector 平台
- 完整 skills 分发
- 企业级权限系统
- 外网部署和公网账号体系
- 复杂 SOP 生命周期

这些可以等 Gateway Core 稳定后再扩展。

## 里程碑总览

| 阶段 | 名称 | 目标 |
| --- | --- | --- |
| M0 | Baseline Stabilization | 固化当前真实 CLI 能力，清理旧假逻辑边界 |
| M1 | Core Schema & Stores | 引入 Project / Thread / Message / Invocation / Event / Queue 数据模型 |
| M2 | Invocation Lifecycle | 把 agent 调用改成 queued/running/succeeded/failed/canceled 生命周期 |
| M3 | Queue & Mutex | 每个 thread 有队列，每个 CLI session 有锁 |
| M4 | Mention Router | 支持 @codex / @copilot / @all 和自动路由 |
| M5 | Context Packet | 替换全量历史拼接，生成分层上下文 |
| M6 | Handoff Digest | 长会话接力和 thread memory |
| M7 | Gateway API & Realtime | 抽出可被手机访问的 HTTP/SSE API |
| M8 | Mobile PWA | 手机端 thread list + chat + queue 状态 |
| M9 | Diagnostics & Hardening | 自检、事件审计、失败重试、可观测性 |

## M0: Baseline Stabilization

### 目标

先确认当前所有真实能力边界，避免在不稳定基础上继续重构。

### 改动范围

- 保留当前 Tauri CLI 调用能力
- 标记并隔离当前 mock / local summary / demo UI 逻辑
- 增加最小真实链路 smoke test 脚本

### 具体任务

1. 新增 `docs/runtime-baseline.md`
2. 记录当前 Codex CLI 调用命令、Copilot CLI 调用命令、认证方式
3. 写一个本地 smoke 脚本：
   - `codex exec` 返回固定 token
   - `copilot` CLI 返回固定 token
   - summary 返回合法 JSON
4. 把 UI 里“真实链路自检”结果明确展示为 pass/fail

### 验收标准

- `npm test` 通过
- `cargo check` 通过
- 本机可执行真实 smoke：
  - Codex 返回 `CODEX_SMOKE_OK`
  - Copilot 返回 `COPILOT_SMOKE_OK`
- UI 不再显示“看似成功但实际 fallback”的 summary

### 风险

- Codex CLI 输出可能混入 warning
- Copilot CLI 首次启动慢
- Windows PowerShell 执行策略影响 `.ps1`

## M1: Core Schema & Stores

### 目标

建立 Gateway 的真实数据底座，不再只依赖 `run/messages/decision`。

### 新增模型

```ts
interface Project {
  path: string;
  name: string;
  lastActiveAt: string;
}

interface Thread {
  id: string;
  projectPath: string;
  title: string;
  participants: string[];
  status: "idle" | "running" | "paused" | "failed" | "completed";
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  threadId: string;
  invocationId?: string;
  source: "user" | "gateway" | "codex" | "copilot";
  kind: "user" | "agent" | "system" | "summary" | "error";
  content: string;
  mentions: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface InvocationRecord {
  id: string;
  threadId: string;
  userMessageId: string;
  agentId: "codex" | "copilot";
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  idempotencyKey: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

interface GatewayEvent {
  id: string;
  threadId: string;
  invocationId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

### 改动范围

- `src/gateway/schema`
- `src/gateway/store`
- 当前 `memoryStore/localStorageStore/fileStore`

### 验收标准

- 能创建 project/thread/message/invocation/event
- store 能按 thread 读取完整 snapshot
- event 是 append-only
- 现有历史 run 可以临时映射成 thread snapshot

### 测试

- schema validation tests
- memory store tests
- localStorage store tests
- snapshot reconstruction tests

## M2: Invocation Lifecycle

### 目标

把 agent 调用从“一次函数调用”改成可追踪生命周期。

### 状态机

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> canceled
running -> canceled
failed -> queued
```

### 改动范围

- 新增 `runtime/invocationManager.js`
- 改造 `orchestrator/index.js`
- agent runner 只返回 invocation result，不直接写最终 UI 状态

### 具体任务

1. 用户消息落库后创建 invocation
2. invocation 状态变化写 event
3. agent 成功后写 agent message
4. agent 失败后写 error event，不写成功 message
5. 支持 retry failed invocation

### 验收标准

- 失败 invocation 在 UI 能看到
- retry 后复用原 thread，不重复 user message
- succeeded 才推进 context cursor
- canceled 不进入 context packet

### 测试

- invocation state transition tests
- retry tests
- idempotency tests
- failed invocation does not create agent message

## M3: Queue & Mutex

### 目标

建立真正的调度队列，避免 CLI 并发、重复发送和抢占混乱。

### 新增模块

```text
src/gateway/runtime/invocationQueue.js
src/gateway/runtime/queueProcessor.js
src/gateway/runtime/sessionMutex.js
```

### 队列规则

- 每个 thread 一个 queue
- 每条用户消息独立 entry
- 同 thread 同时只跑一个调度链
- 同 agent session 同时只允许一个 invocation
- urgent 只影响出队排序，不默认打断健康运行的 invocation

### 验收标准

- 连续发送三条消息，按 queue 顺序处理
- 同一 thread 不会并发跑两个 Codex
- 当前 invocation running 时，新消息进入 queued
- 队列状态能被 UI 读取

### 测试

- queue ordering tests
- session mutex contention tests
- active invocation enqueue tests
- priority dequeue tests

## M4: Mention Router

### 目标

把 `@mention` 升级为调度协议输入。

### 支持语法

```text
@codex 实现这个方案
@copilot 挑问题
@all 讨论一下
```

### RoutingDecision

```ts
interface RoutingDecision {
  sourceMessageId: string;
  targets: string[];
  reason: "explicit_mention" | "auto_policy" | "handoff" | "summary";
  maxDepth: number;
}
```

### 规则

- 显式 mention 优先
- 无 mention 走 auto policy
- `@all` 进入协作模式
- A2A 链有最大深度
- 单条消息最多触发 2 个 agent

### 验收标准

- `@codex` 只创建 Codex invocation
- `@copilot` 只创建 Copilot invocation
- `@all` 同时或串行触发 Codex/Copilot，具体由 policy 决定
- 无 mention 仍能自动路由
- 路由原因显示在调试面板

### 测试

- mention parser tests
- routing decision tests
- max depth tests
- unknown mention fallback tests

## M5: Context Packet

### 目标

替换全量聊天历史拼接，让 agent 收到高信噪比上下文。

### ContextPacket

```ts
interface ContextPacket {
  task: string;
  recentBurst: Message[];
  decisions: string[];
  openQuestions: string[];
  artifacts: string[];
  lastSpeaker?: string;
  routingReason?: string;
}
```

### 构建规则

- `recentBurst` 默认最近 4-8 条
- 不包含 failed/canceled invocation 的输出
- 不包含 UI-only system briefing
- 包含 thread digest
- 包含明确 open questions

### 验收标准

- agent prompt 不再拼全量 message history
- thread 超过 100 条消息后，prompt 仍保持预算内
- failed/canceled invocation 不进入 context
- context packet 可在 diagnostics 中查看

### 测试

- context assembler tests
- token budget degradation tests
- recent burst boundary tests
- failed invocation exclusion tests

## M6: Handoff Digest

### 目标

支持长会话和手机端恢复，不依赖全量历史。

### HandoffDigest

```ts
interface HandoffDigest {
  threadId: string;
  summary: string;
  decisions: string[];
  openQuestions: string[];
  nextOwner?: "codex" | "copilot" | "user";
  nextAction?: string;
  updatedAt: string;
}
```

### 规则

- 每轮完成后更新 digest
- digest 是 data，不是 system instruction
- digest 会进入下次 context packet
- 手机端打开 thread 时优先展示 digest

### 验收标准

- 老 thread 重新发消息时，Codex/Copilot 能看到前序 digest
- digest 更新失败不影响消息落库，但要有 event
- digest 内容包含 decisions/open questions/next action

### 测试

- digest generation tests
- digest injection tests
- digest failure degradation tests

## M7: Gateway API & Realtime

### 目标

把 Gateway 从 Tauri 前端逻辑中抽出来，让手机端也能访问。

### API 草案

```text
GET  /api/projects
GET  /api/threads
POST /api/threads
GET  /api/threads/:threadId
POST /api/threads/:threadId/messages
GET  /api/threads/:threadId/events
POST /api/invocations/:id/retry
POST /api/invocations/:id/cancel
GET  /api/diagnostics/self-test
GET  /api/stream
```

### Realtime

第一版用 SSE，比 WebSocket 简单：

```text
event: message
event: invocation
event: queue
event: summary
event: error
```

### 验收标准

- Tauri UI 通过 API 调 Gateway
- 浏览器能访问 Gateway
- 手机浏览器在同一局域网可打开
- 发送消息后能实时看到 invocation 状态变化

### 测试

- API route tests
- SSE event tests
- idempotent POST tests
- mobile viewport smoke test

## M8: Mobile PWA

### 目标

手机端可用，不只是桌面端缩小。

### 页面

- Thread list
- Chat view
- Queue / invocation status
- Summary / digest view
- Diagnostics view

### 交互

- 输入消息
- `@codex/@copilot/@all` 提示
- 查看 running/queued/failed 状态
- retry failed invocation
- 断线重连后恢复 snapshot

### 验收标准

- 手机宽度 390px 下无横向滚动
- thread list 和 chat view 可切换
- 断线重连不重复消息
- failed invocation 可 retry
- PWA manifest 可安装

### 测试

- responsive layout screenshots
- reconnect state tests
- bubble key reconciliation tests

## M9: Diagnostics & Hardening

### 目标

让系统失败时可解释，可复现，可定位。

### Diagnostics

- CLI auth status
- CLI smoke test
- current queue
- running invocation
- last 50 events
- context packet preview
- thread digest

### Hardening

- append-only event log
- structured errors
- timeout policy
- retry policy
- cancellation
- context budget degradation

### 验收标准

- 自检能明确显示 Codex/Copilot/Summary 三段是否真实可用
- 任意 failed invocation 有错误文本、命令类型、模型、耗时
- diagnostics 面板能导出当前 thread debug snapshot
- 没有 `[object Object]` 类型错误展示

### 测试

- diagnostics snapshot tests
- timeout tests
- structured error tests
- event replay tests

## 推荐实施顺序

先做核心，不继续堆 UI：

1. M1 Core Schema & Stores
2. M2 Invocation Lifecycle
3. M3 Queue & Mutex
4. M4 Mention Router
5. M5 Context Packet
6. M7 Gateway API
7. M8 Mobile PWA
8. M6 Handoff Digest
9. M9 Diagnostics & Hardening

M6 可以排在 M8 前或后。如果先追求手机可用，可以先做 API/PWA；如果先追求讨论质量，可以先做 Handoff Digest。

## 当前代码迁移映射

| 当前模块 | 目标模块 |
| --- | --- |
| `src/gateway/orchestrator/index.js` | `runtime/engine.js`, `runtime/queueProcessor.js`, `policy/routerPolicy.js` |
| `src/gateway/adapters/*` | `agents/*Driver.js`, `runtime/providerRouter.js` |
| `src/gateway/state/*` | `runtime/invocationState.js`, `runtime/threadState.js` |
| `src/gateway/store/*` | `stores/threadStore.js`, `stores/messageStore.js`, `stores/invocationStore.js`, `stores/eventStore.js` |
| `src/ui/controller.js` | `api client + UI state subscription` |
| `src/ui/render.js` | `bubble reducer + responsive views` |

## 第一个可交付版本定义

第一版可交付不是“看起来像群聊”，而是：

- 用户在桌面或手机发消息
- Gateway 创建 thread message
- Gateway 创建 invocation
- invocation 入队
- queue processor 调用真实 Codex/Copilot
- agent 输出写成 message
- UI 实时更新
- 失败可见且可重试
- 事件可回放

达到这个标准后，再谈更复杂的自由讨论和多 agent 扩展。

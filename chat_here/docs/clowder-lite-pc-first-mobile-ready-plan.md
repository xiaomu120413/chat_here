# Clowder-lite PC First, Mobile Ready Plan

本文是新的实施计划。目标不是一步做完整 Clowder，而是先把 PC 端讨论体验做稳，同时在架构上预留手机接入、多人讨论、connector、Redis、skills、SOP、权限和 A2A 演进空间。

## 目标定位

`chat_here` 的目标形态：

- PC 端先可用，作为 Gateway 宿主和主要操作台
- 手机端后续可以通过浏览器/PWA 接入
- 支持人类用户 + Codex + Copilot 讨论
- Gateway 负责调度、队列、状态、上下文和审计
- 第一版轻量实现，但接口按未来 A2A runtime 设计

一句话：

```text
轻量讨论产品优先，协议化 Gateway 骨架同时建立。
```

## 阶段原则

### 先 PC

PC 是第一宿主，因为 Codex/Copilot CLI 跑在 PC 上，认证、工作目录、文件系统和调试也都在 PC。

### 预留手机

手机不跑 CLI，只作为客户端接入 Gateway。

### 轻量实现

第一版不用 Redis、不做复杂 SOP、不做完整 connector、不做企业权限，但所有接口要能替换。

### A2A 形态

消息、路由、handoff、targetAgents、source、depth、invocationId 都要结构化，避免后面重写。

## 手机接入需要的技术

### 1. Gateway HTTP Server

手机浏览器不能直接调用 Tauri command，因此需要独立 HTTP API。

最低要求：

```text
GET  /api/health
GET  /api/threads
POST /api/threads
GET  /api/threads/:threadId
POST /api/threads/:threadId/messages
GET  /api/threads/:threadId/events
GET  /api/stream
```

实现选择：

- 短期：Node/Vite dev server 或 Tauri Rust 内嵌 HTTP server
- 建议：先用 Node HTTP server，更容易和前端共享 JS gateway 代码
- 后续：如果要打包成桌面常驻服务，可再移到 Rust sidecar 或独立 Node service

### 2. Realtime Channel

手机需要实时看到 Codex/Copilot 回复。

优先选择 SSE：

- 实现比 WebSocket 简单
- 浏览器原生支持
- 适合 server -> client 的事件流
- 断线自动重连

事件类型：

```text
message.created
invocation.queued
invocation.running
invocation.succeeded
invocation.failed
thread.summary
queue.updated
diagnostic.updated
```

WebSocket 留给后续多人在线光标、typing、复杂双向控制。

### 3. Snapshot + Reconnect

手机网络不稳定，不能只靠 realtime。

必须有：

```text
GET /api/threads/:threadId
```

返回完整 snapshot：

```ts
interface ThreadSnapshot {
  thread: Thread;
  messages: Message[];
  invocations: InvocationRecord[];
  queue: QueueEntry[];
  summary?: Summary;
  eventsCursor: string;
}
```

手机策略：

- 首次打开拉 snapshot
- 建立 SSE
- SSE 断线后重连
- 重连后用 `eventsCursor` 补事件
- 如果补事件失败，重新拉 snapshot

### 4. Stable Message/Bubble Identity

手机端实时渲染最容易出重复消息。必须设计稳定 key：

```text
bubbleKey = source + invocationId + kind
```

没有 invocation 的用户消息：

```text
bubbleKey = user + messageId
```

用途：

- streaming -> final 不分裂
- retry 不重复
- 历史加载和实时消息能 reconcile

### 5. Local Network Access

手机要访问 PC，需要 Gateway 监听局域网地址。

开发期：

```text
http://PC_IP:PORT
```

要求：

- server 监听 `0.0.0.0`
- Windows 防火墙允许端口
- UI 显示当前手机访问地址

### 6. Basic Auth Boundary

手机接入不能裸奔。

MVP 最低安全：

- 首次启动生成本地 access token
- PC UI 显示二维码或 URL + token
- 手机访问时带 token
- token 存 localStorage

请求方式：

```text
Authorization: Bearer <local-token>
```

后续再演进：

- 多用户账号
- 角色权限
- connector-specific secret
- A2A agent key

### 7. PWA

手机体验需要 PWA，而不是普通网页缩小版。

最低要求：

- `manifest.webmanifest`
- mobile responsive layout
- touch-friendly composer
- installable icon
- reconnect 状态提示
- background 不强依赖，先不做 push

后续：

- Push notification
- Offline read cache
- Share target

### 8. Store Contract

手机和 PC 共享状态，不能只放在前端 localStorage。

MVP：

- Gateway 进程内 memory store + file persistence
- 或 SQLite

建议：

- 先定义 store port
- 第一版 file/SQLite 实现
- 后续 Redis 实现同一接口

## 总体架构

```text
PC Desktop
  Tauri Shell
    Web UI
    Gateway HTTP Server
    Gateway Runtime
      ThreadStore
      MessageStore
      InvocationStore
      Queue
      Router
      ContextAssembler
      AgentRunner
        Codex CLI
        Copilot CLI

Mobile Browser / PWA
  Web UI
  HTTP API Client
  SSE Client
```

## 数据结构预留 A2A

### Message

```ts
interface Message {
  id: string;
  threadId: string;
  source: {
    type: "user" | "agent" | "gateway" | "connector" | "a2a";
    id: string;
    displayName?: string;
  };
  targetAgents: string[];
  content: string;
  mentions: string[];
  replyTo?: string;
  invocationId?: string;
  a2a?: {
    depth: number;
    parentMessageId?: string;
    handoffReason?: string;
  };
  createdAt: string;
}
```

### Invocation

```ts
interface InvocationRecord {
  id: string;
  threadId: string;
  agentId: string;
  triggerMessageId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  provider: "codex_cli" | "copilot_cli" | "mock" | "a2a";
  model: string;
  idempotencyKey: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
```

### QueueEntry

```ts
interface QueueEntry {
  id: string;
  threadId: string;
  sourceCategory: "user" | "agent" | "connector" | "a2a";
  targetAgents: string[];
  priority: "normal" | "urgent";
  status: "queued" | "processing";
  triggerMessageId: string;
  idempotencyKey: string;
  createdAt: string;
}
```

### RoutingDecision

```ts
interface RoutingDecision {
  threadId: string;
  sourceMessageId: string;
  targets: string[];
  reason: "mention" | "auto" | "handoff" | "summary" | "connector";
  maxDepth: number;
  depth: number;
}
```

## 实施里程碑

## M1: PC Runtime Stabilization

### 目标

先让 PC 端真实讨论稳定，不改手机。

### 范围

- 保留 Tauri UI
- 固化 Codex/Copilot CLI 调用
- 增加真实链路自检
- 明确 Gateway 不再冒充普通聊天成员

### 任务

1. 梳理当前 CLI 调用路径
2. 增加 smoke command
3. 修复窗口启动和端口占用问题
4. 把 summary failure 真实暴露
5. UI 显示 `Real CLI mode`

### 验收

- PC 端能发起一个讨论
- Codex/Copilot 都真实返回
- summary 真实生成或明确失败
- 没有 `[object Object]`
- 端口占用时能提示或自动换端口

## M2: Lightweight Thread + Message Store

### 目标

讨论有稳定 thread，不再把 run 当会话。

### 范围

- `ThreadStore`
- `MessageStore`
- `EventStore`
- snapshot API 内部先用 JS 函数，不急着 HTTP

### 任务

1. 新增 `Thread`
2. 新增 `Message`
3. 新增 append-only `GatewayEvent`
4. UI 从 thread snapshot 渲染
5. 旧 run 临时映射到 thread

### 验收

- 可以新建多个讨论
- 切换 thread 不串消息
- 刷新后能恢复 thread
- 每条 message 有稳定 id

## M3: Invocation Queue Lite

### 目标

引入最小 invocation 生命周期和队列。

### 范围

- `InvocationRecord`
- `QueueEntry`
- `InvocationQueue`
- `SessionMutex`

### 任务

1. 用户消息创建 invocation
2. invocation 入队
3. queue processor 调用 agent runner
4. 成功写 agent message
5. 失败写 invocation error

### 验收

- 连续发消息不会并发打爆 CLI
- running 时新消息显示 queued
- failed invocation 可见
- retry 不重复 user message

## M4: Discussion Router

### 目标

讨论从固定流程改为 mention + auto policy。

### 范围

- `MentionRouter`
- `RoutingDecision`
- `AutoDiscussionPolicy`

### 任务

1. 支持 `@codex`
2. 支持 `@copilot`
3. 支持 `@all`
4. 无 mention 自动选择下一位
5. 限制最大 A2A depth

### 验收

- `@codex` 只触发 Codex
- `@copilot` 只触发 Copilot
- `@all` 触发讨论
- agent 可以 handoff 给另一个 agent
- 达到 depth 后自动 summary

## M5: Gateway HTTP API

### 目标

为手机接入预留真实 API。

### 范围

- 本地 HTTP server
- API auth token
- thread/message API
- diagnostics API

### 任务

1. 新增 Gateway server
2. server 监听可配置 host/port
3. PC UI 也改用 API client
4. 显示手机访问 URL
5. 增加 bearer token

### 验收

- PC UI 通过 HTTP API 工作
- 手机浏览器能打开 `http://PC_IP:PORT`
- 未带 token 请求被拒绝
- 带 token 能读取 thread snapshot

## M6: SSE Realtime

### 目标

手机和 PC 都能实时看到讨论状态。

### 范围

- `GET /api/stream`
- event fanout
- reconnect cursor

### 任务

1. 每个 GatewayEvent 推送 SSE
2. 前端订阅 SSE
3. 断线自动重连
4. 重连后补事件或拉 snapshot

### 验收

- PC 发送消息，手机实时看到
- 手机发送消息，PC 实时看到
- SSE 断线重连不重复消息

## M7: Mobile PWA

### 目标

做手机可用的讨论界面。

### 范围

- responsive layout
- PWA manifest
- mobile thread list
- mobile chat view
- queue/invocation status

### 任务

1. 移动端布局
2. touch-friendly composer
3. thread list / chat view 切换
4. retry failed invocation
5. installable PWA

### 验收

- 390px 宽度无横向滚动
- 手机可发消息
- 手机可看实时回复
- failed invocation 可 retry

## M8: Context Packet Lite

### 目标

提升讨论质量，但保持轻量。

### 范围

- `ContextAssembler`
- recent burst
- thread summary
- open questions

### 任务

1. 替换全量历史 prompt
2. recent burst 默认 8 条
3. summary/open questions 注入
4. diagnostics 展示 context packet

### 验收

- 长 thread 不会塞全量历史
- agent 能接住上下文
- context packet 可调试

## M9: Extension Ports

### 目标

预留后续重型能力接口。

### Ports

```text
StorePort       -> file/sqlite now, redis later
SkillResolver   -> prompt templates now, skills later
PolicyGate      -> simple rules now, SOP later
ConnectorSource -> web now, Feishu/Telegram later
AgentProvider   -> local CLI now, A2A later
AuthProvider    -> local token now, users/roles later
```

### 验收

- 每个 port 有接口文档
- 当前实现不依赖具体存储
- 后续替换 Redis/connector/A2A 不需要重写 UI

## 推荐顺序

第一阶段 PC 优先：

1. M1 PC Runtime Stabilization
2. M2 Lightweight Thread + Message Store
3. M3 Invocation Queue Lite
4. M4 Discussion Router

第二阶段手机接入：

5. M5 Gateway HTTP API
6. M6 SSE Realtime
7. M7 Mobile PWA

第三阶段讨论质量和扩展：

8. M8 Context Packet Lite
9. M9 Extension Ports

## 第一版完成定义

第一版完成时应该满足：

- PC 端真实可用
- 手机浏览器能进入
- 多个用户可以在同一个 thread 里发言
- Codex/Copilot 可以被 @mention
- `@all` 可以触发讨论
- Gateway 有队列和 invocation 状态
- 所有消息和执行状态都能被实时同步
- 后续 Redis / Skills / SOP / Connector / A2A 有清晰扩展点

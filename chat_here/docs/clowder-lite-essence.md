# Clowder-lite 设计精华整理

本文整理 `zts212653/clowder-ai` 对 `chat_here` 的可借鉴部分。目标不是复制 Clowder 的完整平台，而是抽出适合当前项目的轻量内核，支撑 Codex / Copilot 在桌面和手机端都能稳定协作。

参考项目：
- https://github.com/zts212653/clowder-ai
- `docs/decisions/008-conversation-mutability-and-invocation-lifecycle.md`
- `docs/decisions/003-project-thread-architecture.md`
- `docs/features/F148-hierarchical-context-transport.md`
- `docs/features/F175-unified-message-queue.md`
- `docs/features/F183-bubble-pipeline-architecture-consolidation.md`

## 1. 真正值得学的不是多 agent，而是平台层

Clowder 的核心判断是：多个 agent 不能只靠 UI 拼在一起。用户不应该成为人工路由器，系统需要一个平台层来管理身份、路由、调用、上下文、审计和接力。

对 `chat_here` 来说，Gateway 不应该是群聊里的第三个发言者。Gateway 应该是运行时平台：

- 接收用户消息
- 建立 thread
- 创建 invocation
- 调度 Codex / Copilot
- 记录事件
- 维护上下文摘要
- 推送 UI 更新
- 支持手机端连接

Gateway 可以生成系统消息和最终总结，但不应该长期冒充一个普通 agent 参与讨论。

## 2. Agent 回复不是 Message，而是 Invocation 的结果

Clowder 的 ADR-008 把“消息写入”和“agent 执行”解耦，这是最关键的一点。

当前 `chat_here` 的问题是：用户发消息、调用 CLI、写消息、更新 UI 基本在一条同步流程里。这样做一旦 CLI 慢、失败、重复提交、手机断线，状态就很难解释。

应该引入 `InvocationRecord`：

```ts
type InvocationStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

interface InvocationRecord {
  id: string;
  threadId: string;
  userMessageId: string;
  agentId: "codex" | "copilot";
  status: InvocationStatus;
  idempotencyKey: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
```

运行规则：

- 用户消息先落库
- 每次 agent 调用创建一个 invocation
- invocation 成功后才产生 agent message
- invocation 失败后可重试，不伪造成成功消息
- 手机端重发同一请求时靠 `idempotencyKey` 去重
- cursor / context 只推进到成功的 invocation

这是系统从“聊天 demo”变成“可用工具”的分界线。

## 3. Queue 是 Gateway 的心脏

Clowder 的 `InvocationQueue / QueueProcessor / SessionMutex` 解决的是真实协作中的并发问题。

要处理的问题：

- 同一个 thread 中用户连续发多条怎么办
- Codex 正在跑，Copilot 是否能抢占
- 手机端重复点击发送怎么办
- urgent 消息是否能打断当前 A2A 链
- 同一个 CLI session 是否允许并发 resume
- 当前 invocation 失败后下一条是否继续

`chat_here` 应该做轻量版 queue：

```ts
interface QueueEntry {
  id: string;
  threadId: string;
  source: "user" | "agent" | "system";
  targetAgents: string[];
  content: string;
  priority: "normal" | "urgent";
  status: "queued" | "processing";
  idempotencyKey: string;
  createdAt: string;
}
```

规则：

- 每个 thread 一个队列
- 同一个 thread 同一时间只处理一个调度链
- 同一个 agent session 有 mutex
- priority 影响出队顺序，但默认不打断正在健康运行的 invocation
- 每条用户消息独立入队，不强制合并
- 队列状态要能在 UI 和手机端看到

这比“轮流一人一句”更接近真实 Gateway。

## 4. @mention 是路由协议，不是文本装饰

Clowder 的 A2A mention 机制很值得学。`@mention` 不只是 UI 展示，它是调度输入。

`chat_here` 简化规则：

- `@codex`：只派给 Codex
- `@copilot`：只派给 Copilot
- `@all`：Codex 和 Copilot 都进入讨论
- 无 mention：由 Gateway policy 自动选人

路由结果必须结构化记录：

```ts
interface RoutingDecision {
  sourceMessageId: string;
  targets: string[];
  reason: "explicit_mention" | "auto_policy" | "handoff" | "summary";
  maxDepth: number;
}
```

安全限制：

- 单条消息最多触发有限数量的 agent
- A2A 链必须有最大深度
- inline mention 和行首 mention 可以分阶段实现
- 路由失败要给用户可见反馈

这会让“自由讨论”变成可控的协议，而不是靠模型随意输出 `GATEWAY_NEXT`。

## 5. Thread 是上下文边界，Project 是工作目录

Clowder 的 Project / Thread 决策可以直接借鉴：

- Project = 工作目录
- Thread = 一个话题或任务
- Message = thread 内的可见消息
- Invocation = agent 的一次执行
- Event = 系统真相

`chat_here` 当前只有会话和 run 的概念，不够稳定。后续应改成：

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
```

好处：

- CLI 调用天然知道 `cwd`
- 不同代码项目上下文隔离
- 手机端可以按项目浏览 thread
- 旧 thread 可恢复，不需要塞在一个聊天流里

## 6. Context 不能继续拼全量历史，要做 Context Packet

Clowder 的 `Hierarchical Context Transport` 是另一个关键精华。它发现 flat history 会吞掉大量上下文，因此改成分层上下文。

`chat_here` 现在不应该继续把所有消息拼给 Codex/Copilot。应该构建轻量 `ContextPacket`：

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

组成策略：

- `recentBurst`：最近一个完整交互片段，默认 4-8 条
- `decisions`：thread 中已经沉淀的决定
- `openQuestions`：未解决问题
- `artifacts`：相关文件、命令、测试、PR
- `lastSpeaker`：帮助 agent 接话

这会明显提升“智能感”。智能不是让 Gateway 多说话，而是让 agent 收到更干净的上下文。

## 7. Continuity Capsule 解决跨会话接力

Clowder 有 `CollaborationContinuityCapsule / SessionBootstrap / HandoffDigestGenerator`，本质是解决 agent session 重启、压缩、断线后的上下文接力。

`chat_here` 可做轻量 `HandoffDigest`：

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

规则：

- 每次 thread 完成一轮后更新 digest
- 下一次 agent 调用先注入 digest
- 手机端打开老 thread 时优先展示 digest
- digest 作为数据，不作为系统指令注入

这样可以避免每次重新解释背景。

## 8. BubbleKey 保证 UI 真实一致

Clowder 的 Bubble Pipeline 很重，但里面有一个简单且关键的契约：

```text
稳定气泡身份 = agentId + invocationId + bubbleKind
```

`chat_here` 手机端实时渲染时也必须这样做。否则一定会出现：

- streaming 消息和 final 消息分裂
- retry 后重复气泡
- 历史加载和实时消息对不上
- callback / final 覆盖错消息

轻量版：

```ts
interface UiBubble {
  key: string; // `${agentId}:${invocationId}:${kind}`
  threadId: string;
  agentId: string;
  invocationId: string;
  kind: "assistant_text" | "system_status" | "summary" | "error";
  content: string;
  status: "streaming" | "final" | "failed";
}
```

UI 只能根据 `BubbleKey` patch，不随便 append。

## 9. EventLog 是系统真相

Clowder 有 append-only audit log。轻量版也需要事件日志，否则无法调试“为什么它没回”“为什么路由给了 Copilot”“为什么手机端重复了一条”。

事件最少包括：

```ts
type GatewayEvent =
  | "THREAD_CREATED"
  | "USER_MESSAGE_RECEIVED"
  | "ROUTING_DECIDED"
  | "INVOCATION_QUEUED"
  | "INVOCATION_STARTED"
  | "AGENT_MESSAGE_RECEIVED"
  | "INVOCATION_FAILED"
  | "INVOCATION_SUCCEEDED"
  | "SUMMARY_GENERATED"
  | "THREAD_DIGEST_UPDATED";
```

规则：

- append-only
- UI snapshot 可重建
- 调试面板能展示事件时间线
- 自检功能读取事件验证真实链路

## 10. 手机端可用的正确方向

手机端不应该跑 Codex/Copilot CLI。手机端应该只是客户端。

推荐结构：

```text
Desktop / Server
  Gateway API
  Codex CLI
  Copilot CLI
  SQLite / file store

Mobile PWA
  Thread list
  Chat view
  Queue status
  Auth / diagnostics status
  WebSocket or SSE realtime updates
```

第一阶段可以先在本机局域网跑：

- Gateway 监听 `0.0.0.0`
- 手机访问 `http://desktop-ip:port`
- 后续再考虑 HTTPS、登录和外网穿透

## 11. 不应该照搬的部分

这些暂时不做：

- Redis 全套实现
- MCP marketplace
- 多 connector 平台
- 复杂 skills 分发
- voice / game / community board
- 完整 SOP 生命周期
- 多 provider 大规模接入

这些在 `chat_here` 当前阶段会分散重点。

## 12. 建议的 Clowder-lite MVP

MVP 应该围绕内核，而不是继续堆 UI。

阶段 1：Gateway Core

- `ThreadStore`
- `MessageStore`
- `InvocationStore`
- `EventStore`
- `InvocationQueue`
- `SessionMutex`

验收：

- 用户发一条消息会产生 message + invocation + events
- 失败 invocation 可见且可重试
- 重复 idempotencyKey 不会创建重复消息

阶段 2：Routing

- `MentionRouter`
- `RoutingDecision`
- `maxDepth`
- `fallbackPolicy`

验收：

- `@codex` 只触发 Codex
- `@copilot` 只触发 Copilot
- `@all` 触发协作
- 无 mention 走自动 policy

阶段 3：Context Packet

- `ContextAssembler`
- `recentBurst`
- `decisions`
- `openQuestions`
- `handoffDigest`

验收：

- agent prompt 不再是全量历史
- thread 越长，prompt 仍保持可控
- 老 thread 可以恢复上下文

阶段 4：Realtime + Mobile

- Gateway HTTP API
- SSE / WebSocket
- PWA 手机 UI
- queue / invocation 状态展示

验收：

- 手机能打开 thread
- 手机能发消息
- 手机能看到 Codex/Copilot 实时回复
- 手机断线重连不重复消息

## 13. 最重要的三条工程原则

1. Agent 回复不是 message，而是 invocation 的结果。
2. 多 agent 协作不是轮流说话，而是 queue + router + lifecycle。
3. 上下文不是聊天历史拼接，而是 context packet + handoff digest。

这三条是从 Clowder 学到的真正精华，也是 `chat_here` 要从 demo 走向可用工具的主线。

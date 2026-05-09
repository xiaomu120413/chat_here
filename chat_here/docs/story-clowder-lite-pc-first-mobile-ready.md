# Story: Clowder-lite PC First, Mobile Ready Gateway

## Epic

Build a lightweight discussion Gateway that runs on PC, supports Codex/Copilot discussion, and reserves a mobile browser/PWA entry for human users.

## Product Outcome

用户可以先在 PC 上稳定使用 Codex/Copilot 讨论；后续手机可以打开同一个 Gateway，进入同一个 thread，参与多人 + AI 的讨论。

第一版不追求完整 Clowder，但必须具备可演进到 A2A runtime 的数据结构和运行边界。

## User Stories

## Story 1: PC 端真实讨论稳定

### User Story

作为用户，我希望在 PC 上发起一个讨论，Codex 和 Copilot 能真实返回，并且失败时明确告诉我失败原因。

### 修改点

- 固化当前 Codex CLI 和 Copilot CLI 调用路径。
- 增加 CLI smoke test 能力。
- 整理当前 `summary` 真实模型调用逻辑。
- 修复端口占用时 Tauri 窗口无法启动的问题。
- UI 标记当前是 `Real CLI mode`。
- 错误统一格式化，禁止 `[object Object]`。

### 测试点

- Codex CLI smoke 返回固定 token。
- Copilot CLI smoke 返回固定 token。
- summary 返回合法 JSON。
- CLI warning 不会污染最终用户消息。
- 端口占用时有明确提示或 fallback 行为。
- CLI 失败时 UI 展示可读错误。

### 验收标准

- PC 端可以发起一次真实讨论。
- Codex 和 Copilot 至少各返回一次真实消息。
- summary 成功时展示真实模型总结。
- summary 失败时展示失败状态，不伪造成功。
- 没有 `[object Object]`。

## Story 2: Thread 和 Message 数据模型

### User Story

作为用户，我希望不同讨论互相隔离，切换 thread 后不会串消息。

### 修改点

- 新增 `Thread` 模型。
- 新增 `Message` 模型。
- 新增 `GatewayEvent` 模型。
- 新增 `ThreadStore`、`MessageStore`、`EventStore`。
- UI 从 thread snapshot 渲染，而不是从临时 run 状态拼接。
- 保留 `source.type`、`targetAgents`、`replyTo`、`a2a` 等未来扩展字段。

### 测试点

- 创建 thread。
- 写入 user message。
- 写入 agent message。
- 按 thread 读取 snapshot。
- 多 thread 消息隔离。
- event append-only。

### 验收标准

- 可以创建多个讨论。
- 切换 thread 不串消息。
- 刷新后可以恢复 thread。
- 每条 message 有稳定 id。
- 每个重要动作都有 event。

## Story 3: Invocation 生命周期

### User Story

作为用户，我希望每次 Codex/Copilot 执行都有状态，可以看到排队、运行、成功或失败。

### 修改点

- 新增 `InvocationRecord`。
- 新增 `InvocationStore`。
- Codex/Copilot 调用必须创建 invocation。
- invocation 状态支持 `queued/running/succeeded/failed/canceled`。
- agent 成功后才生成 agent message。
- agent 失败后写 failed invocation 和 error event。
- 支持 retry failed invocation。

### 测试点

- invocation 创建后是 queued。
- 执行开始变 running。
- 执行成功变 succeeded。
- 执行失败变 failed。
- retry 不重复 user message。
- canceled invocation 不进入 context。

### 验收标准

- UI 能看到 invocation 状态。
- 失败 invocation 可读、可重试。
- retry 后仍在同一个 thread。
- 失败不会被写成成功 message。

## Story 4: Queue 和 Session Mutex

### User Story

作为用户，我希望连续发送多条消息时系统能按顺序处理，不会把 Codex/Copilot CLI 并发打乱。

### 修改点

- 新增 `InvocationQueue`。
- 新增 `QueueEntry`。
- 新增 `QueueProcessor`。
- 新增 `SessionMutex`。
- 同一 thread 同一时间只处理一个调度链。
- 同一 agent session 同一时间只允许一个 invocation。
- running 时新消息进入 queued。

### 测试点

- 连续发送三条消息，按顺序处理。
- running 时新消息入队。
- queue 中 entry 可取消。
- priority 影响后续出队顺序。
- session mutex 阻止并发 invocation。

### 验收标准

- 不会同时启动两个同 thread 的 Codex invocation。
- 不会同时启动两个同 thread 的 Copilot invocation。
- queue 状态在 UI 可见。
- 当前 invocation 结束后自动处理下一条。

## Story 5: Discussion Router

### User Story

作为用户，我希望可以用 `@codex`、`@copilot`、`@all` 控制讨论对象；没有 mention 时 Gateway 自动调度。

### 修改点

- 新增 `MentionRouter`。
- 新增 `RoutingDecision`。
- 支持 `@codex`。
- 支持 `@copilot`。
- 支持 `@all`。
- 支持无 mention 自动路由。
- 支持 A2A depth 限制。
- `GATEWAY_NEXT` 降级为 hint，不作为唯一调度依据。

### 测试点

- `@codex` 只创建 Codex invocation。
- `@copilot` 只创建 Copilot invocation。
- `@all` 创建讨论 routing。
- unknown mention 不崩溃。
- 达到 maxDepth 后停止 A2A。
- routing decision 写入 event。

### 验收标准

- 显式 mention 路由准确。
- 无 mention 仍能自动发起讨论。
- Gateway 能解释为什么路由给某个 agent。
- A2A 不会无限循环。

## Story 6: Gateway HTTP API

### User Story

作为手机用户，我希望手机浏览器能访问 PC 上的 Gateway，看见同样的 thread 和消息。

### 修改点

- 新增 Gateway HTTP server。
- 新增 API auth token。
- 新增 thread API。
- 新增 message API。
- 新增 diagnostics API。
- PC UI 改为通过 API client 访问 Gateway。
- Gateway 可配置监听 host/port。
- UI 显示手机访问 URL。

### API

```text
GET  /api/health
GET  /api/threads
POST /api/threads
GET  /api/threads/:threadId
POST /api/threads/:threadId/messages
GET  /api/threads/:threadId/events
POST /api/invocations/:invocationId/retry
POST /api/invocations/:invocationId/cancel
GET  /api/diagnostics/self-test
```

### 测试点

- 未带 token 请求被拒绝。
- 带 token 请求成功。
- 创建 thread。
- 读取 thread list。
- 读取 thread snapshot。
- 发送 message。
- retry invocation。
- cancel invocation。

### 验收标准

- PC UI 通过 HTTP API 正常工作。
- 同一局域网手机能打开 Gateway URL。
- 手机带 token 后能读取 thread。
- 手机发消息能进入同一 thread。

## Story 7: SSE Realtime

### User Story

作为用户，我希望 PC 和手机都能实时看到讨论消息和执行状态。

### 修改点

- 新增 `GET /api/stream`。
- GatewayEvent 推送到 SSE。
- 前端订阅 SSE。
- 支持 reconnect。
- 支持 snapshot fallback。
- 每个事件带 cursor/id。

### 测试点

- message.created 推送。
- invocation.running 推送。
- invocation.failed 推送。
- summary.generated 推送。
- SSE 断线重连。
- 重复事件不重复 bubble。

### 验收标准

- PC 发消息，手机实时看到。
- 手机发消息，PC 实时看到。
- Codex/Copilot running 状态实时变化。
- 断线重连后不重复消息。

## Story 8: Mobile PWA UI

### User Story

作为手机用户，我希望在手机上能舒服地看讨论、发消息、查看失败状态和重试。

### 修改点

- 新增 responsive mobile layout。
- 新增 `manifest.webmanifest`。
- 聊天页适配 390px 宽度。
- thread list 和 chat view 可切换。
- composer 适配触摸输入。
- invocation/queue 状态在手机上可见。
- failed invocation 提供 retry 操作。

### 测试点

- 390px 宽度无横向滚动。
- 430px 宽度布局正常。
- iOS Safari/Android Chrome 基础可用。
- composer 不遮挡消息。
- retry 按钮可点击。
- PWA manifest 可加载。

### 验收标准

- 手机能进入 thread list。
- 手机能进入 chat view。
- 手机能发送消息。
- 手机能看到实时回复。
- 手机能重试失败 invocation。

## Story 9: Context Packet Lite

### User Story

作为用户，我希望讨论越长也能保持上下文清楚，不要每次都把所有历史塞给 agent。

### 修改点

- 新增 `ContextAssembler`。
- 使用 recent burst，默认最近 8 条。
- 注入 thread summary。
- 注入 open questions。
- 排除 failed/canceled invocation。
- diagnostics 展示 context packet。

### 测试点

- recent burst 数量控制。
- failed/canceled 输出不进入 context。
- summary 注入。
- open questions 注入。
- 长 thread prompt 长度可控。

### 验收标准

- agent prompt 不再拼全量历史。
- 长 thread 仍可继续讨论。
- context packet 可在 diagnostics 中查看。

## Story 10: Extension Ports

### User Story

作为开发者，我希望后续能接 Redis、skills、SOP、connector 和 A2A，而不是重写核心系统。

### 修改点

- 定义 `StorePort`。
- 定义 `SkillResolver`。
- 定义 `PolicyGate`。
- 定义 `ConnectorSource`。
- 定义 `AgentProvider`。
- 定义 `AuthProvider`。
- 当前实现提供 local/file/mock/CLI 版本。

### 测试点

- runtime 依赖 port，不依赖具体实现。
- local store 可替换。
- mock provider 可替换真实 CLI provider。
- connector source 字段能进入 Message。
- A2A metadata 能被保留。

### 验收标准

- 后续接 Redis 不需要重写 UI。
- 后续接 connector 不需要重写 Message 模型。
- 后续接 A2A agent 不需要重写 thread/message/invocation 核心。

## Final Acceptance Criteria

整个阶段最终验收需要满足：

- PC 端真实可用，能完成一次 Codex + Copilot 讨论。
- 手机浏览器能通过局域网访问 Gateway。
- 手机和 PC 能进入同一个 thread。
- 手机和 PC 都能发送消息。
- 手机和 PC 都能实时看到消息和 invocation 状态。
- `@codex`、`@copilot`、`@all` 路由正确。
- Codex/Copilot 调用都有 invocation record。
- queue 防止同 thread/session 并发 CLI 混乱。
- failed invocation 可见、可重试，不重复 user message。
- summary 成功时是真实生成，失败时明确失败。
- thread snapshot 可恢复 UI。
- SSE 断线重连不重复消息。
- 390px 手机宽度无横向滚动。
- 没有 `[object Object]` 用户可见错误。
- 所有核心运行状态有 event 可追踪。
- Store、Agent、Connector、Policy、Auth 都有后续扩展 port。

## Definition of Done

- RFC 和 Story 文档已更新。
- 对应阶段代码实现完成。
- 单元测试通过。
- 前端 build 通过。
- `cargo check` 通过。
- PC 真实 CLI smoke 通过。
- 手机局域网手工验证通过。
- 验收结果记录到对应 milestone 文档。

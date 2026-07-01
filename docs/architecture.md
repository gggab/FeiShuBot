# 架构设计

## 1. 技术栈

| 关注点 | 选型 | 说明 |
|--------|------|------|
| 运行时 / 语言 | Node.js + TypeScript | 与 `mcp_larkbot_demo` 一致；AGENTS.md 约定用 Yarn |
| 飞书 SDK | `@larksuiteoapi/node-sdk` | 提供 `Client`（OpenAPI）+ `WSClient`（长连接）+ `EventDispatcher` |
| 大模型接入 | OpenAI 兼容客户端（`openai` 或 `@ai-sdk/openai-compatible`） | DeepSeek / Qwen / GLM 均提供 OpenAI 兼容 endpoint |
| 本地 CLI | `claude`（Claude Code）/ `codex`（ChatGPT CLI） | 通过子进程调用，非交互模式 |
| 知识库 | 本地 Dify（预留接口，本期不实现） | OpenAI 兼容 / Dify 自有 API |
| 包管理 | Yarn | 仅用 Yarn |

**事件接入方式**：默认使用**长连接（WebSocket）**，开发期无需内网穿透。注意飞书国内版（open.feishu.cn）支持长连接；Lark 国际版需改用 Webhook（见 [feishu-integration.md](feishu-integration.md)）。

## 2. 分层总览

```
┌──────────────────────────────────────────────────────────────┐
│                        飞书 (Feishu)                           │
│   用户消息  ──im.message.receive_v1──▶   ◀──卡片流式更新──      │
└───────────────┬──────────────────────────────────▲────────────┘
                │                                   │
        ┌───────▼───────────────────────────────────┴────────┐
        │            Feishu Adapter (feishu/)                 │
        │  WSClient + EventDispatcher + 卡片构建/节流更新      │
        └───────┬──────────────────────────────────▲─────────┘
                │ 归一化消息 (userId, chatId, text)  │ 回复流
        ┌───────▼──────────────────────────────────┴─────────┐
        │              MessageController                      │
        │  特殊命令(/clear) → 会话上下文 → 意图识别 → 路由      │
        └───┬───────────────┬───────────────────────┬────────┘
            │               │                       │
   ┌────────▼──────┐ ┌──────▼────────┐      ┌───────▼─────────┐
   │ IntentRecognizer│ │ SessionContext│      │ HandlerRegistry │
   │  (LLM 分类)    │ │ (按用户/会话)  │      │  (按意图分发)    │
   └────────────────┘ └───────────────┘      └───────┬─────────┘
                                                     │
        ┌───────────────┬───────────────┬────────────┼─────────────┐
        │               │               │            │             │
 ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼──────┐ ┌───▼──────────┐
 │CodeUnderstd│  │  BugFix    │  │ KnowledgeQA │ │   Chat       │
 │  Handler   │  │  Handler   │  │  Handler    │ │  Handler     │
 └──────┬─────┘  └──────┬─────┘  └──────┬──────┘ └───┬──────────┘
        │               │               │            │
   ┌────▼───────────────▼────┐   ┌──────▼──────┐ ┌───▼──────┐
   │      CLI Runner         │   │ Dify Client │ │ LLM Client│
   │ claude / codex 子进程    │   │  (占位)     │ │           │
   └─────────────────────────┘   └─────────────┘ └──────────┘
                  │
          ┌───────▼────────┐
          │ Project Registry│  别名→本地路径（安全边界）
          └─────────────────┘
```

## 3. 模块职责

### feishu/ — 飞书适配层
- `client.ts`：`Client` 与 `WSClient` 单例（appId/appSecret/domain）。
- `dispatcher.ts`：注册 `im.message.receive_v1`，把飞书事件归一化成 `IncomingMessage { userId, chatId, chatType, text }` 后交给 `MessageController`。
- `card.ts`：构建 markdown 流式卡片（`schema 2.0`, `streaming_mode`）。
- `reply.ts`：`sendMessage` / `updateMessage` 及**节流更新**封装（默认 200ms 一次），供 Handler 流式输出。

### controller/ — 编排层
- `MessageController`：单一入口。流程：
  1. 处理特殊命令（如 `/clear` 清空上下文、`/help`）。
  2. 取该用户的 `SessionContext`。
  3. 调 `IntentRecognizer` 得到 `IntentResult`。
  4. 由 `HandlerRegistry` 找到对应 Handler，执行并把回复流式写回卡片。
  5. 异常统一兜底回复（不吞错，见 AGENTS.md「No hidden errors」）。

### intent/ — 意图识别
- `recognizer.ts`：调用 LLM，把消息归类并抽取参数，返回结构化 `IntentResult`。
- 详见 [intent-recognition.md](intent-recognition.md)。

### handlers/ — 处理器
- 统一接口 `Handler`；`registry.ts` 按 `intent` 分发。
- 详见 [handlers.md](handlers.md)。

### cli/ — 本地 CLI 封装
- `runner.ts`：`CliRunner` 接口（`run(task): AsyncIterable<Chunk>`）。
- `claude.ts`（默认）/ `codex.ts`：两种 CLI 适配；`process.ts`：子进程 spawn、stdout 流、超时、取消。

### git/ + gitlab/ — Bug 修复落盘
- `git/workspace.ts`：在项目本地仓库内 fetch/checkout 测试分支、切 `fix/*` 分支、commit、push、失败回滚、仓库级并发锁。
- `gitlab/client.ts`：调用 GitLab API 创建 Merge Request（source=fix 分支, target=测试分支），按用户映射指派发起人为 reviewer。详见 [handlers.md](handlers.md) §3。

### llm/ — 大模型客户端
- `provider.ts`：根据配置创建 OpenAI 兼容模型（DeepSeek/Qwen/GLM）。
- `client.ts`：`chat()` 与 `chatStream()`。

### session/ — 会话上下文
- 按 `chatId` 维护近 N 轮对话，用于 chat 连续性与意图识别的上下文（群聊成员共享）。
- 内存热缓存 `Map<chatId, SessionContext>`；可选注入 `SessionStore`（SQLite）做写穿透持久化与回灌，跨重启恢复。详见 [session-persistence.md](session-persistence.md)。

### knowledge/ — 知识问答
- `dify.ts`：Dify API 客户端**接口占位**，本期返回「未接入」提示。

### config/ — 配置
- `index.ts`：环境变量装载；`projects.ts`：项目注册表。详见 [configuration.md](configuration.md)。

## 4. 关键数据流（时序）

### 4.1 代码理解 / Bug 修复（CLI 路径，可能耗时数分钟）

```
User ─▶ Feishu ─▶ Dispatcher ─▶ Controller
  Controller ─▶ IntentRecognizer ─▶ {intent: code_understanding, project, task}
  Controller ─▶ 立刻发送占位卡片 "已收到，正在分析…" (拿到 messageId)
  Controller ─▶ HandlerRegistry ─▶ CodeUnderstandingHandler
       Handler ─▶ ProjectRegistry.resolve(project) ─▶ 绝对路径(校验在允许列表内)
       Handler ─▶ CliRunner.run({cwd, prompt}) ─▶ spawn `claude -p ...`
            每段 stdout ─▶ 节流 updateMessage(messageId, 累积文本)
       完成 ─▶ 最终 updateMessage(完整结果) + 结束流式
```

要点：
- **先回执后处理**：先发占位卡片再跑 CLI，避免用户以为无响应。
- **流式回传**：CLI stdout 增量经节流写回同一张卡片。
- **并发保护**：同一用户同时只允许一个 CLI 任务（`isRunning` 标志），新任务被拒绝并提示。
- **超时/取消**：CLI 超时（可配，默认如 5 分钟）后终止子进程并回报。

### 4.2 普通聊天（LLM 路径）

```
User ─▶ … ─▶ Controller ─▶ IntentRecognizer ─▶ {intent: chat}
  Controller ─▶ ChatHandler ─▶ LLM.chatStream(history + message)
       token 流 ─▶ 节流 updateMessage
```

### 4.3 知识问答（本期占位）

```
… ─▶ KnowledgeQAHandler ─▶ Dify(占位) ─▶ 返回「知识库未接入」说明
（设计上：未来 Dify 命中不足时，可回退/叠加一次源码阅读，见 handlers.md）
```

## 5. 目录结构（实现目标）

```
src/
  app.ts                    # 入口：装配并启动长连接
  config/
    index.ts                # 环境变量配置
    projects.ts             # 项目注册表（别名→路径，安全边界）
  feishu/
    client.ts               # Client / WSClient 单例
    dispatcher.ts           # 事件注册 + 归一化
    card.ts                 # 流式 markdown 卡片构建
    reply.ts                # 发送/更新 + 节流封装
  controller/
    message-controller.ts   # 编排：命令→上下文→意图→路由
  intent/
    recognizer.ts
    prompt.ts
    types.ts
  handlers/
    types.ts                # Handler 接口、HandlerContext
    registry.ts
    code-understanding.ts
    bug-fix.ts
    knowledge-qa.ts
    chat.ts
  cli/
    runner.ts               # CliRunner 接口
    claude.ts               # 默认
    codex.ts
    process.ts              # spawn/stream/timeout/cancel
  git/
    workspace.ts            # fetch/checkout baseBranch/切 fix 分支/commit/push/回滚/仓库级锁
  gitlab/
    client.ts               # 创建 Merge Request、指派 reviewer
  llm/
    provider.ts
    client.ts
  session/
    context.ts              # 会话上下文（内存，按 chatId）
    store.ts                # SessionStore 接口 + SqliteSessionStore（可选持久化）
  knowledge/
    dify.ts                 # 占位
  util/
    throttle.ts
    logger.ts
tests/                      # 单元/集成测试（见 development-plan.md）
docs/                       # 本目录
```

## 6. 设计原则（对齐 AGENTS.md）

- **No fallback code / No hidden errors**：意图识别失败、CLI 失败、配置缺失都要显式报错或显式提示，不静默兜底成「假装成功」。唯一允许的「兜底」是意图低置信度时**显式**降级为 `chat` 并告知用户。
- **Fix root causes / Keep behavior explicit**：路由规则、置信度阈值、超时值都集中在 config，行为可读可测。
- **Docs first**：行为变更先改本目录文档与测试。

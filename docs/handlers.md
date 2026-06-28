# Handler 设计

## 1. 统一接口

```ts
interface HandlerContext {
  userId: string;
  chatId: string;
  intent: IntentResult;        // 来自意图识别
  session: SessionContext;     // 该用户的会话上下文
  reply: ReplyStream;          // 流式回复句柄（封装节流 updateMessage）
}

interface ReplyStream {
  push(textChunk: string): void;   // 追加增量，内部节流写回卡片
  done(finalText?: string): Promise<void>;
  fail(message: string): Promise<void>;
}

interface Handler {
  readonly intent: IntentResult['intent'];
  handle(ctx: HandlerContext): Promise<void>;
}
```

`HandlerRegistry` 持有四个 Handler，按 `ctx.intent.intent` 分发；找不到则显式报错（不应发生，枚举封闭）。

**通用前置**：Controller 在调用 Handler 前已发送占位卡片并拿到 `messageId`，`reply` 即绑定该卡片。

## 2. CodeUnderstandingHandler（理解项目代码）

目的：只读地阅读项目代码并解释实现逻辑/细节。

流程：
1. 解析目标项目：`ctx.intent.project` → `ProjectRegistry.resolve()` 得到绝对路径。
   - 无 `project` 且注册表只有一个项目 → 用默认项目。
   - 无 `project` 且有多个 → **追问**用户选择哪个项目（不臆测）。
   - `project` 不在允许列表 → 显式拒绝（安全边界）。
2. 组装 CLI prompt：把 `intent.task` 包成「请阅读本仓库并解释 …，只读、不要修改文件」。
3. `CliRunner.run({ cwd, prompt, mode: 'read' })`，stdout 增量经 `reply.push` 流式回卡片。
4. 结束 `reply.done()`；异常 `reply.fail()`。

约束：read 模式下提示词明确「禁止修改文件」；CLI 适配层尽量用只读/计划模式参数（见 §6）。

## 3. BugFixHandler（修改项目 bug）

目的：通过本地 CLI 定位并修复缺陷，并以 **Git 分支 + GitLab Merge Request** 的方式产出，交由任务发起人 review。**不直接把改动落到主干/测试分支**，所有改动以 MR 形式提交评审。

落盘工作流（已确认的策略，取代旧的 `propose/auto`）：

```
1. 解析项目  → ProjectRegistry 得到 { 本地仓库路径, GitLab 项目, 测试分支名 }
2. 准备工作区 → git fetch；checkout 测试分支(baseBranch)；git pull 到最新
3. 切修复分支 → git checkout -b fix/<slug>-<shortId>   （从测试分支切出）
4. CLI 修复   → CliRunner.run({ cwd, prompt, mode:'write' })
               prompt 要求：定位根因 → 修复 → 自验证（AGENTS.md Bug 工作流）
               过程 stdout 流式回卡片
5. 提交       → git add -A；git commit -m "fix: <subject>"  （AGENTS.md 提交规范）
               若无改动则显式回报「未产生修改」并清理分支，不创建空 MR
6. 推送       → git push -u origin fix/<slug>-<shortId>
7. 建 MR      → 调 GitLab API 创建 Merge Request：
               source = 修复分支, target = 测试分支(baseBranch)
               title/description 含 bug 描述、改动摘要、触发人
               assignee/reviewer = 任务发起人对应的 GitLab 用户
8. 回卡片     → 返回 MR 链接 + 摘要；提示「已提交 MR，请 review」
```

关键设计点：
- **基线分支**：从项目注册表里配置的「测试分支」（`baseBranch`，如 `test`/`develop`）切出与合回，不是 `main`。
- **任务发起人 → reviewer**：需要「飞书用户 → GitLab 用户」映射（见 [configuration.md](configuration.md) 的用户映射表）。映射缺失时：MR 照建，但 assignee 留空并在卡片提示「未找到你的 GitLab 账号映射，请手动指定 reviewer」（显式，不静默）。
- **分支命名**：`fix/<task-slug>-<shortId>`，slug 由 `intent.task` 归一化，`shortId` 防冲突。
- **幂等/清理**：CLI 未产生改动 → 不建 MR、删除临时分支；任一步失败 → `reply.fail` 并尽量回滚工作区（切回 baseBranch），不留脏分支。
- **并发**：同一项目的 Git 工作区同一时刻只允许一个 Bug 任务（仓库级锁），避免分支/工作区冲突。
- **凭据**：Git push 用项目配置的凭据/部署密钥；GitLab MR 用 `GITLAB_TOKEN`（见配置）。
- **自验证**：prompt 要求 CLI 跑项目自带校验（如 `yarn type-check`/测试）；结果写入 MR 描述，但不阻断 MR 创建（review 由人把关）。

> 默认 CLI 为 `claude`（Claude Code），可经 `CLI_PROVIDER` 切换为 `codex`。

## 4. KnowledgeQAHandler（知识问答）— 本期占位

目的：回答文档型问题（使用说明、配置、特殊情况）。

本期实现：
- `knowledge/dify.ts` 仅提供接口与占位实现，`handle()` 返回明确提示：「知识库（Dify）尚未接入，当前无法回答文档型问题；如需了解实现细节，可改问代码理解。」——显式告知，不静默退化。

未来设计（写明方向，便于后续实现，不在本期编码）：
- 调用本地部署 Dify 的对话/检索 API（OpenAI 兼容或 Dify 原生 `/v1/chat-messages`）。
- 命中不足/置信度低时，**可选叠加一次源码阅读**：转交 CodeUnderstandingHandler 的只读 CLI 流程补充实现细节，再合并作答。这条「Dify + 源码」的联动是 §intent 中「问及实现细节时同步查看源码」的落点。

## 5. ChatHandler（普通聊天）

- 取会话上下文 + 当前消息，调用 `LLM.chatStream()`，token 流经 `reply.push` 流式回卡片。
- 与意图识别共用 Provider（DeepSeek/Qwen/GLM），模型可分别配置（识别可用更小更快的模型，聊天用更强的）。
- 结束写回完整文本并入会话历史。

## 6. CLI Runner 抽象

```ts
interface CliTask {
  cwd: string;                 // 必须是 Project Registry 内的路径
  prompt: string;
  mode: 'read' | 'write';
  timeoutMs?: number;          // 默认见 config
  signal?: AbortSignal;
}

interface CliRunner {
  readonly name: 'claude' | 'codex';
  run(task: CliTask): AsyncIterable<string>;   // 产出 stdout 增量
}
```

- `process.ts`：用 `child_process.spawn` 启动，逐块读取 stdout（必要时解析 stream-json），统一超时与 `AbortSignal` 取消；进程退出码非 0 时抛出（不吞错）。
- `claude.ts`（Claude Code）：非交互执行，工作目录设为 `cwd`，read 模式倾向使用「计划/只读」相关参数；write 模式允许编辑。**具体命令行参数在实现期对照 CLI 版本确认，并回写本节。**
- `codex.ts`（Codex / ChatGPT CLI）：非交互执行，同样区分 read/write。**参数实现期确认。**
- 选择哪个 Runner：由 `CLI_PROVIDER` 配置（默认 `claude`），意图无关；未来可按项目或任务覆盖。

安全要点：
- **目录白名单**：`cwd` 必须来自 Project Registry 解析，拒绝任意路径，防止越权读写。
- **提示词即输入**：用户文本只作为 CLI 的 prompt 内容，不拼进 shell（用参数数组传递，避免命令注入）。
- **并发**：每用户单任务（`isRunning`），避免本地资源被打满。
- **超时**：到时终止子进程并回报。

## 7. 错误处理统一约定

- 任一 Handler 内部异常 → `reply.fail(可读信息)` + 记录原始错误日志（含堆栈）。
- 绝不把失败显示成成功；绝不静默丢弃错误（AGENTS.md：No hidden errors）。

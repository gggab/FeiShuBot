# Handler 设计

## 1. 统一接口

```ts
interface HandlerContext {
  userId: string;
  chatId: string;
  intent: IntentResult;        // 来自意图识别
  session: SessionContext;     // 该用户的会话上下文
  reply: ReplyStream;          // 流式回复句柄（封装节流 updateMessage）
  signal?: AbortSignal;        // 取消信号：用户点「停止回复」按钮时触发（见 feishu-integration §3.2）
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

**权限强制校验（fail-closed）**：`handle()` 第一步校验 `isAuthorizedToRead`——消息所在群 `chat_id` 命中群白名单 **或** 触发人命中人员白名单（`open_id` 或**邮箱**）才放行；两份名单皆空 → 拒绝所有人。不命中 → 卡片回「⛔ 无权限」并记审计日志，不进入阅读流程。只按「群 / 人」维度，不涉及部门。人员白名单含邮箱时经 `ContactService` 解析比对（带缓存），解析失败=邮箱维度不命中。配置与所需飞书权限见 [configuration.md](configuration.md) §2.3。

流程：
1. 解析目标项目：`ctx.intent.project` → `ProjectRegistry.resolve()` 得到绝对路径。
   - 无 `project` 且注册表只有一个项目 → 用默认项目。
   - 无 `project` 且有多个 → **追问**用户选择哪个项目（不臆测）。
   - `project` 不在允许列表 → 显式拒绝（安全边界）。
2. 组装 CLI prompt：把 `intent.task` 包成「请阅读本仓库并解释 …，只读、不要修改文件」。
3. `CliRunner.run({ cwd, prompt, mode: 'read' })`，stdout 增量经 `reply.push` 流式回卡片。
4. 结束 `reply.done()`，末尾追加**版本页脚**；异常 `reply.fail()`。

**读的是当前 checkout**：只在 `config.path` 那个本地仓库当前 HEAD 上只读阅读，**不 fetch、不切分支**（要更新/切版本用 §8 的 `/git` 命令）。因此回答基于什么代码，取决于该仓库此刻的分支/提交。

**版本页脚（透明化）**：每次回答末尾追加一行，说明本次基于哪个版本作答，形如
`📌 基于 **std-smart-office-portal（portal）** · 分支 \`develop\` · 提交 \`a1b2c3d\`（<最近提交标题>，2 天前）`；工作区有未提交改动追加「⚠️ 工作区有未提交改动」，游离 HEAD 则显示 tag 名或「游离 HEAD」。项目名取**本地仓库目录名**作为「工程完整名字」，别名不同则括号附上（`projectLabel`，便于回敲命令）。由 `git/inspect.ts`（`getRepoVersion`/`formatVersionFooter`，只读 rev-parse/log/status）在**仓库级锁内**采样，保证与实际被读代码一致；采样失败降级为「无法读取版本信息」，不阻断回答。

约束：read 模式下提示词明确「禁止修改文件」；CLI 适配层尽量用只读/计划模式参数（见 §6）。**并发**：与 `/git` 运维共享仓库级锁（`util/repo-lock.ts`），阅读期间该仓库不会被切分支/拉取。

## 3. BugFixHandler（修改项目 bug）

目的：通过本地 CLI 定位并修复缺陷，并以 **Git 分支 + GitLab Merge Request** 的方式产出，交由任务发起人 review。**不直接把改动落到主干/测试分支**，所有改动以 MR 形式提交评审。

落盘工作流（已确认的策略，取代旧的 `propose/auto`）：

```
1. 解析项目  → ProjectRegistry 得到 { 本地仓库路径, GitLab 项目, 测试分支名 }
2. 准备工作区 → git fetch origin；在【临时 worktree】中基于 origin/<baseBranch>
               创建 fix 分支（git worktree add <tmp> -b fix/... origin/<baseBranch>）。
               ★ 关键：用 worktree 隔离，绝不动用户当前已检出的工作区/分支/未提交改动。
3. CLI 修复   → CliRunner.run({ cwd: worktree, prompt, mode:'write' })
               claude --permission-mode acceptEdits，仅在 worktree 内改文件。
               处理过程打印到控制台；改动摘要收集后用于卡片/MR。
4. 提交       → 在 worktree 内 git add -A；git commit -m "fix: <subject>"
               若无改动则显式回报「未产生修改」并清理 worktree/分支，不创建空 MR。
5. 推送       → git push -u origin fix/<slug>-<shortId>（用用户已有 SSH 凭据）
6. 建 MR      → 调 GitLab API 创建 Merge Request：
               source = 修复分支, target = 测试分支(baseBranch)
               title/description 含 bug 描述、改动摘要、触发人
               assignee = 任务发起人对应的 GitLab 用户
7. 回卡片     → 返回 MR 链接 + 摘要；提示「已提交 MR，请 review」
8. 清理       → finally 中 git worktree remove --force + 删除本地分支（remote 已有）
```

关键设计点：
- **权限强制校验（fail-closed）**：`handle()` 第一步校验 `isAuthorizedToModify`——部门白名单为主、人员白名单（`open_id` 或**邮箱**）兜底；名单皆空拒绝所有人。邮箱/部门维度经 `ContactService` 解析比对，失败=拒绝。不命中 → 卡片回「⛔ 无权限」并记审计日志。配置见 [configuration.md](configuration.md) §2.2。
- **worktree 隔离**：所有改动发生在 `os.tmpdir()` 下的临时 worktree，基于 `origin/<baseBranch>`。用户本地仓库的当前分支、未提交改动、node_modules 完全不受影响（最重要的安全保证）。
- **基线分支**：项目注册表的 `baseBranch`（如 `develop`/`release`），缺省取 `GIT_DEFAULT_BASE_BRANCH`。
- **任务发起人 → reviewer**：需要「飞书 open_id → GitLab 用户」映射（见 [configuration.md](configuration.md) §2.1）。映射缺失：MR 照建，assignee 留空并在卡片提示「未找到你的 GitLab 账号映射，请手动指定 reviewer」（显式，不静默）。
- **前置校验**：项目无 `gitlabProjectId` 或未配置 `GITLAB_BASE_URL`/`GITLAB_TOKEN` → 显式拒绝，不进入流程。
- **分支命名**：`fix/<task-slug>-<shortId>`，slug 由 `intent.task` 归一化（中文任务回退 `auto`），`shortId` 防冲突。
- **幂等/清理**：无改动 → 不建 MR、删 worktree/分支；任一步失败 → `reply.fail`，finally 仍清理 worktree/分支，不留脏分支。
- **并发**：同一仓库路径同一时刻只允许一个 Bug 任务（仓库级锁）。
- **凭据**：`git push` 走用户已有 SSH key（remote 为 SSH）；GitLab MR 用 `GITLAB_TOKEN`。
- **写模式工具**：`acceptEdits` 自动批准编辑、`-p` 下 Bash 被自动拒绝（不跑构建/测试），改动范围受限更安全；自验证留待人在 MR review。

> 默认 CLI 为 `claude`（Claude Code），可经 `CLI_PROVIDER` 切换为 `codex`。

## 4. KnowledgeQAHandler（知识问答）— 接入本地 Dify

目的：回答文档型问题（使用说明、配置、特殊情况）。

实现：
- `knowledge/dify.ts` 的 `DifyClient` 调本地 Dify 的 `POST {DIFY_BASE_URL}/chat-messages`（chatflow/advanced-chat 应用，`app-` 应用密钥，`response_mode: blocking`）。
- 请求体：`{ inputs:{}, query: intent.task, response_mode:'blocking', user: 飞书userId, conversation_id? }`。
- 解析响应 `answer`；`metadata.retriever_resources[].document_name` 作为「参考来源」附在卡片末尾（去重）。
- **多轮**：按用户保存 Dify 返回的 `conversation_id`，下次带上以保持上下文。
- 未配置（缺 `DIFY_BASE_URL`/`DIFY_API_KEY`）→ 显式提示「知识库未配置」，不静默退化。
- 失败 → `reply.fail` 显式报错，且**错误可读**（No hidden errors）：
  - 连接类错误（`fetch failed`，真实原因在 `err.cause`）经 `describeFetchError` 翻译成可读原因并**带上目标 URL**，如「连接 Dify 失败（http://…/chat-messages）：连接超时（UND_ERR_CONNECT_TIMEOUT），请检查 DIFY_BASE_URL 与网络可达性」；覆盖 `ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT` 等常见 code。
  - HTTP 非 2xx 的报错也附上端点 URL。
  - 若失败源于**用户主动停止**（`signal.aborted`）→ 原样抛出，交由卡片按「已停止」收尾，不误报成连接错误。

后续可选增强（暂不实现）：
- 命中不足时**叠加一次源码阅读**：转交 CodeUnderstandingHandler 的只读 CLI 补充实现细节再合并作答（§intent「问及实现细节时同步查看源码」的落点）。

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
- `claude.ts`（Claude Code）：非交互执行（`-p <prompt> --output-format stream-json --verbose`），工作目录设为 `cwd`。read 模式 `--allowedTools Read Grep Glob`；write 模式 `--permission-mode acceptEdits --allowedTools Read Grep Glob Edit Write MultiEdit`。解析 stream-json 事件：assistant 文本块进卡片，思考/工具调用打印到控制台，`result` 文本兜底。
- `codex.ts`（Codex / ChatGPT CLI）：非交互执行 `codex exec --json <prompt>`，工作目录同样由 spawn 的 `cwd` 决定。read 模式 `--sandbox read-only`；write 模式 `--sandbox workspace-write`。带 `--skip-git-repo-check`（注册表只保证目录存在，不保证是 git 仓库）。解析 JSONL 事件：`item.completed` 且 `item.type === "agent_message"` 的 `item.text` 进卡片；`reasoning`/`command_execution`/`file_change` 打印到控制台；收到 `turn.failed` 或流级 `error` 事件**显式抛错**（进程可能仍以 0 退出，不能只靠退出码）。无头鉴权用 `CODEX_API_KEY` 环境变量（见 docs/deployment.md §4）。
  两个 Windows 实机踩过的坑（已在实现中处理）：① 子进程 stdin 必须关闭（`stdio` stdin=ignore），否则 `codex exec` 在非 TTY 下会等 stdin EOF 直到超时；② `CLI_BIN` 直指裸 `codex.exe` 时绕过了 shim，codex 自带的 rg 等工具不在 PATH 上（探索代码会慢到超时），`codexToolPathDirs` 会把二进制同目录及相邻 `path/` 目录补进子进程 PATH。
- 选择哪个 Runner：由 `CLI_PROVIDER` 配置（默认 `claude`），意图无关；未来可按项目或任务覆盖。

安全要点：
- **目录白名单**：`cwd` 必须来自 Project Registry 解析，拒绝任意路径，防止越权读写。
- **提示词即输入**：用户文本只作为 CLI 的 prompt 内容，不拼进 shell（用参数数组传递，避免命令注入）。
- **并发**：Controller 层按**会话**串行排队（`${userId}:${chatId}`，见 [feishu-integration.md](feishu-integration.md) §2.2）；同一仓库的 CLI 读/写再叠加**仓库级锁**（`util/repo-lock.ts`），避免本地资源被打满、读到一半被切分支。
- **超时**：到时终止子进程并回报。

## 7. 错误处理统一约定

- 任一 Handler 内部异常 → `reply.fail(可读信息)` + 记录原始错误日志（含堆栈）。
- 绝不把失败显示成成功；绝不静默丢弃错误（AGENTS.md：No hidden errors）。

## 8. Git 运维命令（`/git`，命令前缀，非意图）

让触发人主动**更新代码 / 切换版本**，使后续「代码理解」基于期望的分支或标签作答。是**命令前缀**触发，`MessageController` 在意图识别前拦截（`GitCommandHandler`，不走 LLM），确定性强、无误分类。命令直接操作项目本地仓库（`config.path`），**不走 worktree**（与 BugFix 不同——这里就是要改用户共享的那个 checkout）。

命令（**可一次多个项目**，或用 `all` 表示全部）：

| 命令 | 作用 |
|------|------|
| `/git status [项目…\|all]` | 显示当前分支/提交/是否有未提交改动（只读） |
| `/git pull [项目…\|all]` | 拉取当前分支最新代码（**仅快进** `--ff-only`） |
| `/git switch [项目…\|all] <分支或标签>` | 切换到指定分支/标签（`checkout` 为同义词） |

- **多项目**：`status`/`pull` 后的所有 token 都是项目列表；`switch` **最后一个 token 是分支/标签，其前都是项目**（例：`/git switch portal data main` 把两者都切到 `main`）。`all` 表示所有已注册项目。
- 省略「项目」时按 Project Registry 解析默认/唯一项目（同 §2）；`/git` 或 `/git help` 回用法。
- **批量执行与呈现**：每个项目走**各自的仓库锁**、并发执行（`Promise.all`），结果**汇总成一张卡片**逐行报告（`✅`/`⚠️`/`❌`）；单个项目失败或被拒**只影响自己那一行**，不拖垮整批。项目 token 解析阶段任一未命中/目录不存在 → 整条命令显式报错（fail fast，不半路执行）。
- **权限**：整组 `/git` 命令复用「代码修改授权」（[configuration.md](configuration.md) §2.2，`isAuthorizedToModify`）——切分支/拉取会改变共享仓库状态、影响之后所有人的阅读结果，属写类操作。未授权 → 卡片回「⛔ 无权限」并记审计日志。
- **安全约束（No fallback / No hidden errors）**：
  - 工作区有未提交改动 → **显式拒绝**（`GitRefusedError`，卡片以「⚠️」提示，非 `fail`），绝不 `--force` 覆盖用户改动。
  - `pull` 仅快进：本地与远端分叉、或处于游离 HEAD → 显式拒绝，不生成合并提交。
  - 切换到标签 → 进入游离 HEAD（页脚显示 tag 名），符合预期；`pull` 前需先 `/git switch <分支>` 回到分支。
  - 分支/标签不存在、网络/凭据错误等**非预期**失败 → `reply.fail` 显式报错。
- **并发**：与代码阅读**共享仓库级锁**（`util/repo-lock.ts`，按 `config.path` 键控），同一仓库的读/切/拉串行，避免读到一半被切走。
- 实现：`git/ops.ts`（`defaultGitOps`：`pull`/`switchRef`，注入式便于测试）+ `git/inspect.ts`（版本快照）+ `handlers/git-command.ts`（解析/授权/编排）。

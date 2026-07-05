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

**路由方式（重要，见 §9）**：不再由意图识别器预选 `project`、也不再把 codex 闭合在单个仓库。改为 **codex 在 `/repos` 作用域**（所有仓库的公共父目录）内，读 `/repos/AGENTS.md` + 各工程「简介」自行判断用户问的是哪个工程，只读阅读该工程源码作答，并在正文末尾用 `__PROJECT__: <别名>` 声明所依据的工程。因此本 Handler **不用 `resolveProject`、不加仓库锁**（放弃「阅读中防切分支」，见 §9 的取舍说明）。

流程：
1. 组装 CLI prompt：把 `intent.task` 包成「先读 AGENTS.md/简介定位工程，只读阅读该工程源码解释 …，禁止修改文件，末尾声明 `__PROJECT__`」。
2. `CliRunner.run({ cwd: reposRoot, prompt, mode: 'read' })`，stdout 增量经 `reply.push` 流式回卡片。
3. 从输出解析 `__PROJECT__` 得到别名 → **事后**对该工程仓库采样版本，追加**版本页脚**；声明缺失/非法则页脚降级为「无法确定所依据工程」。
4. 结束 `reply.done()`（正文剥掉声明行）；异常 `reply.fail()`。

**读的是当前 checkout**：只在各本地仓库当前 HEAD 上只读阅读，**不 fetch、不切分支**（要更新/切版本用 §8 的 `/git` 命令）。因此回答基于什么代码，取决于该仓库此刻的分支/提交。

**版本页脚（透明化）**：回答末尾追加一行（**跨工程时每个声明工程一行**），说明本次基于哪个版本作答（**依据 codex 声明的 `__PROJECT__` 工程事后采样**），形如
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
- **系统提示词来自助手身份**：名字与描述由项目根 `IDENTITY.md` 顶部 frontmatter（`name` / `description`）装载（`src/config/identity.ts`，缺文件/字段即显式抛错），`ChatHandler` 构造时由 `buildChatSystemPrompt(identity)` 生成。改名或调整描述改 `IDENTITY.md` 即可，代码无需改。`IDENTITY.md` 是助手身份的事实来源（区别于 `docs/` 作为项目行为的事实来源）。

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
  **容器部署（`CODEX_UNSANDBOXED=true`）**：两种模式都改用 `--sandbox danger-full-access`，关掉 codex 自带的 bwrap 沙箱——Docker 容器内 bwrap 无法为沙箱创建 network namespace 配 loopback（`RTM_NEWADDR: Operation not permitted`）。关沙箱后 codex 的读/写限制不再由沙箱内核层强制，而由**容器隔离 + 目录白名单（`cwd` 必来自注册表）+ 触发人授权名单**（§2/§2.2/§2.3）三层保证；这是 CI/容器里跑 codex 的标准姿势。仅本机开发（非容器）时保持 `false`，走原生沙箱。
  两个 Windows 实机踩过的坑（已在实现中处理）：① 子进程 stdin 必须关闭（`stdio` stdin=ignore），否则 `codex exec` 在非 TTY 下会等 stdin EOF 直到超时；② `CLI_BIN` 直指裸 `codex.exe` 时绕过了 shim，codex 自带的 rg 等工具不在 PATH 上（探索代码会慢到超时），`codexToolPathDirs` 会把二进制同目录及相邻 `path/` 目录补进子进程 PATH。
- 选择哪个 Runner：由 `CLI_PROVIDER` 配置（默认 `claude`），意图无关；未来可按项目或任务覆盖。

安全要点：
- **目录白名单**：`cwd` 必须来自 Project Registry（写类操作如 BugFix 仍闭合在单个仓库/worktree）。**例外——代码理解（§9）**：`cwd` = `reposRoot`（所有已注册仓库的公共父目录，由注册表路径推导或 `REPOS_ROOT` 指定），codex 一次可只读整个 `/repos` 子树。此时安全边界不再是「单目录」，而由 **`reposRoot` 白名单 + 触发人授权名单（§2）+ 容器隔离** 共同兜底；简介文件写入限定在 `reposRoot/<简介目录>`，不落进任何 git 仓库。
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
- **简介刷新钩子（见 §9）**：`pull`/`switch` 成功且 HEAD 变化后，对该工程按变更量刷新简介（skip/update/regenerate），使后续路由基于最新代码。刷新失败只记日志、不影响 `/git` 结果。

## 9. `/repos` 作用域路由与工程简介（自维护）

**要解决的问题**：用户常用**完整仓库名**（如 `std-smart-office-room`）指代工程，但注册表里是**短别名**（`room`）。旧设计让意图识别器预选别名、匹配不上就静默回退到 `default`（portal），导致「问 A 答 B」。本节改为让 **codex 自己借助工程简介判断**，不靠人工维护别名映射。

### 9.1 作用域与目录布局

- **`reposRoot`**：所有已注册仓库的**公共父目录**（对生产 `/repos/std-smart-office-*` 即 `/repos`）。由注册表各 `path` 推导；可用 `REPOS_ROOT` 覆盖（见 [configuration.md](configuration.md)）。
- **`reposRoot/AGENTS.md`、`reposRoot/CLAUDE.md`**：由 bot **启动时自动生成**（从注册表），`CLAUDE.md` 仅 `@AGENTS.md` 引用同一份内容。含「别名→目录→简介路径」索引表 + 对 codex 的路由约束。**自动生成、请勿手改**。**仅当内容较现有文件变化时才覆盖**（注册表没变就跳过写入，不做无谓改动）——所以「已生成后为何还重复生成」其实不会重复落盘，只是每次启动对齐注册表这一事实来源。
- **简介目录 `reposRoot/<简介目录>/`**（默认 `.agent-intros/`，可配）：每个工程一份 `<别名>.md`。放在仓库**外面**——只读沙箱写不进仓库、且不污染任何仓库的 `git status`（前提是 `reposRoot` 本身不在 git 管理下，否则用 `.gitignore` 排除）。

### 9.2 路由（代码理解 / BugFix 定位共用）

codex 以 `cwd = reposRoot` 运行，`AGENTS.md` 要求它：
1. 先读各工程简介，判断用户问的是哪个工程；
2. 只做只读分析；**允许跨工程阅读**——问题涉及前后端联动的完整链路时（如前端 `xxx-frontend` 与其后端服务），可同时只读阅读相关的多个工程，把端到端逻辑讲清楚，但聚焦相关工程、不翻无关工程；
3. 正文最后单独一行输出 `__PROJECT__: <别名>` 声明依据的工程；**跨工程时列出全部、用逗号分隔**（如 `__PROJECT__: portal, user`）。

系统据 `__PROJECT__` 采样**每个**声明工程的版本作页脚（§2，多工程 → 多行页脚），并从展示正文里剥掉声明行。声明缺失/非法 → 页脚降级、不阻断回答。
- **代码理解**：只读，`mode: 'read'`，可跨工程。
- **BugFix**：不能在 `/repos` 漫游改码——先跑一次**只读路由 pass**（`cwd=reposRoot`）拿到**唯一主工程别名**（`__PROJECT__` 的第一个），再走 §3 原有的 worktree/MR 流程（对该别名建 worktree、按其 `gitlabProjectId`/`baseBranch` 提 MR）。修复落盘仍限单工程；跨工程仅用于「阅读理解」。这样 §7 抱怨的错路由在 BugFix 上也一并修复。

### 9.3 简介生成与更新（自维护）

- **与分支无关**：简介描述「这个工程是什么」，是**分支无关**的，因此始终基于**当前 checkout 的 HEAD**生成，不绑定任何固定分支（前端 `release`/`develop`、后端 `release-v1.xxx`/大量 `feat/` 都无需特殊配置）。frontmatter 记录生成时的 commit（分支名可记作参考，但不作为键，不为每个分支存多份——那样只会数量爆炸而对「路由」无收益）。
- **懒生成**：某工程无简介时，跑一次 codex **只读**（`cwd = 该仓库`，`mode: 'read'`）读源码、**只输出简介正文**；由 **bot 落盘**（bot 有文件系统权限，写 `reposRoot/<简介目录>/<别名>.md`，并补上含 **commit SHA** 的 frontmatter）。这样生成过程本身仍是只读，不需要写沙箱，简介文件的路径/frontmatter 由 bot 掌控。
- **按变更量更新**：以简介记录的 SHA 为基线，`git diff --stat <SHA>..HEAD` 得到「改动文件数 / 增删行数」：
  - 无变化 → **skip**；
  - 小改（低于阈值）→ **update**：把现有简介 + diff 摘要喂给 codex，让它只读输出修订后的简介正文，bot 覆盖落盘；
  - 大改（≥ `INTRO_REGEN_FILES` 或 `INTRO_REGEN_LINES`）→ **regenerate**：整份重写。
  - 更新后刷新 frontmatter 的 SHA。阈值可配（见 [configuration.md](configuration.md)）。
- **触发点**：① 启动时对缺失简介懒生成；② `/git pull|switch` 成功后（§8 钩子）**标记该工程待刷新**（不立即重跑）；③ 路由 pass 若发现仍缺简介可就地补。生成/更新失败只记日志、降级（无简介时路由仅少一条线索，不致命）。
- **刷新调度（抗频繁切分支）**：`/git` 钩子只调 `markDirty(alias)`，实际刷新由维护器统一择机进行，三重保护：
  - **去抖**（`INTRO_REFRESH_DEBOUNCE_MS`）：连续切换合并为一次；
  - **节流**（`INTRO_REFRESH_MIN_INTERVAL_MS`）：同一工程在窗口内只刷一次，频繁在 `develop`/`feat/*`/`release-v1.x` 间跳来跳去也不会反复重跑昂贵的 CLI 生成；
  - **单飞**：同一工程同时只跑一个刷新，避免多个 CLI 并发读同一仓库、结束时相互覆盖简介文件。
  - **游离 HEAD 跳过**：切到 tag/裸提交（`switch` 到标签）是「临时看看」，不刷新已有简介，避免被临时态污染（简介缺失时仍会生成，因为简介与分支无关）。

### 9.4 取舍（相对旧设计）

- **放弃仓库锁与「阅读中防切分支」**（已确认）：代码理解不再持有仓库级锁，读到一半可能被他人 `/git switch` 改变 HEAD；页脚按声明工程事后采样，可能与读取瞬间略有偏差。换取的是 codex 在 `/repos` 自主路由。仓库锁仍用于 `/git` 命令之间、以及 BugFix 的单仓库互斥。
- **安全边界放宽**：代码理解的 `cwd` 从单目录变为 `reposRoot`，codex 可只读整个 `/repos`；由 `reposRoot` 白名单 + 触发人授权（§2）+ 容器隔离兜底（见 §6）。

### 9.5 可测试点

- `reposRoot` 推导：多仓库公共父目录 / 单仓库取父级 / 无公共父目录报错 / `REPOS_ROOT` 覆盖。
- `AGENTS.md` 生成：索引表含全部别名与目录/简介路径；`CLAUDE.md` 为 `@AGENTS.md`；**内容未变则跳过写入**。
- 简介 frontmatter：format→parse 往返；缺字段容错。
- 变更量决策：0 改动=skip、小改=update、超阈值=regenerate（边界值）。
- 刷新调度：节流窗口内重复标记不重跑、过窗后再刷；游离 HEAD（切 tag）跳过刷新（简介缺失仍生成）。
- 声明解析：单个/**逗号分隔多个**（跨工程）`__PROJECT__`、按序去重、校验别名、剥离声明行；缺失/非法→空；主工程取第一个（BugFix 用）。

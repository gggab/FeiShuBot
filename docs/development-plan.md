# 开发计划

对齐 AGENTS.md 的 Feature 工作流：**读文档 → 规划 → 写测试 → 实现 → 审查测试**。需求变更须同步更新：docs、开发文档、测试。

## 1. 里程碑

### M0 — 脚手架 ✅（2026-06-28 完成）
- `package.json`（Yarn）、`tsconfig.json`（strict + noUnused）、`.env.example`、`.gitignore`、`src/` 全量目录骨架。
- 脚本：`dev` / `build` / `type-check` / `start`。
- 设计契约已落代码：`config/`、`intent/types`、`handlers/types`、`cli/runner`、`session/context`、`util/{logger,throttle}`；其余模块为带里程碑标注的占位。
- 验收已通过：`yarn install`、`yarn type-check`、`yarn build` 均 0 报错；`yarn dev` 可启动并打印配置摘要。

### M1 — 飞书最小回声 ✅（2026-06-28 完成）
- `feishu/`：`client`（Client/WSClient 单例，缺凭据显式抛错）、`message`（事件归一化纯函数）、`dispatcher`（注册 `im.message.receive_v1`，单条失败不中断监听）、`reply.sendText`。
- `controller/message-controller`：M1 原样回声（M3 替换为意图路由）。
- `config` 增加加载 `.env.local`（覆盖 `.env`）。
- 测试：`tests/feishu/message.test.ts`（vitest）覆盖文本/非文本/非法 JSON/缺字段，4 项通过。
- 验收已通过：`yarn type-check`、`yarn test` 0 报错；`yarn dev` 用真实凭据成功建立长连接（`ws client ready`）。
- 待人工冒烟：在飞书单聊向机器人发文本，确认收到 `收到：<原文>` 回声（需真实账号操作）。

### M2 — 大模型客户端 + 普通聊天 ✅（2026-06-28 完成）
- `llm/client.ts`（`LlmClient` 接口 + `OpenAiClient`，可注入 mock）+ `llm/provider.ts`（工厂，缺配置显式抛错）。
- `feishu/card.ts`（流式 markdown 卡片）+ `feishu/reply.ts` 增 `sendCard`/`updateCard`/`CardReplyStream`（节流更新 + closed 守卫）。
- `session/context.ts`（按用户单例、近 maxTurns 轮、`getHistory` 返回副本）。
- `handlers/chat.ts`（流式聊天 + 写回会话 + 失败 `reply.fail`）；`MessageController` 改为：`/clear` → 每用户单任务守卫 → 流式聊天。
- 测试：`session`(3) + `card`(2) + `chat`(2) + 既有 `message`(4) = 11 项全通过。
- 验收已通过：`yarn type-check`、`yarn test` 0 报错；一次性 live 调用确认 `deepseek-v4-flash` 可用；`yarn dev` 启动后长连接 + LLM 客户端就绪。
- 待人工冒烟：飞书内多轮闲聊看流式显示；`/clear` 后上下文被清空。

### M3 — 意图识别 + 路由 ✅（2026-06-28 完成）
- `intent/prompt.ts`（分类系统/用户提示词，含项目别名与指代上下文）+ `intent/recognizer.ts`（`parseIntentResult` 纯函数 + `IntentRecognizer`：阈值降级、解析失败重试 1 次后降级、LLM 异常抛 `IntentServiceError`）。
- `handlers/registry.ts`；`code-understanding`/`bug-fix`/`knowledge-qa` 改为可观测占位 Handler（M4/M5 替换）。
- `MessageController` 改为：`/clear` → 单任务守卫 → 意图识别 →（降级则显式提示）→ 路由到 Handler。
- 测试：`intent/parse`(7) + `intent/recognizer`(5) + `handlers/registry`(2) = 14 新增，合计 **29 项全通过**。
- 验收已通过：`yarn type-check`、`yarn test` 0 报错；live 调用 `deepseek-v4-flash` 对 5 条标注样本**全部分类正确**（chat/code/bug/knowledge）且 JSON 可解析；`yarn dev` 启动正常。
- 待人工冒烟：飞书内分别发四类问题，观察分类与占位/聊天回复；构造模糊问题验证低置信度降级提示。

### M4 — CLI 集成

#### M4a — 代码理解（只读）✅（2026-06-28 完成）
- `cli/process.ts`（spawn + 流式 stdout + 超时 + 取消）、`cli/claude.ts`（`buildClaudeArgs`：只读用 `--allowedTools Read Grep Glob`，写用 `--permission-mode acceptEdits`）、`cli/factory.ts`（按 `CLI_PROVIDER` 取 runner，默认 claude）。
- `handlers/resolve-project.ts`（纯函数：默认/唯一/追问/未知拒绝/目录不存在校验，安全边界）。
- `CodeUnderstandingHandler`：解析项目 → 在 `cwd` 内 `claude -p` 只读阅读 → 流式回卡片。
- CLI 用 `--output-format stream-json --verbose`：控制台打印**后端对 Claude 的调用命令**与 **Claude 的处理过程**（初始化/思考/工具调用/工具结果/完成统计），卡片仅收干净文本（`parseClaudeStream`）。
- 测试：`resolve-project`(7) + `cli/claude-args`(3) = 10 新增，合计 **39 项全通过**。
- 验收已通过：`yarn type-check`/`yarn test` 0 报错；live 跑通——在 portal 仓库只读提问，claude 读 `package.json` 正确答出「Vue 3 + Vite 5」；spawn/stream/exit 正常。
- 注意：Windows 下 `CLI_BIN` 需填 `claude.exe` 绝对路径（spawn 不走 PATHEXT）。
- 待人工冒烟：飞书内问「portal 的登录怎么实现」，观察卡片流式给出解释。

#### M4b — Bug 修复（GitLab MR 流程）✅（2026-06-29 完成）
- `git/run.ts`（execFile git）+ `git/workspace.ts`（**worktree 隔离**：fetch / createWorktree(基于 origin/baseBranch) / hasChanges / changedFiles / commitAll / push / cleanup）。
- `gitlab/client.ts`（`createMergeRequest` + `buildMergeRequestUrl`，PRIVATE-TOKEN）。
- `handlers/bugfix-naming.ts`（slug/分支名/提交信息/提示词/MR 描述，纯函数）。
- `BugFixHandler`：解析项目（需 `gitlabProjectId` + 已配 GitLab）→ 仓库级锁 → worktree 修复 → 无改动则取消清理 → commit/push → 建 MR（指派发起人）→ 回卡片 MR 链接；finally 清理 worktree/分支。
- 测试：`bugfix-naming`(5) + `gitlab/client`(2) + `git/workspace` 本地裸仓库集成(1) = 8 新增，合计 **50 项全通过**。
- 验收：`yarn type-check`/`yarn test` 0 报错；worktree 集成测试证明改动走临时 worktree、**用户工作区分支不受影响**、push 到 origin、cleanup 干净。
- 已确认运行时配置就绪：启动日志显示 `GitLab MR: https://gitlab.sz.sensetime.com`、CLI bin 已配。
- 待人工冒烟（真实外发，由用户在飞书触发）：报一个具体 bug → 观察卡片 ①②③④ 进度 + 控制台 Claude 处理 → 拿到 MR 链接；`USER_MAP_JSON` 配好则自动指派 reviewer。

### M5 — 知识问答（接入本地 Dify）✅（2026-06-29 完成）
- `knowledge/dify.ts`：`DifyClient.chat`（`POST {DIFY_BASE_URL}/chat-messages`，blocking）+ `parseDifyAnswer`（答案/会话id/去重引用，剥离 `<think>` 推理块）+ `buildChatMessagesUrl`。
- `KnowledgeQaHandler`：调 Dify，按用户维护 `conversation_id` 多轮；附「📎 参考」引用；未配置/失败显式提示，不静默。
- 测试：`knowledge/dify`(6，含 URL/解析/think 剥离/fetch mock 成功与 401) ，合计 **61 项全通过**。
- 验收：`yarn type-check`/`yarn test` 0 报错；live 调通自建 Dify（`http://172.20.14.199/v1`，advanced-chat 应用），答案+会话id 正确解析，`<think>` 已剥离。
- 待人工冒烟：飞书问文档型问题（如「xx 怎么配置/部署」），观察知识库作答与参考来源。

### M6 — 部门级权限 + 用户信息自动化 + 配置健壮性 ✅（2026-06-30 实现）

本轮范围 = A + B + C + D（2026-06-29 与用户确认；E/F 顺延）。
代码与单测已完成（`yarn type-check`/`yarn test` 67 项全过，新增 contact 缓存/部门授权/GitLab 邮箱查询测试）。
**待运行时**：A/B/C 真跑需后台开通 `contact:contact.base:readonly`；未开通时 open_id 白名单兜底、reviewer 回退手填。

#### A — 通讯录服务 + 用户缓存
- `feishu/contact.ts`：用 `client.contact.v3.user.get(open_id, user_id_type=open_id)` 拉取
  `{ name, email, departmentIds }`，带 TTL 缓存（如 30 分钟），失败显式抛错。
- 是 B/C 的基础。**前置**：开发者后台为应用申请通讯录读权限（`contact:user.base:readonly`
  + 读邮箱/部门的相应 scope），并设置应用可见范围能看到这些人。

#### B — 部门级权限（部门白名单为主，open_id 白名单兜底）
- `auth/authorization.ts` 扩展：`canModifyCode` 改为「用户部门 ∩ 允许部门集合 ≠ ∅ **或** open_id 在白名单」。
- 新增配置 `BUGFIX_ALLOWED_DEPARTMENTS`（部门 id 列表，文件或 env）。
- 仍 fail-closed：两者都空 → 拒绝所有人。校验需要 A 解析用户部门。

#### C — GitLab reviewer 自动映射（email 连接键）
- `gitlab/client.ts` 增 `findUserByEmail`（`GET /api/v4/users?search=<email>`）。
- BugFix 指派 reviewer：open_id →(A)→ email →(GitLab)→ gitlabUserId，带缓存；
  命中不到再回退手填 `usermap.json`。**前提已确认：飞书邮箱 == GitLab 邮箱**。

#### D — 配置健壮性
- 启动即校验「核心必填」（`APP_ID`/`APP_SECRET`/`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`），
  缺失则打印明确错误并 `process.exit(1)`（不再拖到用到时才报）。
- 功能型配置（GitLab/Dify/通讯录）仍按需校验 + 启动告警。

验收：`yarn type-check`/`yarn test` 0 报错；部门授权/自动映射有单测（mock 通讯录与 GitLab）；
缺核心配置时启动直接失败退出；live 验证通讯录拉取与 email→GitLab 解析。

#### 顺延（不在本轮）
- E：全局并发闸 + LLM 429 退避。
- F：会话/conversation 持久化或 LRU 淘汰（防内存只增）。

## 2. 测试策略

> AGENTS.md：先写测试再实现；审查测试。

单元测试（mock 外部依赖）：
- `intent`：分类样本集、JSON 解析、置信度降级、LLM 异常显式兜底。
- `cli`：路径白名单校验、命令以参数数组传递（无注入）、超时/取消、非零退出抛错。
- `handlers`：路由正确；BugFix 的 `propose`/`auto` 分支；KnowledgeQA 占位返回。
- `config`：必填缺失即报错；Project Registry 解析与拒绝。
- `feishu/reply`：节流更新调用次数符合预期。

集成测试（可选 / 半自动）：
- 端到端：mock 飞书 SDK，模拟一条消息 → 意图 → Handler → 回复更新链路。
- 真连飞书的冒烟测试以手动联调为主（需真实 App 凭据）。

外部依赖一律 mock：LLM HTTP、`child_process.spawn`、飞书 SDK。

## 3. 与文档的同步约定

- 任一行为/接口/配置变化：先改 `docs/` 对应文档与测试，再改实现。
- 提示词（意图分类）、CLI 命令行参数、`streaming_mode` 行为、权限 scope 这些「实现期才能最终敲定」的点，确定后**回写**对应文档的占位说明。

## 4. 已确认决策（2026-06-28）

| 决策 | 结论 | 影响文档 |
|------|------|----------|
| 默认 CLI | **Claude Code（claude）**，可配置切 codex | handlers / configuration |
| Bug 修复落盘 | **GitLab MR 流程**：从测试分支切修复分支 → 提交 → 建 MR → 指派发起人 review | handlers §3 / configuration |
| 目标平台 | **飞书国内版**（open.feishu.cn，长连接 WSClient） | feishu-integration |
| 默认模型 Provider | `deepseek`（可配 qwen/glm） | configuration |

实现期仍需在文档回写确认的占位：CLI 具体命令行参数、意图分类提示词最终文案、`streaming_mode` 行为、飞书权限 scope、GitLab MR API 字段细节。

## 5. 提交规范（AGENTS.md）

`<type>: <subject>`，type ∈ {feat, fix, chore, docs, style, refactor, build, revert}。
本次文档提交示例：`docs: add FeiShuBot design and development docs`。

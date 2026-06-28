# 开发计划

对齐 AGENTS.md 的 Feature 工作流：**读文档 → 规划 → 写测试 → 实现 → 审查测试**。需求变更须同步更新：docs、开发文档、测试。

## 1. 里程碑

### M0 — 脚手架 ✅（2026-06-28 完成）
- `package.json`（Yarn）、`tsconfig.json`（strict + noUnused）、`.env.example`、`.gitignore`、`src/` 全量目录骨架。
- 脚本：`dev` / `build` / `type-check` / `start`。
- 设计契约已落代码：`config/`、`intent/types`、`handlers/types`、`cli/runner`、`session/context`、`util/{logger,throttle}`；其余模块为带里程碑标注的占位。
- 验收已通过：`yarn install`、`yarn type-check`、`yarn build` 均 0 报错；`yarn dev` 可启动并打印配置摘要。

### M1 — 飞书最小回声
- `feishu/`：WSClient + dispatcher，收 `im.message.receive_v1`，原样回声。
- 验收：单聊发文本，机器人回复（验证应用配置、长连接打通）。

### M2 — 大模型客户端 + 普通聊天
- `llm/provider.ts` + `client.ts`（OpenAI 兼容，DeepSeek/Qwen/GLM 可切）。
- `ChatHandler` + 流式卡片回复 + `SessionContext`。
- 验收：闲聊能多轮、流式显示；`/clear` 清空上下文。

### M3 — 意图识别 + 路由
- `intent/recognizer.ts` + `prompt.ts`；`HandlerRegistry`。
- 暂时四类都先接到「占位/或 chat」，重点验证分类与路由、置信度降级。
- 验收：标注样本分类命中达标；低置信度显式降级。

### M4 — CLI 集成（代码理解 + Bug 修复 MR 流程）
- `cli/`：`CliRunner` + `claude`(默认)/`codex` 适配 + spawn/stream/timeout/cancel。
- `config/projects.ts` 项目注册表（含 `gitlabProjectId`/`baseBranch`）+ 目录白名单 + 用户映射。
- `CodeUnderstandingHandler`（只读）。
- `BugFixHandler` + `git/`（工作区准备、切分支、提交、推送）+ `gitlab/`（创建 MR）：
  从测试分支切 `fix/*` → CLI 修复 → commit → push → 建 MR → 指派发起人。
- 验收：
  - 注册项目内只读解释代码可用；越权路径被拒；超时可终止。
  - Bug 修复能从 baseBranch 切分支、提交、推送、建出 MR，target=baseBranch，回卡片给 MR 链接。
  - 无改动时不建空 MR 并清理分支；失败时回滚工作区、不留脏分支。
  - 用户映射命中→指派 reviewer；未命中→MR 照建并显式提示。
  - 同项目并发被仓库级锁串行化。

### M5 — 知识问答占位
- `knowledge/dify.ts` 接口 + `KnowledgeQAHandler` 显式「未接入」提示。
- 验收：`knowledge_qa` 意图返回明确占位说明，不报错、不静默退化。

### M6 — 健壮化
- 统一错误处理与日志、并发保护、配置校验失败即退出。
- 验收：异常路径都有显式用户提示 + 日志；无静默吞错。

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

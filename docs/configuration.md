# 配置说明

所有配置通过环境变量（`.env`）装载，集中在 `src/config/index.ts`。`.env` 不入库；提供 `.env.example` 模板。

## 1. 环境变量

### 飞书
| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `APP_ID` | ✅ | — | 飞书应用 App ID |
| `APP_SECRET` | ✅ | — | 飞书应用 App Secret |
| `LARK_DOMAIN` | | `https://open.feishu.cn` | 国内版；Lark 国际版改 `https://open.larksuite.com` |

### 大模型（意图识别 + 聊天，OpenAI 兼容）
| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `LLM_PROVIDER` | | `deepseek` | `deepseek` / `qwen` / `glm` |
| `LLM_BASE_URL` | ✅ | — | OpenAI 兼容 endpoint |
| `LLM_API_KEY` | ✅ | — | API Key |
| `LLM_MODEL` | ✅ | — | 聊天用模型名 |
| `INTENT_MODEL` | | 同 `LLM_MODEL` | 意图识别用模型（可选更快更小） |
| `INTENT_MIN_CONFIDENCE` | | `0.5` | 低于此值降级为 chat（见 intent-recognition.md） |

常用 Provider 参考（endpoint/模型名以官方为准，实现期回写确认）：
- DeepSeek：`https://api.deepseek.com`，如 `deepseek-chat`。
- 通义千问（DashScope 兼容）：`https://dashscope.aliyuncs.com/compatible-mode/v1`，如 `qwen-plus`。
- 智谱 GLM：`https://open.bigmodel.cn/api/paas/v4`，如 `glm-4`。

### 本地 CLI
| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `CLI_PROVIDER` | | `claude` | `claude`（Claude Code，默认）/ `codex`（ChatGPT CLI） |
| `CLI_BIN` | | 同 provider 名 | 可执行文件路径（不在 PATH 时指定绝对路径） |
| `CODEX_API_KEY` | `codex` 时 | — | Codex CLI 无头鉴权（本应用不读，由 codex 子进程继承环境变量） |
| `CLI_TIMEOUT_MS` | | `300000` | 只读代码理解超时（5 分钟） |
| `BUGFIX_TIMEOUT_MS` | | `1200000` | Bug 修复（写）超时（20 分钟；定位+修改更耗时） |
| `CODEX_UNSANDBOXED` | | `false` | 仅 `codex`：`true` 时用 `--sandbox danger-full-access` 关掉 codex 自带 bwrap 沙箱。**容器部署必须置 true**（Docker 内 bwrap 无法建 network namespace 配 loopback，会报 `RTM_NEWADDR: Operation not permitted`）；此时读/写边界由容器隔离 + 注册表路径白名单 + 触发人授权名单保证。见 [handlers.md](handlers.md) §6 |

### Bug 修复 / GitLab（MR 工作流）
BugFixHandler 从测试分支切修复分支 → 提交 → 建 MR → 指派发起人（见 handlers.md §3）。

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `GITLAB_BASE_URL` | ✅(用到时) | — | GitLab 实例地址，如 `https://gitlab.company.com` |
| `GITLAB_TOKEN` | ✅(用到时) | — | 建 MR 用的 access token（需 `api` 权限） |
| `GIT_DEFAULT_BASE_BRANCH` | | `test` | 项目未单独配置时的默认测试分支 |
| `FIX_BRANCH_PREFIX` | | `fix/` | 修复分支前缀 |

### 知识库（Dify）
| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `DIFY_BASE_URL` | 知识问答用到时 | — | Dify API 基址，含 `/v1`，如 `http://172.20.14.199/v1` |
| `DIFY_API_KEY` | 同上 | — | Dify 应用 API Key（`app-` 前缀，chatflow/advanced-chat 应用） |

未配置时知识问答显式提示「未配置」，不影响其它意图。

### 服务
| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `PORT` | | `3000` | 仅 Webhook / 卡片回调 / 健康检查需要；纯长连接可不监听 |
| `SESSION_MAX_TURNS` | | `10` | 会话上下文（内存）保留轮数 |
| `LOG_LEVEL` | | `info` | 日志级别 |

### 会话持久化（SQLite）
详见 [session-persistence.md](session-persistence.md)。默认关闭即纯内存（行为同前）；开启后会话上下文按 `chatId` 落盘、跨重启恢复。

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `SESSION_PERSIST` | | `false` | 是否启用持久化（false=纯内存，进程重启即丢） |
| `SESSION_DB_FILE` | | `session.db` | SQLite 文件路径（git 忽略，含 `-wal`/`-shm` 旁文件） |
| `SESSION_STORE_MAX_MESSAGES` | | `200` | 每会话(chatId)归档消息硬上限，超出裁掉最旧 |
| `SESSION_RETENTION_DAYS` | | `365` | 超过该天数的消息按 `created_at` 清理；`0`=不按时间清理 |

## 2. 项目注册表（Project Registry）

`src/config/projects.ts` 维护**别名 → 本地绝对路径**映射，是 CLI 执行的**安全边界**：CLI 只能在注册过的目录内运行。

**加载优先级**（`loadJsonConfig`，缺/坏即显式抛错）：
1. **文件**：`PROJECTS_FILE`（默认 `projects.json`，git 忽略），存在即用——**推荐**，多仓库时可读性好；
2. 否则内联环境变量 `PROJECTS_JSON`（小型场景）；
3. 都没有则为空注册表。

`projects.json` 示例（见 `projects.example.json`）：

```json
{
  "portal": {
    "path": "C:/Users/you/work/std-smart-office-portal",
    "default": true,
    "gitlabProjectId": "ksa/standard-smart-office/frontend/std-smart-office-portal",
    "baseBranch": "develop"
  },
  "data": {
    "path": "C:/Users/you/work/std-smart-office-data",
    "gitlabProjectId": "ksa/standard-smart-office/std-smart-office-data"
  }
}
```

字段：
- `path`：本地仓库绝对路径（CLI 执行的安全边界）。**Windows 用正斜杠 `/`**。
- `default`：未指定项目时使用。
- `gitlabProjectId`：GitLab 项目路径或数字 ID，建 MR 用；不配则该项目不支持 Bug 修复 MR 流程（Handler 显式提示，仍可只读代码理解）。**跨 GitLab 实例的仓库无法用同一 `GITLAB_BASE_URL` 建 MR**，可只配 `path` 走只读。
- `baseBranch`：测试/集成分支，BugFix 从此切出并以此为 MR target；缺省取 `GIT_DEFAULT_BASE_BRANCH`。仅 Bug 修复用；只读代码理解可不填。

规则：
- 意图识别给出的 `project` 别名必须命中此表，否则视为未指定。
- 未指定且存在 `default` → 用默认项目；多项目且无默认 → Handler 追问。
- 任何不在表中的路径一律拒绝。

## 2.1 飞书用户 → GitLab 用户映射

BugFix 建 MR 后需把任务发起人设为 reviewer/assignee，需要「飞书 open_id → GitLab 用户」映射。与项目注册表同样的加载优先级：文件 `USER_MAP_FILE`（默认 `usermap.json`，git 忽略）> 环境变量 `USER_MAP_JSON`：

```json
{
  "ou_xxxxxxxxopenid1": { "gitlabUserId": 12, "gitlabUsername": "zhangsan" },
  "ou_xxxxxxxxopenid2": { "gitlabUserId": 34, "gitlabUsername": "lisi" }
}
```

- 命中 → MR 的 `assignee_id`/`reviewer_ids` 用对应 GitLab 用户。
- 未命中 → MR 照建，assignee 留空，卡片提示「未找到你的 GitLab 账号映射，请手动指定 reviewer」（显式，不静默）。

## 2.2 代码修改授权（部门为主 + 人员白名单兜底，强制校验）

「修改代码 / Bug 修复」是写操作（push 分支、建 MR），**只有授权人员可触发**；只读代码理解不受限。`BugFixHandler` 入口强制校验（`isAuthorizedToModify`）：

> **用户部门 ∩ 允许部门 ≠ ∅** 或 **人员白名单（open_id 或邮箱）命中** → 放行；两者皆空 → **fail-closed 拒绝所有人**。

配置（均：文件 > 内联 env > 空）：

| 维度 | 文件（git 忽略） | env | 内容 |
|------|------|-----|------|
| 部门白名单（主） | `bugfix-allowed-departments.json`（`BUGFIX_ALLOWED_DEPARTMENTS_FILE`） | `BUGFIX_ALLOWED_DEPARTMENTS` | `open_department_id` 数组 |
| 人员白名单（兜底） | `bugfix-allowlist.json`（`BUGFIX_ALLOWLIST_FILE`） | `BUGFIX_ALLOWLIST` | open_id 或**邮箱**数组，可混用 |

- 人员白名单条目：含 `@` 视为**邮箱**（推荐，人可读；忽略大小写比对），其余视为 open_id。邮箱比对时把触发人 open_id 经通讯录解析成邮箱（`enterprise_email` 优先）再比较；解析不到邮箱=该维度不命中。
- 部门/邮箱校验需要**通讯录读权限**（A：`feishu/contact.ts`）。后台须为应用开通 **`contact:contact.base:readonly`**（或 `contact:contact:readonly`）并设可见范围；邮箱比对还需邮箱字段权限（企业邮箱 `contact:user.enterprise_email:readonly` / 邮箱 `contact:user.email:readonly`）。未开通时该维度校验失败=拒绝，但 open_id 条目仍可直接命中放行。
- 取部门 id：用户发条消息后，控制台 `[消息] from=ou_...`；A 接通后日志/调试可打印其 `departmentIds`，挑出研发部门 id 填入。
- 取 open_id：同上看 `from=ou_...`（配了邮箱通常无需再取）。
- **本授权同时管辖 `/git` 运维命令**（`/git pull`/`switch`/`status`，见 [handlers.md](handlers.md) §8）：切分支/拉取会改变共享仓库状态，属写类操作，与「修改代码」同一份白名单。

### reviewer 自动映射（C）
建 MR 指派发起人：手填 `usermap.json` 优先；否则用通讯录邮箱 → GitLab 自动匹配。
GitLab 查找先按完整邮箱搜（仅公开邮箱/管理员 token 有效），搜不到再按**邮箱前缀（通常= GitLab 用户名）**搜。都未命中 → 卡片提示手动指定。
> 运行时前提：应用（tenant）身份能读到该用户的 email（需通讯录字段权限）。

## 2.3 代码理解访问授权（群 / 人白名单，强制校验）

「代码理解 / 阅读源码」会调用本地 CLI 只读读取注册项目的源码，**只有授权的群或人员可触发**。`CodeUnderstandingHandler` 入口强制校验（`isAuthorizedToRead`）：

> **消息所在群 `chat_id` 在群白名单** 或 **触发人命中人员白名单（open_id 或邮箱）** → 放行；两者皆空 → **fail-closed 拒绝所有人**。

只按「群 / 人」两个维度，不涉及部门。配置（均：文件 > 内联 env > 空）：

| 维度 | 文件（git 忽略） | env | 内容 |
|------|------|-----|------|
| 群白名单 | `code-read-allowed-chats.json`（`CODE_READ_ALLOWED_CHATS_FILE`） | `CODE_READ_ALLOWED_CHATS` | `chat_id` 数组（群里任何人可阅读源码） |
| 人员白名单 | `code-read-allowlist.json`（`CODE_READ_ALLOWLIST_FILE`） | `CODE_READ_ALLOWLIST` | open_id 或**邮箱**数组，可混用（个人，含单聊/任意群） |

- 人员白名单条目：含 `@` 视为**邮箱**（推荐，人可读；忽略大小写比对），其余视为 open_id。邮箱比对时把触发人 open_id 经通讯录解析成邮箱再比较（结果 30 分钟 TTL 缓存）；解析不到=该维度不命中（fail-closed）。
- 权限要求：**纯 id 名单无需任何额外权限**；人员白名单用了邮箱需通讯录读权限及邮箱字段权限（同 §2.2）。
- 取 `chat_id`：用户在目标群发条消息后，控制台 `[消息]` 日志含 `chat=oc_...`；把允许的群 id 填入群白名单。取 open_id 同理看 `from=ou_...`（配了邮箱通常无需再取）。
- 与「代码修改授权」相互独立：阅读源码只看本节两份名单；修改代码看 §2.2。

## 2.4 卡片「停止回复」按钮权限（群管理员判断）

处理中的卡片带「停止回复」按钮，仅**发起人本人**或（群聊里）**群主 / 群管理员**可停止（见 [feishu-integration.md](feishu-integration.md) §3.2）。

- 群主/管理员通过 `im.v1.chat.get` 的 `owner_id` + `user_manager_id_list` 判断（`feishu/chat-admin.ts`，按 `chatId` 5 分钟 TTL 缓存）。
- 权限要求：后台为应用开通**读取群信息** `im:chat:readonly`（或 `im:chat`）。未开通/查询失败 → 群管理员维度 **fail-closed 拒绝**，但**发起人本人不依赖该 API，任意会话仍可停止**。
- 单聊无需该权限：会话内只有发起人本人，点击即放行。

## 3. `.env.example`（实现期产出）

```dotenv
# Feishu
APP_ID=
APP_SECRET=
LARK_DOMAIN=https://open.feishu.cn

# LLM (OpenAI-compatible)
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=
LLM_MODEL=deepseek-chat
INTENT_MODEL=
INTENT_MIN_CONFIDENCE=0.5

# Local CLI
CLI_PROVIDER=claude
CLI_BIN=
CLI_TIMEOUT_MS=300000

# Bug fix / GitLab MR workflow
GITLAB_BASE_URL=
GITLAB_TOKEN=
GIT_DEFAULT_BASE_BRANCH=test
FIX_BRANCH_PREFIX=fix/

# Code-understanding (read source) access authorization (fail-closed: both empty => nobody may read).
# Group entries: chat_id (oc_...) or group name; person entries: open_id (ou_...) or email. Mixed OK.
CODE_READ_ALLOWED_CHATS_FILE=code-read-allowed-chats.json
CODE_READ_ALLOWED_CHATS=
CODE_READ_ALLOWLIST_FILE=code-read-allowlist.json
CODE_READ_ALLOWLIST=

# Dify (not wired yet)
DIFY_BASE_URL=
DIFY_API_KEY=

# Service
PORT=3000
SESSION_MAX_TURNS=10
LOG_LEVEL=info

# Projects (alias -> { path, default, gitlabProjectId, baseBranch })
PROJECTS_JSON={}
# Feishu open_id -> GitLab user
USER_MAP_JSON={}
```

> 启动时校验必填项缺失即**显式报错退出**（No hidden errors），不使用静默默认值兜过去。

# 容器化部署

本文档描述如何把 FeiShuBot 部署为一个常驻的 Docker 容器。配套文件：`Dockerfile`、`.dockerignore`、`docker-compose.yml`、`scripts/deploy.sh`（均在仓库根目录）。

## 1. 部署形态与约束

FeiShuBot **不是无状态服务**，不适合按 serverless / 自动扩缩容的方式部署，原因：

| 约束 | 说明 |
|------|------|
| 本地 CLI | `code_understanding` / `bug_fix` 意图会在容器内 `spawn` `claude`（Claude Code CLI），需要该 CLI 已装好且已鉴权（见 §4）。 |
| 本地仓库路径 | [项目注册表](configuration.md#2-项目注册表project-registry) `projects.json` 里配的是**绝对路径**，CLI 只能在这些目录内运行；Bug 修复还要 `git push` 到这些仓库的 `origin`。这些仓库必须作为卷挂进容器，且路径要与 `projects.json` 里写的容器内路径一致。 |
| SQLite 持久化 | 开启 `SESSION_PERSIST` 后数据落在单文件 `session.db`（含 `-wal`/`-shm`），需要挂持久卷，容器重建不能丢。 |
| 长连接 | 默认用飞书 `WSClient` 长连接收事件，**不需要公网入站端口**；`PORT` 仅在你自己要做 Webhook/健康检查时才用得上。 |
| 原生模块 | `better-sqlite3` 是 native addon，镜像需要在构建阶段有编译工具链（或使用其官方预编译包）。 |

结论：**单实例常驻容器**，配合持久卷（SQLite 数据、业务仓库、CLI 凭证），用 `restart: unless-stopped` 保活即可，不需要多副本/负载均衡。

## 2. 镜像内容（Dockerfile）

两阶段构建：

1. **builder**：`node:20-bookworm-slim` + `python3 make g++ git`，`yarn install` → `yarn build`（产出 `dist/`），再 `yarn install --production` 精简出运行期 `node_modules`（此时 `better-sqlite3` 已编译好，与运行阶段同镜像基座，可直接复制）。
2. **runtime**：同基座镜像，只装运行期需要的东西：
   - `git` + `openssh-client` + `ca-certificates`（Bug 修复要 fetch/push；`ca-certificates` 供 HTTPS 远程和 LLM/GitLab API 调用）。
   - 全局装 Claude Code CLI（`npm install -g @anthropic-ai/claude-code`，提供 `claude` 命令）。
   - 非 root 用户 `appuser`（`HOME=/home/appuser`），Claude CLI 的凭证、`git config`、SSH key 都落在这个 HOME 下。

选用 Debian（`bookworm-slim`）而非 Alpine：`better-sqlite3` 官方预编译产物面向 glibc，Alpine 的 musl 容易触发运行期编译失败。

## 3. 目录 / 卷映射

| 容器内路径 | 挂载来源（宿主机，示例） | 用途 |
|------------|--------------------------|------|
| `/app/data` | `./data`（命名卷或宿主目录） | `session.db` + `-wal`/`-shm`，SQLite 持久化 |
| `/app/worktrees` | `./worktrees` | Bug 修复用的 git worktree 临时目录（`WORKTREE_DIR`），需要足够磁盘空间 |
| `/app/projects.json` | `./projects.json`（只读） | 项目注册表；**容器内路径要用 `/repos/...`**，见下 |
| `/app/usermap.json` | `./usermap.json`（只读） | 飞书 open_id → GitLab 用户映射 |
| `/app/bugfix-allowlist.json` 等四份授权名单 | 对应同名文件（只读） | 见 [configuration.md §2.2/2.3](configuration.md#22-代码修改授权部门为主--人员白名单兜底强制校验) |
| `/repos/<alias>` | 宿主机上各业务仓库的本地 clone | `projects.json` 里每个别名的 `path` 必须指向这里，例如 `"path": "/repos/portal"` |
| `/home/appuser/.claude` | `./claude-home` | Claude Code CLI 的登录凭证/配置（持久化，见 §4） |
| `/home/appuser/.codex` | `./codex-home` | Codex CLI 的登录凭证（`auth.json`，设备码登录后持久化，见 §4） |
| `/home/appuser/.ssh` | 宿主机 `~/.ssh`（只读） | 若各仓库 `origin` 用 SSH 协议，需要挂 key 才能 `git push` 建 MR 分支 |

> Docker 有个坑：如果上表里某个「只读文件挂载」在宿主机上**不存在**，`docker compose up` 会把它当成目录创建一个空目录，导致容器里读取失败且报错含糊。**首次部署前务必先在宿主机上准备好这些文件**（可从对应的 `*.example.json` 复制），哪怕先留空处理，也要保证文件本身存在。

## 4. 凭证准备（部署前必须做完）

1. **Claude Code CLI 鉴权**：容器内以非交互方式跑 `claude -p ...`，不能走交互式 `claude login` 弹浏览器。**推荐用长期 OAuth token**（官方文档确认的方式，比挂凭证目录更省心）：
   - 在一台能登录的机器上执行 `claude setup-token`，走一次浏览器授权，会打印出一个**一年有效期**的 token（不会自动保存，要自己抄下来）；
   - 把这个 token 写进服务器的 `.env`：`CLAUDE_CODE_OAUTH_TOKEN=<token>`（`docker-compose.yml` 的 `env_file: .env` 会自动带进容器，无需额外挂载 `./claude-home`）；
   - 这个 token 走的是你的 **Claude 订阅**（Pro/Max/Team/Enterprise）额度，不额外按 token 计费；如果改用 `ANTHROPIC_API_KEY`，则会绕过订阅、按 Anthropic API 用量计费，二者认证优先级为：`ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN`。
   - 备选方案：仍可把交互登录生成的 `~/.claude/.credentials.json` 复制到宿主机 `./claude-home` 挂载进容器（`docker-compose.yml` 里已保留这个挂载），但官方更推荐 token 方式，跨机器不用管文件权限/格式。
   - 未鉴权时 CLI 调用会显式失败（符合 AGENTS.md「no hidden errors」），日志里能看到，不会假装成功。
2. **Codex CLI 鉴权（仅 `CLI_PROVIDER=codex` 时需要）**：镜像里也装了 `codex`，按计费方式二选一：
   - **ChatGPT 订阅额度（账户认证，设备码登录）**：容器起来后执行一次
     ```bash
     docker compose exec feishubot codex login --device-auth
     ```
     终端会打印链接 + 一次性验证码，在任何有浏览器的设备上打开链接、登录 ChatGPT 账号、输入验证码即完成。凭证落在容器内 `~/.codex/auth.json`，compose 已把它挂到宿主机 `./codex-home`，容器重建不用重登。也可直接把别处登录好的 `auth.json` 复制进 `./codex-home`——该文件等同密码，注意权限。
   - **API 计费**：`.env` 里设 **`CODEX_API_KEY`**（子进程继承），适合不想绑个人 ChatGPT 账号的场景，按 OpenAI API 用量计费。
3. **Git push 凭证**：`BugFixHandler` 依赖各仓库已配置好的 `origin` remote 去 `fetch`/`push`（[src/git/workspace.ts](../src/git/workspace.ts)），容器本身不额外处理认证：
   - SSH 协议 → 挂载只读的 `~/.ssh`（含私钥 + `known_hosts`），确保 `appuser` 能读。
   - HTTPS 协议 → remote URL 里带 token，或挂一份 `~/.git-credentials` + 打开 `credential.helper=store`。
4. **GitLab Token**：`.env` 里 `GITLAB_TOKEN` 需要 `api` 权限，用于建 MR、指派 reviewer。
5. **LLM / 飞书密钥**：`APP_ID`/`APP_SECRET`/`LLM_API_KEY` 等按 [configuration.md](configuration.md) 填入 `.env`。

## 5. 配置文件清单（部署前逐项确认）

在项目根目录（与 `docker-compose.yml` 同级）准备：

- `.env`（从 `.env.example` 复制并填真实值；**不要提交到 git**）
- `projects.json`（从 `projects.example.json` 复制；`path` 字段改成容器内 `/repos/<alias>`）
- `usermap.json`、`bugfix-allowlist.json`、`bugfix-allowed-departments.json`、`code-read-allowlist.json`、`code-read-allowed-chats.json`（各自的 `.example.json` 复制，按需填写；没有名单会 fail-closed 拒绝所有人，这是预期行为不是 bug）
- `.env` 里把以下两项改成容器内路径：
  ```
  SESSION_DB_FILE=/app/data/session.db
  WORKTREE_DIR=/app/worktrees
  ```
  （`docker-compose.yml` 里也用 `environment:` 覆盖了这两项，双重保险。）
- 宿主机上准备好 `./data`、`./worktrees`、`./claude-home` 目录，以及各业务仓库在 `/srv/feishubot/repos/<alias>`（或你自定的路径，需和 compose 里的挂载来源一致）下的本地 clone。

> 这些文件也可以在部署后通过**配置页面服务**（`config-ui`，同一 compose 里的第二个容器，默认 `http://127.0.0.1:8081`）在浏览器里编辑，见 [config-ui.md](config-ui.md)。首次部署仍需先把文件创建出来（哪怕内容是空模板），原因见上面的 bind mount 坑。

## 6. 构建与启动

```bash
# 首次：确认 §4/§5 的凭证与配置文件都已就绪
docker compose build
docker compose up -d
docker compose logs -f feishubot
```

或直接用 `scripts/deploy.sh`（封装了 pull + build + up + 打印最近日志）：

```bash
./scripts/deploy.sh
```

## 7. 验证

看日志确认：
- 长连接已建立（WSClient 启动无报错）；
- 若 `SESSION_PERSIST=true`，能看到 SQLite 初始化日志，且 `./data/session.db` 在宿主机上已生成；
- 用飞书测试群/单聊发一条消息，确认能收到占位卡片并正常流式更新。

## 8. 升级 / 回滚

```bash
git pull
docker compose build
docker compose up -d   # 滚动重建单容器；期间会短暂断开长连接，飞书重连后自动恢复
```

回滚：`git checkout <上一个 tag/commit>` 后重复上面的 build + up。SQLite 文件、`projects.json` 等挂载卷不受镜像版本影响。

## 9. 备份

只需备份挂载卷里的内容（都不在镜像里）：
- `./data/session.db*`（会话历史）
- `projects.json` / `usermap.json` / 各授权名单文件
- 各业务仓库若只在宿主机存一份，也要按你们现有的仓库备份策略处理

## 10. 常见问题

| 现象 | 根因 / 处理 |
|------|-------------|
| CLI 任务日志报「未登录」或鉴权失败 | Claude Code CLI 凭证没挂对，检查 `~/.claude` 挂载和 `HOME` 环境变量 |
| Bug 修复 `git push` 失败 `Permission denied (publickey)` | SSH key 没挂载 / 权限不对；或该仓库 remote 用的是 HTTPS 但没配 credential helper |
| 容器内 `projects.json` 报路径不存在 | `path` 字段没改成容器内路径（应为 `/repos/<alias>`），或对应仓库没挂载到 `/repos` |
| 挂载的 json 文件在容器里是空目录 | 宿主机上该文件本身不存在，Docker 把它当目录创建了；按 §5 清单逐项确认文件已存在 |
| `better-sqlite3` 运行时报 `invalid ELF header` 等 | builder/runtime 两阶段基座镜像架构不一致（如 build 用了 arm64 缓存、部署到 amd64），确保两阶段用同一 `--platform` |

# 配置页面服务（config-ui）

一个随 bot 一起部署的**辅助 Web 服务**，提供一个浏览器页面来查看/编辑部署所需的全部配置文件，代替登录服务器手改文件。实现在 [src/admin/](../src/admin/)，与主程序共用同一次 `tsc` 构建、同一个 Docker 镜像（compose 里用不同的 `command` 启动第二个容器）。

## 1. 定位与边界

- **只做一件事**：读写部署目录里的 8 个配置文件（见 §3），保存前做格式校验。
- **不做**：账号体系、热重载、操作 Docker。改完配置后由**人工重启 bot 容器**生效（页面上有提示）。
- **访问控制靠网络层**：服务本身无登录。compose 默认只绑定 `127.0.0.1:8081`，需要内网访问时自行改绑定地址并用防火墙/安全组限制来源 IP。**页面会明文展示 APP_SECRET、LLM_API_KEY、GITLAB_TOKEN 等密钥，严禁暴露到公网。**

## 2. 部署形态

`docker-compose.yml` 中的 `config-ui` service：

- `image` 复用 `feishubot:latest`，`command: node dist/admin/server.js`；
- 挂载**部署目录本身**（`./`）到容器内 `/config`（读写）——bot 容器对各 json 文件是按**单文件只读**挂载的，两边看到的是同一批宿主机文件；
- 环境变量：`CONFIG_DIR`（默认 `/config`）、`ADMIN_PORT`（默认 `8081`）。

### 写文件方式（重要约束）

保存时**原地覆写**（`O_TRUNC`，不换 inode），**不允许**用「写临时文件再 rename」的原子写法：bot 容器是按单文件 bind mount 挂载这些 json 的，rename 会换 inode，导致 bot 容器里的挂载点仍指向旧文件。

## 3. 管理的文件与校验规则

| 文件 | 校验 |
|------|------|
| `IDENTITY.md` | 顶部 YAML frontmatter（`---` 包裹）须含非空 `name` 与 `description`（与运行时 `src/config/identity.ts` 同一套解析） |
| `.env` | 每个非空、非 `#` 注释行必须形如 `KEY=...`（`KEY` 匹配 `[A-Za-z_][A-Za-z0-9_]*`） |
| `projects.json` | JSON 对象；每个值须含非空字符串 `path`；可选 `default`(boolean) / `gitlabProjectId`(string) / `baseBranch`(string)；**最多一个 `default: true`**（多个会导致取第一个的隐式行为，直接拒绝） |
| `usermap.json` | JSON 对象；每个值须含 `gitlabUserId`(整数) 与 `gitlabUsername`(非空字符串) |
| `bugfix-allowlist.json` | 非空字符串数组 |
| `bugfix-allowed-departments.json` | 同上 |
| `code-read-allowlist.json` | 同上 |
| `code-read-allowed-chats.json` | 同上 |

校验失败 → HTTP 400 + 具体错误信息，**不写文件**（no hidden errors）。文件名白名单固定在代码里，不接受任意路径（无目录穿越面）。

## 4. HTTP 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 配置页面（单页 HTML，无外部资源） |
| GET | `/api/files` | 全部受管文件的 `{ name, exists, content }` 列表 |
| PUT | `/api/files/<name>` | 校验并保存；body 为文件新内容（text/plain） |

## 5. 生效方式

保存只改宿主机上的文件，bot 是启动时一次性读配置，因此改完必须重建 bot 容器：

```bash
docker compose up -d --force-recreate feishubot
```

> 注意不能用 `docker compose restart`：`restart` 复用原容器定义，**不会重新读 `env_file`**，`.env` 的改动不会生效；json 文件的改动用 restart 虽然可以，但统一用上面这条命令不会错。

## 6. 测试

纯校验逻辑在 [src/admin/validate.ts](../src/admin/validate.ts)，测试见 `tests/admin/validate.test.ts`（vitest）。HTTP 层薄封装不单测，靠部署后页面自验。

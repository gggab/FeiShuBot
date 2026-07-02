# FeiShuBot 开发文档

> 本目录是项目的**唯一事实来源（source of truth）**。任何需求、设计、行为变更都必须先更新这里，再改代码与测试。

## 1. 这是什么

FeiShuBot 是一个飞书（Feishu / Lark）机器人应用。它接收用户在飞书中发送的消息，先做**意图识别**，再按意图路由到不同的处理器（Handler）作答。

支持的意图类别：

| # | 意图 key | 含义 | 实现方式 |
|---|----------|------|----------|
| 1 | `code_understanding` | 理解项目代码、查看功能实现逻辑与细节 | 调用本地 Claude Code CLI 或 Codex(ChatGPT) CLI 阅读项目代码 |
| 2 | `bug_fix` | 修改项目 bug | 调用本地 Claude Code CLI 或 Codex(ChatGPT) CLI 完成 |
| 3 | `knowledge_qa` | 知识问答（使用说明、特殊情况、配置说明等文档型问题） | 预留本地 Dify API（**暂不做技术实现**）；涉及实现细节时可选叠加源码阅读 |
| 4 | `chat` | 普通聊天 | 直接调用大模型 |

意图识别层与普通聊天层使用同一类大模型：**DeepSeek / 通义千问(Qwen) / 智谱(GLM)**，通过 OpenAI 兼容接口接入，可配置切换。

## 2. 当前阶段

**设计阶段**：本次只产出设计与开发文档，不写实现代码。文档定稿后，再按 [development-plan.md](development-plan.md) 的里程碑分步实现（先写测试，再实现）。

## 3. 文档导航

| 文档 | 内容 |
|------|------|
| [architecture.md](architecture.md) | 总体架构、模块划分、数据流、时序图、目录结构、技术栈 |
| [intent-recognition.md](intent-recognition.md) | 意图识别设计：类别定义、分类提示词、输出 schema、置信度与兜底策略 |
| [handlers.md](handlers.md) | 四个 Handler 的设计；CLI Runner 抽象；Dify 知识问答占位设计 |
| [feishu-integration.md](feishu-integration.md) | 飞书接入细节：长连接事件、消息卡片流式更新、配置与权限 |
| [session-persistence.md](session-persistence.md) | 会话上下文持久化：SQLite 单文件、按 chatId 存储、保留策略 |
| [configuration.md](configuration.md) | 环境变量、项目注册表、模型 Provider 配置 |
| [deployment.md](deployment.md) | 容器化部署：Dockerfile、卷映射、凭证准备、部署脚本 |
| [config-ui.md](config-ui.md) | 配置页面服务：浏览器里编辑 .env / projects.json 等部署配置 |
| [development-plan.md](development-plan.md) | 实现里程碑、测试策略、与 AGENTS.md 工作流的对应 |

## 4. 快速开始（实现完成后）

```bash
yarn install
# 配置 .env（见 configuration.md）
yarn dev          # 启动长连接，开始接收飞书消息
yarn type-check
yarn build
```

> 参考来源：`../lark-samples-main` 中的 `mcp_larkbot_demo`（AI agent + 飞书卡片流式）、`echo_bot`（最小事件接入）、`card_interaction_bot`（卡片与回调）。

## 5. 术语表

- **意图识别（Intent Recognition）**：用大模型把一条用户消息归类到上表四个 key 之一，并抽取必要参数（目标项目、任务描述等）。
- **Handler**：处理某一类意图的模块，输入归一化后的任务，产出回复（可流式）。
- **CLI Runner**：对本地 `claude` / `codex` 命令行的统一封装，负责在目标项目目录下执行、流式回传 stdout、超时与取消。
- **项目注册表（Project Registry）**：项目别名 → 本地绝对路径的映射，CLI 只能在注册过的目录内执行（安全边界）。
- **流式卡片**：飞书可更新的交互卡片，用 `im.message.patch` 节流更新，实现"边生成边显示"。

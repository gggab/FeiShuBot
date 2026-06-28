# 意图识别设计

## 1. 目标

把一条飞书用户消息归类到四个意图之一，并抽取后续处理所需的参数（目标项目、归一化任务描述等）。识别由大模型完成（DeepSeek / Qwen / GLM，OpenAI 兼容接口）。

## 2. 意图类别

| key | 触发场景 | 典型用户表述 | 路由去向 |
|-----|----------|--------------|----------|
| `code_understanding` | 想了解某功能怎么实现、代码逻辑、调用关系、某文件作用 | "登录鉴权是怎么实现的？""看下 OrderService 的下单流程" | CLI Runner（只读阅读） |
| `bug_fix` | 报告/要求修复某个 bug | "X 页面点击报错，帮我修""这个空指针修一下" | CLI Runner（可改码，受确认策略约束） |
| `knowledge_qa` | 文档型问题：使用说明、配置项、特殊情况、注意事项 | "这个服务怎么部署？""灰度开关配置在哪？" | Dify（占位）/ 可叠加源码阅读 |
| `chat` | 与项目无关的闲聊、寒暄、通用问答 | "你好""今天写代码累了" | LLM 直接回复 |

边界约定（写进提示词，减少歧义）：
- 问「**怎么实现/逻辑/源码**」→ `code_understanding`（需要读代码）。
- 问「**怎么用/配置/说明/为什么这样设计**」且偏文档 → `knowledge_qa`。
- 同时涉及「文档说明」与「实现细节」时，优先 `knowledge_qa`，由该 Handler 决定是否叠加一次源码阅读（见 [handlers.md](handlers.md)）。
- 出现明确「报错 / 修复 / 修一下 / 不工作」→ `bug_fix`。

## 3. 输出 Schema

识别器返回结构化结果 `IntentResult`：

```ts
interface IntentResult {
  intent: 'code_understanding' | 'bug_fix' | 'knowledge_qa' | 'chat';
  confidence: number;          // 0..1
  project?: string;            // 命中的项目别名（须在 Project Registry 中），可空
  task: string;                // 归一化后的、给 Handler 用的任务描述
  reason?: string;             // 分类依据（便于日志与调试）
}
```

约束：
- `project` 必须是项目注册表中存在的别名；模型给出未知别名时视为 `undefined`，由 Handler 决定追问或使用默认项目。
- `task` 是对原始消息的清洗/补全（去寒暄、补主语），便于下游 prompt。

## 4. 分类提示词（草案）

System prompt 要点：
- 说明四个类别与边界规则（同上）。
- 给出当前**可用项目别名列表**（来自 Project Registry），让模型只在已知别名里选。
- 给出最近 N 轮对话上下文（用于指代消解，如「它」「那个文件」）。
- **强制 JSON 输出**：优先用 provider 的 `response_format: json_object`；不支持时在提示词中要求「只输出 JSON，不要解释」，并在解析失败时按兜底策略处理（见 §6）。

提示词骨架（伪）：

```
你是一个意图分类器。把用户最后一条消息归类为以下之一：
- code_understanding：需要阅读源码来回答实现逻辑/细节。
- bug_fix：用户报告或要求修复缺陷。
- knowledge_qa：使用说明/配置/特殊情况等文档型问题。
- chat：与项目无关的闲聊或通用问答。
可用项目别名：{{projectAliases}}
规则：{{边界规则}}
只输出 JSON：{ "intent": ..., "confidence": 0~1, "project": 可空, "task": "...", "reason": "..." }
对话上下文：{{recentTurns}}
用户消息：{{message}}
```

> 提示词与边界规则的最终文案随实现确定，但**任何改动都要回写本节**（docs 为事实来源）。

## 5. 置信度与阈值

- `INTENT_MIN_CONFIDENCE`（默认 0.5，可配）。
- `confidence >= 阈值`：按 `intent` 路由。
- `confidence < 阈值`：**显式降级**为 `chat`，并在回复里温和提示「不确定你的意图，先按聊天回答；如需看代码/修 bug 请说明项目与具体诉求」。这是唯一允许的降级，且对用户可见——不静默假装。

## 6. 失败兜底（显式，不隐藏错误）

| 失败点 | 处理 |
|--------|------|
| LLM 调用异常（网络/鉴权） | 不路由；回复「意图识别服务暂不可用」并记录错误日志。**不** silently 当成 chat。 |
| 返回非法 JSON / 解析失败 | 重试一次；仍失败则按「低置信度」降级为 `chat` 并提示。 |
| `intent` 不在枚举内 | 视为解析失败，同上。 |

## 7. 可测试点（供 development-plan 的测试阶段）

- 给定一组标注样本（每类 ≥5 条），分类命中率达标。
- 指代消解：依赖上下文的样本（「它怎么实现的」）能带出正确 `project`。
- 边界样本：实现细节 vs 文档说明 的区分符合 §2 规则。
- 低置信度样本 → 降级为 `chat` 且带提示。
- LLM 异常被 mock 时，走 §6 的显式兜底而非吞错。
- 强制 JSON：非 JSON 输出触发重试与降级。

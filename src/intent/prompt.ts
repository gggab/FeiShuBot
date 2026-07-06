/**
 * 意图分类提示词。设计对齐 docs/intent-recognition.md §4。
 * Prompts for intent classification.
 */

import { ChatTurn } from '../session/context';

export function buildIntentSystemPrompt(projectAliases: string[]): string {
  const aliasText = projectAliases.length ? projectAliases.join('、') : '（暂无注册项目）';
  return [
    '你是一个意图分类器。把用户的最后一条消息归类为以下四类之一：',
    '- code_understanding：需要阅读项目源码才能回答的实现逻辑/细节问题。',
    '- bug_fix：用户报告缺陷或要求修复程序问题。',
    '- knowledge_qa：文档型问题（使用说明、配置项、部署、特殊情况、设计原因）。',
    '- chat：与项目无关的闲聊、寒暄或通用问答。',
    '判定规则：',
    '- 问“怎么实现/逻辑/源码/某函数作用” → code_understanding。',
    '- 问“怎么用/如何配置/使用说明/为什么这样设计”且偏文档 → knowledge_qa。',
    '- 同时涉及文档说明与实现细节 → 优先 knowledge_qa。',
    '- 出现“报错/异常/修一下/修复/不工作/崩溃” → bug_fix。',
    `可用项目别名（project 字段只能从中选择，否则省略该字段）：${aliasText}`,
    '严格只输出一个 JSON 对象，不要任何解释或代码块，格式：',
    '{"intent":"四类之一","confidence":0到1的数字,"project":"项目别名(可省略)","task":"对用户诉求的简洁归一化描述（必须与用户消息使用相同的语言）","reason":"简短分类依据"}',
  ].join('\n');
}

export function buildIntentUserPrompt(text: string, history?: ChatTurn[]): string {
  const lines: string[] = [];
  if (history && history.length > 0) {
    lines.push('最近对话（用于理解“它/那个”等指代，仅供参考）：');
    for (const turn of history.slice(-4)) {
      lines.push(`${turn.role === 'user' ? '用户' : '助手'}: ${turn.content}`);
    }
    lines.push('');
  }
  lines.push(`用户消息：${text}`);
  return lines.join('\n');
}

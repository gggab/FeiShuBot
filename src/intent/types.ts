/**
 * 意图识别结果类型。设计对齐 docs/intent-recognition.md §3。
 * Intent recognition result types.
 */

export type IntentKind = 'code_understanding' | 'bug_fix' | 'knowledge_qa' | 'chat';

export interface IntentResult {
  /** 归类结果 / Classified intent. */
  intent: IntentKind;
  /** 置信度 0..1；低于阈值显式降级为 chat / Confidence in [0,1]. */
  confidence: number;
  /** 命中的项目别名（须在 Project Registry 中），可空 / Resolved project alias. */
  project?: string;
  /** 归一化后的任务描述，供下游 Handler 使用 / Normalized task for handlers. */
  task: string;
  /** 分类依据，便于日志与调试 / Reason for the classification. */
  reason?: string;
}

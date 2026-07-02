/**
 * 消息编排控制器。
 * Message orchestration controller.
 *
 * M3：特殊命令(/clear) → 每用户单任务守卫 → 意图识别 → Handler 路由。
 * 设计对齐 docs/architecture.md §3。
 */

import { IncomingMessage } from '../feishu/message';
import { sendText, CardReplyStream } from '../feishu/reply';
import { getSession } from '../session/context';
import { listProjectAliases } from '../config/projects';
import { HandlerContext } from '../handlers/types';
import { HandlerRegistry } from '../handlers/registry';
import { GitCommandHandler } from '../handlers/git-command';
import { IntentRecognizer, IntentServiceError } from '../intent/recognizer';
import { logger } from '../util/logger';

const DEGRADE_NOTICE =
  '⚠️ 不太确定你的意图，先按普通聊天回答；如需「代码理解」或「修复 Bug」，请说明项目与具体诉求。';

/** 截断长文本用于日志。 */
function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

export class MessageController {
  /** 每用户单任务，防止对同一张卡片并发写入。 */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly recognizer: IntentRecognizer,
    private readonly registry: HandlerRegistry,
    private readonly gitCommand: GitCommandHandler | null = null
  ) {}

  async handle(msg: IncomingMessage): Promise<void> {
    if (!msg.chatId) {
      logger.warn('[消息] 缺少 chatId，忽略');
      return;
    }
    if (!msg.supported) {
      logger.info(`[消息] 非文本消息 type=${msg.messageType}，提示用户发文本`);
      await sendText(msg.chatId, '暂仅支持文本消息 / Please send a text message.');
      return;
    }
    const text = msg.text;
    if (!text) return;

    const session = getSession(msg.chatId);
    logger.info(
      `[消息] from=${msg.userId} chat=${msg.chatId} text="${truncate(text)}" (历史 ${session.getHistory().length} 条)`
    );

    if (text.startsWith('/clear')) {
      session.clear();
      logger.info(`[命令] /clear → 已清空会话 ${msg.chatId} 的上下文`);
      await sendText(msg.chatId, '已清空上下文 / Context cleared.');
      return;
    }

    if (this.inFlight.has(msg.userId)) {
      logger.info(`[守卫] ${msg.userId} 上一条仍在处理，拒绝并发`);
      await sendText(msg.chatId, '正在处理上一条消息，请稍候 / Previous message still in progress.');
      return;
    }

    this.inFlight.add(msg.userId);
    const startedAt = Date.now();
    try {
      // 0. Git 运维命令（/git ...）：命令前缀直达，不走意图识别。
      if (this.gitCommand && this.gitCommand.matches(text)) {
        logger.info(`[命令] /git → 交由 GitCommandHandler`);
        await this.gitCommand.run(msg.userId, msg.chatId, text);
        return;
      }

      // 1. 意图识别（LLM 调用失败 → 显式提示，不静默当聊天）。
      logger.info('[意图] 识别中…');
      let outcome;
      try {
        outcome = await this.recognizer.recognize({
          text,
          projectAliases: listProjectAliases(),
          history: session.getHistory(),
        });
      } catch (e) {
        if (e instanceof IntentServiceError) {
          logger.error('[意图] 服务不可用:', e);
          await sendText(msg.chatId, '意图识别服务暂不可用，请稍后重试 / Intent service unavailable.');
          return;
        }
        throw e;
      }

      logger.info(
        `[意图] → ${outcome.intent.intent} conf=${outcome.intent.confidence}` +
          `${outcome.intent.project ? ` project=${outcome.intent.project}` : ''}` +
          `${outcome.degraded ? ` (降级:${outcome.degradeReason})` : ''} task="${truncate(outcome.intent.task)}"`
      );
      if (outcome.intent.reason) {
        logger.debug(`[意图] 依据: ${outcome.intent.reason}`);
      }

      // 2. 低置信度/解析失败 → 已被降级为 chat，向用户显式说明。
      if (outcome.degraded) {
        logger.info('[意图] 置信度不足，已降级为 chat 并提示用户');
        await sendText(msg.chatId, DEGRADE_NOTICE);
      }

      // 3. 路由到对应 Handler，流式回卡片。
      logger.info(`[路由] → ${outcome.intent.intent} handler`);
      const reply = new CardReplyStream(msg.chatId);
      await reply.init();
      const ctx: HandlerContext = {
        userId: msg.userId,
        chatId: msg.chatId,
        intent: outcome.intent,
        session,
        reply,
      };
      await this.registry.get(outcome.intent.intent).handle(ctx);
      logger.info(`[完成] intent=${outcome.intent.intent} 耗时=${Date.now() - startedAt}ms`);
    } finally {
      this.inFlight.delete(msg.userId);
    }
  }
}

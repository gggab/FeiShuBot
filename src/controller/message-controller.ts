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
import { TaskRegistry } from './task-registry';
import { ChatAdminService } from '../feishu/chat-admin';
import { StopResult } from '../feishu/dispatcher';
import { ConversationQueue } from '../util/conversation-queue';
import { detectLang, pick } from '../util/lang';
import { logger } from '../util/logger';

const DEGRADE_NOTICE_ZH =
  '⚠️ 不太确定你的意图，先按普通聊天回答；如需「代码理解」或「修复 Bug」，请说明项目与具体诉求。';
const DEGRADE_NOTICE_EN =
  '⚠️ Not sure what you intended; answering as regular chat. For code understanding or bug fixing, please name the project and describe the request.';

/** 截断长文本用于日志。 */
function truncate(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

export class MessageController {
  /**
   * 每会话串行队列：key=`${userId}:${chatId}`。忙时排队（不丢弃）、逐条处理；
   * 同一人不同会话互不阻塞；排队中的消息可被撤回移除（recall）。
   */
  private readonly queue = new ConversationQueue();
  /** 运行中任务登记表：供卡片「停止回复」按钮按 taskId 取消。 */
  private readonly tasks = new TaskRegistry();

  constructor(
    private readonly recognizer: IntentRecognizer,
    private readonly registry: HandlerRegistry,
    private readonly gitCommand: GitCommandHandler | null = null,
    private readonly chatAdmin: ChatAdminService | null = null
  ) {}

  /**
   * 停止指定任务（卡片「停止回复」按钮回调触发），带权限判断：
   * 发起人本人任意会话可停；群聊里群主/群管理员亦可停；其余拒绝。
   * 群管理员判断需查群信息，查询失败按拒绝处理（fail-closed），但不影响发起人本人。
   */
  async stop(taskId: string, operatorId: string): Promise<StopResult> {
    const meta = this.tasks.get(taskId);
    if (!meta) {
      logger.info(`[停止] taskId=${taskId} → 任务不存在（可能已结束）`);
      return 'not_found';
    }

    const allowed = await this.canStop(meta.userId, meta.chatId, meta.chatType, operatorId);
    if (!allowed) {
      logger.info(`[停止] 拒绝 taskId=${taskId} operator=${operatorId}（非发起人/群管理员）`);
      return 'forbidden';
    }

    // 通过鉴权后任务可能刚好结束并被注销；abort 返回 false 即视为已结束。
    const ok = this.tasks.abort(taskId);
    logger.info(`[停止] taskId=${taskId} operator=${operatorId} → ${ok ? '已请求中止' : '任务已结束'}`);
    return ok ? 'stopped' : 'not_found';
  }

  /** 发起人本人始终可停；群聊再放行群主/群管理员；单聊仅发起人（即本人）。 */
  private async canStop(
    ownerUserId: string,
    chatId: string,
    chatType: string,
    operatorId: string
  ): Promise<boolean> {
    if (operatorId === ownerUserId) return true;
    if (chatType !== 'group' || !this.chatAdmin) return false;
    try {
      return await this.chatAdmin.isOwnerOrManager(chatId, operatorId);
    } catch (e) {
      logger.warn(`[停止] 群管理员校验失败(按拒绝处理) chat=${chatId}: ${(e as Error).message}`);
      return false;
    }
  }

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

    // 每会话串行：忙则排队（不丢弃）、逐条处理。key 含 chatId → 同一人不同会话并行、
    // 同一会话内严格 FIFO。排队消息可被撤回（recall）从队列移除。
    const key = `${msg.userId}:${msg.chatId}`;
    const { rejected, ahead } = this.queue.enqueue({
      key,
      messageId: msg.messageId,
      run: () => this.process(msg),
      // 撤回时若这条还在排队，移除后给一条可见反馈（排队提示会因此显得已作废）。
      onCancelled: () => {
        void sendText(
          msg.chatId,
          '🚫 已撤回：排队中的这条消息已取消，不会处理 / Cancelled a queued message (recalled).'
        ).catch((e) => logger.error('[撤回] 发送取消提示失败:', e));
      },
    });
    if (rejected) {
      logger.info(`[队列] ${key} 排队已满，拒绝 message_id=${msg.messageId}`);
      await sendText(msg.chatId, '排队消息过多，请稍后再发 / Too many queued messages, please retry later.');
      return;
    }
    if (ahead > 0) {
      logger.info(`[队列] ${key} 忙，排队 message_id=${msg.messageId}（前方 ${ahead} 条）`);
      await sendText(msg.chatId, `已排队，前面还有 ${ahead} 条，完成后自动处理 / Queued: ${ahead} ahead.`);
    }
  }

  /**
   * 用户撤回消息：若该消息还在排队（未开始处理）则从队列移除，永不执行；
   * 已在处理中的任务不受影响（可用卡片「停止回复」中止）。
   */
  recall(messageId: string): void {
    const removed = this.queue.cancel(messageId);
    logger.info(
      `[撤回] message_id=${messageId} → ${removed ? '已从排队队列移除' : '不在排队中（已处理/正在处理/非本机器人任务）'}`
    );
  }

  /**
   * 单条消息的实际处理流水线（在会话串行队列中被逐条调用）：
   * Git 运维命令 → 意图识别 → Handler 路由，流式回卡片。
   */
  private async process(msg: IncomingMessage): Promise<void> {
    const text = msg.text;
    const session = getSession(msg.chatId);
    const startedAt = Date.now();

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
      await sendText(msg.chatId, pick(detectLang(text), DEGRADE_NOTICE_ZH, DEGRADE_NOTICE_EN));
    }

    // 3. 路由到对应 Handler，流式回卡片。登记可取消任务，卡片带「停止回复」按钮。
    logger.info(`[路由] → ${outcome.intent.intent} handler`);
    const { taskId, signal } = this.tasks.create({
      userId: msg.userId,
      chatId: msg.chatId,
      chatType: msg.chatType,
    });
    const reply = new CardReplyStream(msg.chatId, { taskId, signal, lang: detectLang(text) });
    await reply.init();
    const ctx: HandlerContext = {
      userId: msg.userId,
      chatId: msg.chatId,
      text,
      intent: outcome.intent,
      session,
      reply,
      signal,
    };
    try {
      await this.registry.get(outcome.intent.intent).handle(ctx);
    } finally {
      this.tasks.remove(taskId);
    }
    logger.info(`[完成] intent=${outcome.intent.intent} 耗时=${Date.now() - startedAt}ms`);
  }
}

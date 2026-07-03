/**
 * 飞书事件分发器：注册 im.message.receive_v1 与 card.action.trigger。
 * Feishu event dispatcher.
 * 设计对齐 docs/feishu-integration.md §2 / §3.2。
 *
 * 两点关键处理（修复重复回复问题）：
 * 1. 立即返回，让 SDK 尽快 ack；实际处理异步进行，避免飞书因等待超时而重推事件。
 * 2. 按 message_id 去重，保证同一条消息（含重推）只处理一次。
 *
 * 卡片交互：card.action.trigger 携带按钮 value，解析出「停止」动作后中止对应任务。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { parseIncoming, IncomingMessage } from './message';
import { Deduplicator } from './dedup';
import { STOP_ACTION } from './card';
import { logger } from '../util/logger';

export type OnMessage = (msg: IncomingMessage) => Promise<void>;
/** 停止结果：已停止 / 任务不存在 / 无权限。 */
export type StopResult = 'stopped' | 'not_found' | 'forbidden';
/** 停止回调：由点击者对指定任务发起停止，返回鉴权后的结果。 */
export type OnStop = (taskId: string, operatorId: string) => Promise<StopResult>;

/** 解析出的停止动作：任务标识 + 点击者 open_id。 */
export interface StopAction {
  action: 'stop';
  taskId: string;
  operatorId: string;
}

/** 从事件里取点击者 open_id，兼容 `operator.open_id` 与 `operator.operator_id.open_id`。 */
function extractOperatorId(data: unknown): string {
  const operator = (data as { operator?: unknown } | undefined)?.operator as
    | { open_id?: unknown; operator_id?: { open_id?: unknown } }
    | undefined;
  const id = operator?.open_id ?? operator?.operator_id?.open_id;
  return typeof id === 'string' ? id : '';
}

/**
 * 从 card.action.trigger 事件里解析出「停止」动作（纯函数，便于测试）。
 * `action.value` 正常是对象；部分场景飞书会回传其 JSON 字符串，一并容忍。
 */
export function parseCardAction(data: unknown): StopAction | null {
  let value = (data as { action?: { value?: unknown } } | undefined)?.action?.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object') {
    const v = value as { action?: unknown; taskId?: unknown };
    if (v.action === STOP_ACTION && typeof v.taskId === 'string' && v.taskId !== '') {
      return { action: 'stop', taskId: v.taskId, operatorId: extractOperatorId(data) };
    }
  }
  return null;
}

/** 三种停止结果对应的 toast 反馈。 */
const STOP_TOAST: Record<StopResult, { type: string; content: string }> = {
  stopped: { type: 'info', content: '已停止 / Stopping…' },
  not_found: { type: 'warning', content: '任务已结束 / Task already finished.' },
  forbidden: { type: 'error', content: '仅发起人或群管理员可停止 / Only the requester or a group admin can stop.' },
};

export function buildDispatcher(onMessage: OnMessage, onStop?: OnStop): Lark.EventDispatcher {
  const dedup = new Deduplicator();

  return new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': (data) => {
      const msg = parseIncoming(data);

      logger.info(
        `[事件] im.message.receive_v1 message_id=${msg.messageId} type=${msg.messageType} ` +
          `chat_type=${msg.chatType} from=${msg.userId}`
      );

      // 去重：同一 message_id 的重复推送直接忽略。
      if (dedup.isDuplicate(msg.messageId)) {
        logger.info(`[事件] 忽略重复推送 message_id=${msg.messageId}`);
        return;
      }

      // 异步处理，不阻塞事件 ack；单条失败不影响长连接监听。
      void onMessage(msg).catch((e) => logger.error('处理消息失败:', e));
    },

    // 卡片按钮回调：目前仅处理「停止回复」。鉴权后返回 toast 即时反馈。
    'card.action.trigger': async (data: unknown) => {
      const parsed = parseCardAction(data);
      if (!parsed) {
        logger.warn('[事件] card.action.trigger 无法识别的动作，忽略');
        return {};
      }
      const result: StopResult = onStop ? await onStop(parsed.taskId, parsed.operatorId) : 'not_found';
      logger.info(
        `[事件] card.action.trigger stop taskId=${parsed.taskId} operator=${parsed.operatorId} → ${result}`
      );
      return { toast: STOP_TOAST[result] };
    },
  });
}

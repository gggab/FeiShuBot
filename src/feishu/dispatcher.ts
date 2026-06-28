/**
 * 飞书事件分发器：注册 im.message.receive_v1，归一化后交给回调。
 * Feishu event dispatcher for im.message.receive_v1.
 * 设计对齐 docs/feishu-integration.md §2。
 *
 * 两点关键处理（修复重复回复问题）：
 * 1. 立即返回，让 SDK 尽快 ack；实际处理异步进行，避免飞书因等待超时而重推事件。
 * 2. 按 message_id 去重，保证同一条消息（含重推）只处理一次。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { parseIncoming, IncomingMessage } from './message';
import { Deduplicator } from './dedup';
import { logger } from '../util/logger';

export type OnMessage = (msg: IncomingMessage) => Promise<void>;

export function buildDispatcher(onMessage: OnMessage): Lark.EventDispatcher {
  const dedup = new Deduplicator();

  return new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': (data) => {
      const msg = parseIncoming(data);

      // 去重：同一 message_id 的重复推送直接忽略。
      if (dedup.isDuplicate(msg.messageId)) {
        logger.debug(`忽略重复事件 message_id=${msg.messageId}`);
        return;
      }

      // 异步处理，不阻塞事件 ack；单条失败不影响长连接监听。
      void onMessage(msg).catch((e) => logger.error('处理消息失败:', e));
    },
  });
}

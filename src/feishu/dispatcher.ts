/**
 * 飞书事件分发器：注册 im.message.receive_v1，归一化后交给回调。
 * Feishu event dispatcher for im.message.receive_v1.
 * 设计对齐 docs/feishu-integration.md §2。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { parseIncoming, IncomingMessage } from './message';
import { logger } from '../util/logger';

export type OnMessage = (msg: IncomingMessage) => Promise<void>;

export function buildDispatcher(onMessage: OnMessage): Lark.EventDispatcher {
  return new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try {
        await onMessage(parseIncoming(data));
      } catch (e) {
        // 单条消息处理失败不应中断长连接监听；显式记录错误。
        logger.error('处理消息失败:', e);
      }
    },
  });
}

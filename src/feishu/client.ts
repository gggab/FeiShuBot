/**
 * 飞书客户端单例：Client（调 OpenAPI）+ WSClient（长连接收事件）。
 * Lark Client (OpenAPI) and WSClient (long-connection events) singletons.
 * 设计对齐 docs/feishu-integration.md §1。
 *
 * 缺少 APP_ID / APP_SECRET 时在此**显式抛错**（No hidden errors）。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { assertRequired, config } from '../config';

assertRequired([
  ['APP_ID', config.feishu.appId],
  ['APP_SECRET', config.feishu.appSecret],
]);

const baseConfig = {
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  domain: config.feishu.domain,
};

export const larkClient = new Lark.Client(baseConfig);
export const larkWsClient = new Lark.WSClient(baseConfig);

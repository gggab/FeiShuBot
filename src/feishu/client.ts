/**
 * 飞书客户端单例：Client（调 OpenAPI）+ WSClient（长连接收事件）。
 * Lark Client (OpenAPI) and WSClient (long-connection events) singletons.
 * 设计对齐 docs/feishu-integration.md §1。
 *
 * 核心必填（APP_ID/APP_SECRET）的校验集中在启动入口 app.ts（缺失即 exit(1)），
 * 不在此做 import 期副作用抛错，避免难看的栈与拖到导入时机。
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { config } from '../config';

const baseConfig = {
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  domain: config.feishu.domain,
};

export const larkClient = new Lark.Client(baseConfig);
export const larkWsClient = new Lark.WSClient(baseConfig);

/**
 * 应用入口。
 * Application entry point.
 *
 * M1：启动飞书长连接，收 im.message.receive_v1 并原样回声。
 * 事件路由（意图识别）将在 M3 接入，见 docs/development-plan.md。
 */

import { config } from './config';
import { listProjectAliases } from './config/projects';
import { logger } from './util/logger';
import { larkWsClient } from './feishu/client';
import { buildDispatcher } from './feishu/dispatcher';
import { MessageController } from './controller/message-controller';

function main(): void {
  logger.info('FeiShuBot starting (M1 echo)');
  logger.info(`Feishu domain : ${config.feishu.domain}`);
  logger.info(`LLM provider  : ${config.llm.provider} (model: ${config.llm.model || 'unset'})`);
  logger.info(`CLI provider  : ${config.cli.provider}`);
  const aliases = listProjectAliases();
  logger.info(`Projects      : ${aliases.length ? aliases.join(', ') : '(none registered)'}`);

  const controller = new MessageController();
  const dispatcher = buildDispatcher((msg) => controller.handle(msg));

  larkWsClient.start({ eventDispatcher: dispatcher });
  logger.info('已启动飞书长连接，等待消息…（Ctrl+C 退出）');
}

main();

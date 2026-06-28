/**
 * 应用入口。
 * Application entry point.
 *
 * M2：启动飞书长连接，所有文本消息走流式聊天回复（/clear 清空上下文）。
 * 意图识别 + 路由将在 M3 接入，见 docs/development-plan.md。
 */

import { config } from './config';
import { listProjectAliases } from './config/projects';
import { logger } from './util/logger';
import { larkWsClient } from './feishu/client';
import { buildDispatcher } from './feishu/dispatcher';
import { MessageController } from './controller/message-controller';
import { createLlmClient } from './llm/provider';
import { ChatHandler } from './handlers/chat';

function main(): void {
  logger.info('FeiShuBot starting (M2 chat)');
  logger.info(`Feishu domain : ${config.feishu.domain}`);
  logger.info(`LLM provider  : ${config.llm.provider} (model: ${config.llm.model || 'unset'})`);
  logger.info(`CLI provider  : ${config.cli.provider}`);
  const aliases = listProjectAliases();
  logger.info(`Projects      : ${aliases.length ? aliases.join(', ') : '(none registered)'}`);

  const llm = createLlmClient();
  const controller = new MessageController(new ChatHandler(llm));
  const dispatcher = buildDispatcher((msg) => controller.handle(msg));

  larkWsClient.start({ eventDispatcher: dispatcher });
  logger.info('已启动飞书长连接，等待消息…（Ctrl+C 退出）');
}

main();

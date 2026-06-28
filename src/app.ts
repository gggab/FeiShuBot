/**
 * 应用入口。
 * Application entry point.
 *
 * M0：仅装载配置并打印启动信息，验证脚手架可运行。
 * 事件循环（飞书长连接）将在 M1 接入，见 docs/development-plan.md。
 */

import { config } from './config';
import { listProjectAliases } from './config/projects';
import { logger } from './util/logger';

function main(): void {
  logger.info('FeiShuBot starting (M0 skeleton)');
  logger.info(`Feishu domain   : ${config.feishu.domain}`);
  logger.info(`LLM provider    : ${config.llm.provider} (model: ${config.llm.model || 'unset'})`);
  logger.info(`Intent model    : ${config.llm.intentModel || 'unset'}`);
  logger.info(`CLI provider    : ${config.cli.provider}`);
  logger.info(`GitLab base url : ${config.gitlab.baseUrl || 'unset'}`);
  const aliases = listProjectAliases();
  logger.info(`Projects        : ${aliases.length ? aliases.join(', ') : '(none registered)'}`);
  logger.info('尚未接入事件循环 — 见 docs/development-plan.md (M1 飞书长连接回声)。');
}

main();

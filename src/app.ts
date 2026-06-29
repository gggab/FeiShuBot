/**
 * 应用入口。
 * Application entry point.
 *
 * M3：飞书长连接 → 意图识别 → 按四类意图路由（chat 为真实 LLM，其余为 M4/M5 占位）。
 * 见 docs/development-plan.md。
 */

import { config } from './config';
import { listProjectAliases } from './config/projects';
import { logger } from './util/logger';
import { larkWsClient } from './feishu/client';
import { buildDispatcher } from './feishu/dispatcher';
import { MessageController } from './controller/message-controller';
import { createLlmClient } from './llm/provider';
import { getCliRunner } from './cli/factory';
import { GitLabClient } from './gitlab/client';
import { codeWriteAllowlist } from './auth/authorization';
import { IntentRecognizer } from './intent/recognizer';
import { HandlerRegistry } from './handlers/registry';
import { ChatHandler } from './handlers/chat';
import { CodeUnderstandingHandler } from './handlers/code-understanding';
import { BugFixHandler } from './handlers/bug-fix';
import { KnowledgeQaHandler } from './handlers/knowledge-qa';

function main(): void {
  logger.info('FeiShuBot starting (M3 intent routing)');
  logger.info(`Feishu domain : ${config.feishu.domain}`);
  logger.info(`LLM provider  : ${config.llm.provider} (chat: ${config.llm.model}, intent: ${config.llm.intentModel})`);
  logger.info(`CLI provider  : ${config.cli.provider}`);
  const aliases = listProjectAliases();
  logger.info(`Projects      : ${aliases.length ? aliases.join(', ') : '(none registered)'}`);

  const llm = createLlmClient();
  const cliRunner = getCliRunner();
  logger.info(`CLI runner    : ${cliRunner.name} (bin: ${config.cli.bin || cliRunner.name})`);

  const gitlab =
    config.gitlab.baseUrl && config.gitlab.token
      ? new GitLabClient(config.gitlab.baseUrl, config.gitlab.token)
      : null;
  logger.info(`GitLab MR     : ${gitlab ? config.gitlab.baseUrl : '未配置（Bug 修复将提示缺配置）'}`);
  logger.info(
    `Code-write 白名单: ${codeWriteAllowlist.length} 人` +
      (codeWriteAllowlist.length === 0 ? '（空：所有人将被拒绝修改代码）' : '')
  );

  const recognizer = new IntentRecognizer(llm, {
    model: config.llm.intentModel,
    minConfidence: config.llm.intentMinConfidence,
  });
  const registry = new HandlerRegistry([
    new ChatHandler(llm),
    new CodeUnderstandingHandler(cliRunner),
    new BugFixHandler(cliRunner, gitlab, codeWriteAllowlist),
    new KnowledgeQaHandler(),
  ]);
  const controller = new MessageController(recognizer, registry);
  const dispatcher = buildDispatcher((msg) => controller.handle(msg));

  larkWsClient.start({ eventDispatcher: dispatcher });
  logger.info('已启动飞书长连接，等待消息…（Ctrl+C 退出）');
}

main();

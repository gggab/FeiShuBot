/**
 * 应用入口。
 * Application entry point.
 *
 * 飞书长连接 → 意图识别 → 按四类意图路由（chat/代码理解/Bug 修复/知识问答）。
 * 启动先校验核心必填配置，缺失即 exit(1)（M6-D）。见 docs/development-plan.md。
 */

import { config, assertRequired } from './config';
import { listProjectAliases, projects } from './config/projects';
import { loadIdentity } from './config/identity';
import { logger } from './util/logger';
import { larkWsClient } from './feishu/client';
import { buildDispatcher } from './feishu/dispatcher';
import { ContactService, createLarkUserFetcher } from './feishu/contact';
import { ChatAdminService, createLarkChatAdminFetcher } from './feishu/chat-admin';
import { MessageController } from './controller/message-controller';
import { createLlmClient } from './llm/provider';
import { getCliRunner } from './cli/factory';
import { GitLabClient } from './gitlab/client';
import { DifyClient } from './knowledge/dify';
import {
  codeWriteAllowlist,
  allowedDepartments,
  codeReadAllowlist,
  codeReadAllowedChats,
} from './auth/authorization';
import { setSessionStore } from './session/context';
import { SqliteSessionStore } from './session/store';
import { IntentRecognizer } from './intent/recognizer';
import { HandlerRegistry } from './handlers/registry';
import { ChatHandler } from './handlers/chat';
import { CodeUnderstandingHandler } from './handlers/code-understanding';
import { BugFixHandler } from './handlers/bug-fix';
import { KnowledgeQaHandler } from './handlers/knowledge-qa';
import { GitCommandHandler } from './handlers/git-command';
import { KeyedMutex } from './util/repo-lock';
import { resolveReposRoot } from './repos/scope';
import { IntroMaintainer } from './repos/maintainer';

/** 核心必填配置：缺任一项无法提供基础能力（收发消息 + 意图/聊天）。 */
function validateCoreConfig(): void {
  assertRequired([
    ['APP_ID', config.feishu.appId],
    ['APP_SECRET', config.feishu.appSecret],
    ['LLM_BASE_URL', config.llm.baseUrl],
    ['LLM_API_KEY', config.llm.apiKey],
    ['LLM_MODEL', config.llm.model],
  ]);
}

function main(): void {
  validateCoreConfig();

  // 助手身份（名字/描述）从 IDENTITY.md 装载；缺文件/字段即显式抛错。
  const identity = loadIdentity();

  logger.info('FeiShuBot starting (M6)');
  logger.info(`Assistant     : ${identity.name}`);
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

  // 通讯录服务（A）：用于部门/邮箱授权与 reviewer 自动映射；需应用具备 contact 读权限。
  const contact = new ContactService(createLarkUserFetcher());
  logger.info(
    `Code-write 授权: 人员白名单(open_id/邮箱) ${codeWriteAllowlist.length} 条 / 部门白名单 ${allowedDepartments.length} 个` +
      (codeWriteAllowlist.length === 0 && allowedDepartments.length === 0 ? '（空：所有人将被拒绝修改代码）' : '')
  );
  logger.info(
    `Code-read 授权: 群白名单(chat_id) ${codeReadAllowedChats.length} 个 / 人员白名单(open_id/邮箱) ${codeReadAllowlist.length} 条` +
      (codeReadAllowedChats.length === 0 && codeReadAllowlist.length === 0 ? '（空：所有人将被拒绝阅读源码）' : '')
  );

  const dify =
    config.dify.baseUrl && config.dify.apiKey ? new DifyClient(config.dify.baseUrl, config.dify.apiKey) : null;
  logger.info(`Dify 知识库   : ${dify ? config.dify.baseUrl : '未配置（知识问答将提示缺配置）'}`);

  // 会话持久化（可选）：开启则写穿透到 SQLite，跨重启恢复；否则纯内存。
  if (config.session.persist) {
    const store = new SqliteSessionStore(config.session.dbFile, {
      maxMessages: config.session.storeMaxMessages,
      retentionDays: config.session.retentionDays,
    });
    setSessionStore(store);
    // 每日清理一次过期消息（unref 不阻塞退出）。
    setInterval(() => store.sweepExpired(), 86_400_000).unref();
    logger.info(
      `Session 持久化: SQLite ${config.session.dbFile}` +
        `（保留 ${config.session.retentionDays} 天，每会话上限 ${config.session.storeMaxMessages} 条）`
    );
  } else {
    logger.info('Session 持久化: 关闭（纯内存，进程重启即丢）');
  }

  const recognizer = new IntentRecognizer(llm, {
    model: config.llm.intentModel,
    minConfidence: config.llm.intentMinConfidence,
  });

  // /repos 作用域：代码理解/BugFix 让 codex 读 AGENTS.md + 工程简介自行定位工程（见 docs/handlers.md §9）。
  // 推导失败（如跨盘符）不致命：仅禁用 /repos 路由，其余功能照常。
  let reposRoot = '';
  let maintainer: IntroMaintainer | null = null;
  if (aliases.length > 0) {
    try {
      reposRoot = resolveReposRoot(projects, config.repos.root);
      maintainer = new IntroMaintainer({
        runner: cliRunner,
        reposRoot,
        registry: projects,
        introsDirName: config.repos.introsDirName,
        thresholds: { files: config.repos.introRegenFiles, lines: config.repos.introRegenLines },
        timeoutMs: config.cli.timeoutMs,
        refreshDebounceMs: config.repos.introRefreshDebounceMs,
        refreshMinIntervalMs: config.repos.introRefreshMinIntervalMs,
      });
      maintainer.writeAgentsDocs();
      logger.info(`Repos 作用域  : ${reposRoot}（简介目录 ${config.repos.introsDirName}）`);
      // 缺失简介后台预生成（逐个跑 CLI，较慢）；失败只记日志，不阻塞启动。
      void maintainer.ensureAllIntros().catch((e) => logger.warn(`[简介] 预生成失败: ${(e as Error).message}`));
    } catch (e) {
      logger.warn(`Repos 作用域  : 推导失败，已禁用 /repos 路由（设置 REPOS_ROOT 可修复）：${(e as Error).message}`);
    }
  }

  // 仓库级锁：仅 /git 运维之间与 BugFix 单仓库互斥用（代码理解已放弃仓库锁，见 §9.4）。
  const repoLock = new KeyedMutex();
  const registry = new HandlerRegistry([
    new ChatHandler(llm, identity),
    new CodeUnderstandingHandler(cliRunner, reposRoot, projects, codeReadAllowlist, codeReadAllowedChats, contact),
    new BugFixHandler(cliRunner, reposRoot, gitlab, codeWriteAllowlist, allowedDepartments, contact),
    new KnowledgeQaHandler(dify),
  ]);
  // /git 运维命令：复用「代码修改授权」（同 BugFix 白名单）；成功 pull/switch 后刷新对应工程简介。
  const gitCommand = new GitCommandHandler(
    projects,
    codeWriteAllowlist,
    allowedDepartments,
    contact,
    repoLock,
    undefined,
    undefined,
    // 成功 pull/switch 后仅「标记待刷新」，实际刷新由维护器去抖+节流+单飞择机进行，
    // 避免频繁切分支时反复重跑简介生成（见 docs/handlers.md §9.3）。
    maintainer ? (alias: string) => maintainer!.markDirty(alias) : undefined
  );
  // 群管理员服务：用于卡片「停止回复」按钮的权限判断（发起人 / 群主 / 群管理员）。
  const chatAdmin = new ChatAdminService(createLarkChatAdminFetcher());
  const controller = new MessageController(recognizer, registry, gitCommand, chatAdmin);
  const dispatcher = buildDispatcher(
    (msg) => controller.handle(msg),
    (taskId, operatorId) => controller.stop(taskId, operatorId),
    (messageId) => controller.recall(messageId)
  );

  larkWsClient.start({ eventDispatcher: dispatcher });
  logger.info('已启动飞书长连接，等待消息…（Ctrl+C 退出）');
}

try {
  main();
} catch (e) {
  logger.error('启动失败: ' + (e as Error).message);
  process.exit(1);
}

/**
 * 代码理解 Handler：在目标项目目录内调本地 CLI 只读阅读源码并解释。
 * 设计对齐 docs/handlers.md §2。
 */

import { Handler, HandlerContext } from './types';
import { CliRunner } from '../cli/runner';
import { resolveProject } from './resolve-project';
import { projects } from '../config/projects';
import { isAuthorizedToRead, splitUserEntries } from '../auth/authorization';
import { projectLabel } from './resolve-project';
import { ContactService } from '../feishu/contact';
import { KeyedMutex } from '../util/repo-lock';
import { versionFooter } from '../git/inspect';
import { config } from '../config';
import { logger } from '../util/logger';

function buildPrompt(task: string): string {
  return [
    '请阅读当前所在仓库的源码，回答下面的问题。要求：',
    '- 仅做只读分析，禁止修改任何文件。',
    '- 用简洁中文说明实现逻辑，并给出关键代码位置（文件路径:行号）。',
    '',
    `问题：${task}`,
  ].join('\n');
}

export class CodeUnderstandingHandler implements Handler {
  readonly intent = 'code_understanding' as const;

  constructor(
    private readonly runner: CliRunner,
    private readonly allowlist: string[],
    private readonly allowedChats: string[],
    private readonly contact: ContactService | null = null,
    private readonly lock: KeyedMutex = new KeyedMutex()
  ) {}

  /**
   * 群 chat_id 命中群白名单 或 人员白名单（open_id 或邮箱）命中即放行；两者皆空 → 拒绝（fail-closed）。
   * id 维度免 API；名单含邮箱时才调通讯录解析，解析失败按邮箱维度不命中处理。
   */
  private async isAuthorized(userId: string, chatId: string): Promise<boolean> {
    if (isAuthorizedToRead({ userId, chatId, allowlist: this.allowlist, allowedChats: this.allowedChats })) {
      return true;
    }

    const { emails } = splitUserEntries(this.allowlist);
    if (emails.length === 0 || !this.contact) return false;

    let email: string | undefined;
    try {
      email = (await this.contact.getUser(userId)).email || undefined;
    } catch (e) {
      logger.warn(`[权限] 邮箱解析失败(该维度按不命中处理) user=${userId}: ${(e as Error).message}`);
      return false;
    }
    if (email === undefined) return false;
    return isAuthorizedToRead({ userId, email, chatId, allowlist: this.allowlist, allowedChats: this.allowedChats });
  }

  async handle(ctx: HandlerContext): Promise<void> {
    // 权限强制校验：仅授权的群或人员可触发"阅读源码"。
    if (!(await this.isAuthorized(ctx.userId, ctx.chatId))) {
      logger.warn(`[权限] 拒绝阅读源码请求 user=${ctx.userId} chat=${ctx.chatId} task="${ctx.intent.task}"`);
      await ctx.reply.done(
        '⛔ 你没有阅读源码的权限。\n「代码理解 / 阅读源码」仅限授权的群或人员，如需开通请联系管理员。'
      );
      return;
    }

    const resolved = resolveProject(ctx.intent.project, projects);
    if (!resolved.ok) {
      await ctx.reply.done(resolved.message);
      return;
    }

    const { alias, config: proj } = resolved;
    logger.info(`[代码理解] 项目=${alias} cwd=${proj.path} task="${ctx.intent.task}"`);

    // 先给出进度提示（阅读代码可能耗时）。
    ctx.reply.push(`🔍 正在阅读「${alias}」的代码…\n\n`);

    let acc = '';
    let footer = '';
    try {
      // 与 /git 运维共享仓库级锁：阅读期间不会被切分支/拉取覆盖，版本页脚也据此一致。
      await this.lock.run(proj.path, async () => {
        footer = await versionFooter(projectLabel(alias, proj.path), proj.path);
        for await (const chunk of this.runner.run({
          cwd: proj.path,
          prompt: buildPrompt(ctx.intent.task),
          mode: 'read',
          timeoutMs: config.cli.timeoutMs,
        })) {
          acc += chunk;
          ctx.reply.push(chunk);
        }
      });
      logger.info(`[代码理解] 完成，输出 ${acc.length} 字`);
      const body = acc.trim() || '（CLI 无输出）';
      await ctx.reply.done(`${body}\n\n---\n${footer}`);
    } catch (e) {
      logger.error('[代码理解] 失败:', e);
      await ctx.reply.fail(`代码理解执行失败（项目 ${alias}）：${(e as Error).message}`);
    }
  }
}

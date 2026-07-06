/**
 * 代码理解 Handler：在 /repos 作用域内让本地 CLI 读 AGENTS.md + 工程简介自行定位工程，
 * 只读阅读该工程源码并解释；据 codex 声明的工程事后采样版本作页脚。
 * 设计对齐 docs/handlers.md §2 / §9。
 */

import { Handler, HandlerContext } from './types';
import { CliRunner } from '../cli/runner';
import { ProjectRegistry } from '../config/projects';
import { isAuthorizedToRead, splitUserEntries } from '../auth/authorization';
import { projectLabel } from './resolve-project';
import { ContactService } from '../feishu/contact';
import { versionFooter } from '../git/inspect';
import { buildRoutingReadPrompt } from '../repos/prompts';
import { parseDeclaredProjects, stripDeclaration } from '../repos/routing';
import { config } from '../config';
import { logger } from '../util/logger';

export class CodeUnderstandingHandler implements Handler {
  readonly intent = 'code_understanding' as const;

  constructor(
    private readonly runner: CliRunner,
    /** /repos 作用域根：codex 在此 cwd 下自行路由（见 docs/handlers.md §9）。 */
    private readonly reposRoot: string,
    private readonly registry: ProjectRegistry,
    private readonly allowlist: string[],
    private readonly allowedChats: string[],
    private readonly contact: ContactService | null = null
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

    const aliases = Object.keys(this.registry);
    if (aliases.length === 0) {
      await ctx.reply.done('尚未注册任何项目，请先在 projects.json 配置后再试。');
      return;
    }

    logger.info(`[代码理解] cwd=${this.reposRoot}（/repos 作用域自路由） task="${ctx.intent.task}"`);
    ctx.reply.push('🔍 正在定位工程并阅读代码…\n\n');

    let acc = '';
    try {
      // 不再持仓库锁（放弃"阅读中防切分支"，见 docs/handlers.md §9.4）。codex 在 /repos 下
      // 读 AGENTS.md/简介自行选定工程作答，末尾以 __PROJECT__ 声明依据的工程。
      for await (const chunk of this.runner.run({
        cwd: this.reposRoot,
        prompt: buildRoutingReadPrompt(ctx.text),
        mode: 'read',
        timeoutMs: config.cli.timeoutMs,
        signal: ctx.signal,
      })) {
        acc += chunk;
        ctx.reply.push(chunk);
      }

      const declared = parseDeclaredProjects(acc, aliases);
      const body = stripDeclaration(acc) || '（CLI 无输出）';
      const footer = await this.buildFooter(declared);
      logger.info(`[代码理解] 完成，声明工程=[${declared.join(', ') || '未声明'}]，输出 ${body.length} 字`);
      await ctx.reply.done(`${body}\n\n---\n${footer}`);
    } catch (e) {
      logger.error('[代码理解] 失败:', e);
      await ctx.reply.fail(`代码理解执行失败：${(e as Error).message}`);
    }
  }

  /** 据 codex 声明的工程（可多个，跨工程时逐个）事后采样版本页脚；未声明/非法则降级说明。 */
  private async buildFooter(declared: string[]): Promise<string> {
    if (declared.length === 0) {
      return '📌 无法确定本次回答所依据的工程（codex 未声明 __PROJECT__），版本信息略。';
    }
    const lines = await Promise.all(
      declared.map((alias) => {
        const proj = this.registry[alias];
        return versionFooter(projectLabel(alias, proj.path), proj.path);
      })
    );
    return lines.join('\n');
  }
}

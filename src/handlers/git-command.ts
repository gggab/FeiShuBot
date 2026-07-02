/**
 * /git 运维命令：拉取最新 / 切换分支或标签 / 查看当前版本。
 * 命令前缀触发（Controller 在意图识别前拦截），不走 LLM 意图识别。设计对齐 docs/handlers.md §4。
 *
 * 授权：整组 /git 命令复用「代码修改授权」（§2.2，isAuthorizedToModify）——
 * 切分支/拉取会改变共享仓库状态、影响之后所有人的阅读结果，属写类操作。
 */

import { ReplyStream } from './types';
import { CardReplyStream } from '../feishu/reply';
import { resolveProjects, ResolvedProject, projectLabel } from './resolve-project';
import { ProjectRegistry } from '../config/projects';
import { ContactService } from '../feishu/contact';
import { isAuthorizedToModify, splitUserEntries } from '../auth/authorization';
import { KeyedMutex } from '../util/repo-lock';
import { GitOps, defaultGitOps, GitRefusedError } from '../git/ops';
import { formatVersionFooter, describeVersion } from '../git/inspect';
import { logger } from '../util/logger';

export const GIT_COMMAND_USAGE = [
  'Git 运维命令用法（可一次多个项目，或用 all 表示全部）：',
  '• /git status [项目…|all] — 查看当前分支/提交',
  '• /git pull [项目…|all] — 拉取当前分支最新代码（仅快进）',
  '• /git switch [项目…|all] <分支或标签> — 切换到指定分支/标签',
  '省略「项目」时用默认项目；仅授权人员可用（同「修改代码」权限）。',
].join('\n');

export type GitCommand =
  | { op: 'status'; projectTokens: string[] }
  | { op: 'pull'; projectTokens: string[] }
  | { op: 'switch'; projectTokens: string[]; ref: string }
  | { op: 'help' }
  | { op: 'error'; message: string };

/** 是否为 /git 命令（`/git` 后跟空白或结束）。 */
export function isGitCommand(text: string): boolean {
  return /^\/git(\s|$)/.test(text.trim());
}

/**
 * 解析 /git 命令（纯函数，便于测试）。传入的 text 应已确认是 /git 命令。
 * status/pull：其后 token 全部视为项目列表（可空=默认、可含 all）。
 * switch：**最后一个 token 是分支/标签**，其前的 token 都是项目列表。
 */
export function parseGitCommand(text: string): GitCommand {
  const rest = text.trim().replace(/^\/git\b/, '').trim();
  if (rest === '' || rest === 'help') return { op: 'help' };

  const tokens = rest.split(/\s+/);
  const sub = tokens[0];
  const args = tokens.slice(1);

  switch (sub) {
    case 'status':
      return { op: 'status', projectTokens: args };
    case 'pull':
      return { op: 'pull', projectTokens: args };
    case 'switch':
    case 'checkout':
      if (args.length === 0) return { op: 'error', message: '用法：/git switch [项目…|all] <分支或标签>' };
      return { op: 'switch', projectTokens: args.slice(0, -1), ref: args[args.length - 1] };
    default:
      return { op: 'error', message: `未知子命令「${sub}」。\n${GIT_COMMAND_USAGE}` };
  }
}

export class GitCommandHandler {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly allowlist: string[],
    private readonly allowedDepartments: string[],
    private readonly contact: ContactService | null,
    private readonly lock: KeyedMutex,
    private readonly ops: GitOps = defaultGitOps,
    private readonly replyFactory: (chatId: string) => Promise<ReplyStream> = async (chatId) => {
      const reply = new CardReplyStream(chatId);
      await reply.init();
      return reply;
    }
  ) {}

  matches(text: string): boolean {
    return isGitCommand(text);
  }

  /** 部门白名单为主、人员白名单（open_id 或邮箱）兜底；同 BugFixHandler（§2.2）。 */
  private async authorize(userId: string): Promise<boolean> {
    const { openIds, emails } = splitUserEntries(this.allowlist);
    if (openIds.includes(userId)) return true;
    if ((emails.length === 0 && this.allowedDepartments.length === 0) || !this.contact) return false;
    try {
      const user = await this.contact.getUser(userId);
      return isAuthorizedToModify({
        userId,
        email: user.email || undefined,
        departmentIds: user.departmentIds,
        allowlist: this.allowlist,
        allowedDepartments: this.allowedDepartments,
      });
    } catch (e) {
      logger.warn(`[Git命令] 通讯录校验失败(按拒绝处理): ${(e as Error).message}`);
      return false;
    }
  }

  async run(userId: string, chatId: string, text: string): Promise<void> {
    const reply = await this.replyFactory(chatId);

    const cmd = parseGitCommand(text);
    if (cmd.op === 'help') {
      await reply.done(GIT_COMMAND_USAGE);
      return;
    }
    if (cmd.op === 'error') {
      await reply.done(cmd.message);
      return;
    }

    if (!(await this.authorize(userId))) {
      logger.warn(`[Git命令] 拒绝 user=${userId} text="${text}"`);
      await reply.done(
        '⛔ 你没有执行 Git 操作的权限。\n「/git 拉取 / 切换」仅限授权人员（按部门或白名单），如需开通请联系管理员。'
      );
      return;
    }

    const resolved = resolveProjects(cmd.projectTokens, this.registry);
    if (!resolved.ok) {
      await reply.done(resolved.message);
      return;
    }
    const { projects } = resolved;
    logger.info(`[Git命令] op=${cmd.op} 项目=[${projects.map((p) => p.alias).join(', ')}] user=${userId}`);

    reply.push(
      projects.length > 1
        ? `⏳ 正在对 ${projects.length} 个项目执行 ${cmd.op}…\n`
        : `⏳ 正在执行 ${cmd.op}…\n`
    );

    // 每个项目走各自的仓库锁，互不阻塞并发执行；单个失败只影响自己那一行。
    const lines = await Promise.all(projects.map((p) => this.runOne(cmd, p)));
    await reply.done(this.render(cmd, projects, lines));
  }

  /** 对单个项目执行一次操作，返回一行结果；绝不抛出（异常收敛成结果行）。 */
  private async runOne(cmd: Exclude<GitCommand, { op: 'help' } | { op: 'error' }>, p: ResolvedProject): Promise<string> {
    const name = projectLabel(p.alias, p.config.path);
    try {
      return await this.lock.run(p.config.path, async () => {
        switch (cmd.op) {
          case 'status':
            return formatVersionFooter(name, await this.ops.version(p.config.path));
          case 'pull': {
            const r = await this.ops.pull(p.config.path);
            return r.updated
              ? `✅ ${name}：分支 \`${r.branch}\` ${r.before} → ${r.after}（${r.subject}，${r.relDate}）`
              : `✅ ${name}：已是最新 分支 \`${r.branch}\` @ ${r.after}`;
          }
          case 'switch': {
            const r = await this.ops.switchRef(p.config.path, cmd.ref);
            return `✅ ${name}：已切换 · ${describeVersion(r.version)}`;
          }
        }
      });
    } catch (e) {
      if (e instanceof GitRefusedError) return `⚠️ ${name}：${e.message}`;
      logger.error(`[Git命令] ${p.alias} 失败:`, e);
      return `❌ ${name}：${(e as Error).message}`;
    }
  }

  /** 单项目直接给该行（status 即版本页脚）；多项目加标题后逐行汇总。 */
  private render(
    cmd: Exclude<GitCommand, { op: 'help' } | { op: 'error' }>,
    projects: ResolvedProject[],
    lines: string[]
  ): string {
    if (projects.length === 1) return lines[0];
    const title =
      cmd.op === 'status' ? '📦 项目状态' : cmd.op === 'pull' ? '📦 批量拉取' : `📦 批量切换到「${cmd.ref}」`;
    return `${title}（${projects.length} 个项目）\n${lines.join('\n')}`;
  }
}

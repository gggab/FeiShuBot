/**
 * Bug 修复 Handler：worktree 隔离 → Claude 写模式修复 → 提交/推送 → 建 GitLab MR → 指派发起人。
 * 设计对齐 docs/handlers.md §3。
 */

import os from 'os';
import path from 'path';
import { Handler, HandlerContext } from './types';
import { CliRunner } from '../cli/runner';
import { GitWorkspace } from '../git/workspace';
import { GitLabClient } from '../gitlab/client';
import { resolveProject } from './resolve-project';
import { projects, getGitlabUser } from '../config/projects';
import { config } from '../config';
import { logger } from '../util/logger';
import { buildFixBranch, buildCommitMessage, buildBugfixPrompt, buildMrDescription } from './bugfix-naming';

export class BugFixHandler implements Handler {
  readonly intent = 'bug_fix' as const;

  /** 仓库级锁：同一仓库路径同时只允许一个修复任务。 */
  private readonly locks = new Set<string>();

  constructor(
    private readonly runner: CliRunner,
    private readonly gitlab: GitLabClient | null
  ) {}

  async handle(ctx: HandlerContext): Promise<void> {
    const resolved = resolveProject(ctx.intent.project, projects);
    if (!resolved.ok) {
      await ctx.reply.done(resolved.message);
      return;
    }
    const { alias, config: proj } = resolved;

    if (!proj.gitlabProjectId) {
      await ctx.reply.done(`项目「${alias}」未配置 gitlabProjectId，无法走 MR 流程（仅支持代码理解）。`);
      return;
    }
    if (!this.gitlab) {
      await ctx.reply.done('未配置 GITLAB_BASE_URL / GITLAB_TOKEN，无法创建 Merge Request。');
      return;
    }

    const baseBranch = proj.baseBranch || config.gitlab.defaultBaseBranch;

    if (this.locks.has(proj.path)) {
      await ctx.reply.done(`项目「${alias}」有正在进行的修复任务，请稍候再试。`);
      return;
    }
    this.locks.add(proj.path);

    const branch = buildFixBranch(ctx.intent.task, config.gitlab.fixBranchPrefix);
    const worktree = path.join(os.tmpdir(), `feishubot-fix-${Date.now().toString(36)}`);
    const ws = new GitWorkspace(proj.path);
    let worktreeCreated = false;

    logger.info(`[Bug修复] 项目=${alias} base=${baseBranch} branch=${branch} task="${ctx.intent.task}"`);

    try {
      ctx.reply.push(`🐞 修复「${alias}」：${ctx.intent.task}\n\n① 准备工作区（基于 ${baseBranch}）…\n`);
      await ws.fetch();
      await ws.createWorktree(worktree, branch, baseBranch);
      worktreeCreated = true;

      ctx.reply.push(`② 切分支 ${branch}，调用 Claude 修复（详见控制台）…\n`);
      let summary = '';
      for await (const chunk of this.runner.run({
        cwd: worktree,
        prompt: buildBugfixPrompt(ctx.intent.task),
        mode: 'write',
        timeoutMs: config.cli.timeoutMs,
      })) {
        summary += chunk;
      }

      const changed = await ws.changedFiles(worktree);
      if (changed.length === 0) {
        logger.info('[Bug修复] 未产生改动，取消并清理');
        await ctx.reply.done(
          `Claude 未对「${alias}」产生任何改动，已取消（未建 MR）。\n\nClaude 说明：\n${summary.trim().slice(0, 1500)}`
        );
        return;
      }
      logger.info(`[Bug修复] 改动 ${changed.length} 个文件，提交并推送`);

      ctx.reply.push(`③ 提交并推送（${changed.length} 个文件）…\n`);
      await ws.commitAll(worktree, buildCommitMessage(ctx.intent.task));
      await ws.push(worktree, branch);

      ctx.reply.push('④ 创建 Merge Request…\n');
      const gitlabUser = getGitlabUser(ctx.userId);
      const mr = await this.gitlab.createMergeRequest({
        projectId: proj.gitlabProjectId,
        sourceBranch: branch,
        targetBranch: baseBranch,
        title: buildCommitMessage(ctx.intent.task),
        description: buildMrDescription(ctx.intent.task, summary, ctx.userId, gitlabUser),
        assigneeId: gitlabUser?.gitlabUserId,
      });

      const reviewerNote = gitlabUser
        ? `已指派 @${gitlabUser.gitlabUsername} review`
        : '⚠️ 未找到你的 GitLab 账号映射，请在 MR 中手动指定 reviewer';
      logger.info(`[Bug修复] 完成 MR=${mr.webUrl}`);
      await ctx.reply.done(
        `✅ 已为「${alias}」创建 Merge Request：\n${mr.webUrl}\n\n` +
          `目标分支：${baseBranch}\n${reviewerNote}\n\n改动文件：\n${changed.join('\n')}`
      );
    } catch (e) {
      logger.error('[Bug修复] 失败:', e);
      await ctx.reply.fail(`Bug 修复失败（项目 ${alias}）：${(e as Error).message}`);
    } finally {
      if (worktreeCreated) await ws.cleanup(worktree, branch);
      this.locks.delete(proj.path);
    }
  }
}

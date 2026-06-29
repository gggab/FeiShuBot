/**
 * 基于 worktree 的 Bug 修复工作区。
 * Worktree-based workspace so we never touch the user's checked-out repo.
 * 设计对齐 docs/handlers.md §3。
 */

import { git } from './run';
import { logger } from '../util/logger';

export class GitWorkspace {
  constructor(private readonly repoPath: string) {}

  /** 拉取远端最新（只读，不动工作区）。 */
  async fetch(): Promise<void> {
    await git(['fetch', 'origin', '--prune'], this.repoPath);
  }

  /** 在 worktreePath 基于 origin/<baseBranch> 创建新分支的 worktree。 */
  async createWorktree(worktreePath: string, branch: string, baseBranch: string): Promise<void> {
    await git(['worktree', 'add', worktreePath, '-b', branch, `origin/${baseBranch}`], this.repoPath);
  }

  /** worktree 内是否有未提交改动。 */
  async hasChanges(worktreePath: string): Promise<boolean> {
    const out = await git(['status', '--porcelain'], worktreePath);
    return out.trim().length > 0;
  }

  /** worktree 内简要改动列表（用于摘要）。 */
  async changedFiles(worktreePath: string): Promise<string[]> {
    const out = await git(['status', '--porcelain'], worktreePath);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  async commitAll(worktreePath: string, message: string): Promise<void> {
    await git(['add', '-A'], worktreePath);
    await git(['commit', '-m', message], worktreePath);
  }

  async push(worktreePath: string, branch: string): Promise<void> {
    await git(['push', '-u', 'origin', branch], worktreePath);
  }

  /** 尽力清理：移除 worktree 与本地分支（失败仅告警，不抛出）。 */
  async cleanup(worktreePath: string, branch: string): Promise<void> {
    try {
      await git(['worktree', 'remove', '--force', worktreePath], this.repoPath);
    } catch (e) {
      logger.warn(`[Bug修复] 清理 worktree 失败: ${(e as Error).message}`);
    }
    try {
      await git(['branch', '-D', branch], this.repoPath);
    } catch (e) {
      logger.warn(`[Bug修复] 删除本地分支失败: ${(e as Error).message}`);
    }
  }
}

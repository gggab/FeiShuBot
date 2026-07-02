/**
 * 机器人对项目本地仓库（Project Registry 的 config.path）的 Git 运维操作：
 * 拉取最新 / 切换分支或标签。供 /git 命令使用。设计对齐 docs/handlers.md §4。
 *
 * 安全约束（AGENTS.md：No fallback / No hidden errors）：
 * - 工作区有未提交改动 → 显式拒绝（GitRefusedError），绝不 --force 覆盖用户改动。
 * - pull 仅快进（--ff-only）；分叉/游离 HEAD → 显式拒绝，不生成合并提交。
 * - 与代码阅读共享仓库级锁（见 util/repo-lock.ts），避免读到一半被切分支。
 */

import { git } from './run';
import { getRepoVersion, RepoVersion } from './inspect';

/** 单元分隔符，避免提交标题里的空格干扰解析。 */
const US = '\x1f';

/** 可预期的“拒绝执行”（非异常）：如工作区脏、无法快进。调用方以提示而非报错呈现。 */
export class GitRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitRefusedError';
  }
}

export interface PullResult {
  branch: string;
  before: string;
  after: string;
  updated: boolean;
  subject: string;
  relDate: string;
}

export interface SwitchResult {
  version: RepoVersion;
}

/** Git 运维接口，便于在 Handler 中注入替身测试。 */
export interface GitOps {
  version(repoPath: string): Promise<RepoVersion>;
  pull(repoPath: string): Promise<PullResult>;
  switchRef(repoPath: string, ref: string): Promise<SwitchResult>;
}

async function isDirty(repoPath: string): Promise<boolean> {
  return (await git(['status', '--porcelain'], repoPath)).trim().length > 0;
}

/** 真实实现：调用 git 子进程。 */
export const defaultGitOps: GitOps = {
  version: getRepoVersion,

  async pull(repoPath: string): Promise<PullResult> {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).trim();
    if (branch === 'HEAD') {
      throw new GitRefusedError('当前处于游离 HEAD（可能停在某个 tag/提交），无法直接 pull。请先用 /git switch <项目> <分支> 回到分支。');
    }
    if (await isDirty(repoPath)) {
      throw new GitRefusedError('工作区有未提交改动，已拒绝 pull（避免覆盖你的改动）。请先提交或清理后再试。');
    }

    const before = (await git(['rev-parse', '--short', 'HEAD'], repoPath)).trim();
    await git(['fetch', 'origin', '--prune'], repoPath);
    try {
      await git(['merge', '--ff-only', `origin/${branch}`], repoPath);
    } catch (e) {
      throw new GitRefusedError(`无法快进合并 origin/${branch}（本地与远端已分叉，需人工处理）：${(e as Error).message}`);
    }
    const after = (await git(['rev-parse', '--short', 'HEAD'], repoPath)).trim();

    const [subject = '', relDate = ''] = (await git(['log', '-1', `--format=%s${US}%cr`], repoPath)).trim().split(US);
    return { branch, before, after, updated: before !== after, subject, relDate };
  },

  async switchRef(repoPath: string, ref: string): Promise<SwitchResult> {
    if (await isDirty(repoPath)) {
      throw new GitRefusedError('工作区有未提交改动，已拒绝切换（避免覆盖你的改动）。请先提交或清理后再试。');
    }
    await git(['fetch', 'origin', '--prune', '--tags'], repoPath);
    try {
      await git(['checkout', ref], repoPath);
    } catch (e) {
      throw new GitRefusedError(`切换到「${ref}」失败（分支/标签不存在，或存在冲突）：${(e as Error).message}`);
    }
    return { version: await getRepoVersion(repoPath) };
  },
};

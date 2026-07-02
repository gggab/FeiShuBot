/**
 * 只读的仓库版本快照：当前分支/提交/是否有未提交改动。
 * Read-only repo version snapshot for the "answer based on which version" footer.
 *
 * 只读、不触网、不改工作区（纯 rev-parse / log / status）。设计对齐 docs/handlers.md §2。
 */

import { git } from './run';
import { logger } from '../util/logger';

/** 单元分隔符，避免提交标题里的空格/特殊字符干扰解析。 */
const US = '\x1f';

export interface RepoVersion {
  /** 分支名；游离 HEAD 时为空串。 */
  branch: string;
  /** 是否处于游离 HEAD（如停在某个 tag/提交上）。 */
  detached: boolean;
  /** 游离且正好落在某个 tag 上时的标签名。 */
  tag?: string;
  /** 短提交哈希。 */
  sha: string;
  /** 最近一条提交标题。 */
  subject: string;
  /** 相对时间（如「2 天前」）。 */
  relDate: string;
  /** 工作区是否有未提交改动（含未跟踪文件）。 */
  dirty: boolean;
}

/** 采集仓库当前版本快照（只读）。非 git 仓库或命令失败时抛错，由调用方决定降级。 */
export async function getRepoVersion(repoPath: string): Promise<RepoVersion> {
  const branchRaw = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).trim();
  const detached = branchRaw === 'HEAD';

  const logLine = (await git(['log', '-1', `--format=%h${US}%s${US}%cr`], repoPath)).trim();
  const [sha = '', subject = '', relDate = ''] = logLine.split(US);

  let tag: string | undefined;
  if (detached) {
    try {
      tag = (await git(['describe', '--tags', '--exact-match'], repoPath)).trim() || undefined;
    } catch {
      tag = undefined; // 不在任何 tag 上，保持游离 HEAD 描述
    }
  }

  const dirty = (await git(['status', '--porcelain'], repoPath)).trim().length > 0;

  return { branch: detached ? '' : branchRaw, detached, tag, sha, subject, relDate, dirty };
}

/** 「分支 x / tag y / 游离 HEAD」这一段位置描述（纯函数）。 */
function whereOf(v: RepoVersion): string {
  return v.detached ? (v.tag ? `tag \`${v.tag}\`` : '游离 HEAD') : `分支 \`${v.branch}\``;
}

/** 紧凑版本描述「分支 x @ sha」，用于批量结果行（纯函数）。 */
export function describeVersion(v: RepoVersion): string {
  return `${whereOf(v)} @ ${v.sha}`;
}

/** 把版本快照格式化成回答页脚（纯函数）。name 为项目展示名（见 projectLabel）。 */
export function formatVersionFooter(name: string, v: RepoVersion): string {
  const subj = v.subject ? `${v.subject}，` : '';
  const dirty = v.dirty ? ' · ⚠️ 工作区有未提交改动' : '';
  return `📌 基于 **${name}** · ${whereOf(v)} · 提交 \`${v.sha}\`（${subj}${v.relDate}）${dirty}`;
}

/** 便捷封装：采集并格式化；失败不抛，降级为「无法读取版本」提示（不阻断回答）。 */
export async function versionFooter(name: string, repoPath: string): Promise<string> {
  try {
    return formatVersionFooter(name, await getRepoVersion(repoPath));
  } catch (e) {
    logger.warn(`[版本] 读取 git 版本失败 ${repoPath}: ${(e as Error).message}`);
    return `📌 基于 **${name}**（无法读取 git 版本信息）`;
  }
}

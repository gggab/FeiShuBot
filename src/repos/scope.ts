/**
 * `/repos` 作用域推导（纯函数，便于测试）。设计对齐 docs/handlers.md §9.1。
 *
 * reposRoot = 所有已注册仓库 path 的**公共父目录**；代码理解/路由让 codex 以此为 cwd，
 * AGENTS.md/CLAUDE.md 与简介目录都落在这里（仓库外，不污染各仓库 git status）。
 */

import { ProjectRegistry } from '../config/projects';

/** 归一化：反斜杠→正斜杠，去掉结尾斜杠（保留盘符/根）。 */
export function normalizePath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return s === '' ? '/' : s;
}

/**
 * 推导公共父目录。规则：
 * - 取各路径的最长公共**段**前缀；
 * - 若结果与某个仓库路径相等（如只有一个仓库），退一级到其父目录；
 * - 没有公共父目录（如跨盘符）→ 抛错，提示显式设置 REPOS_ROOT。
 */
export function deriveReposRoot(paths: string[]): string {
  if (paths.length === 0) {
    throw new Error('无法推导 reposRoot：项目注册表为空');
  }
  const norm = paths.map(normalizePath);
  const segs = norm.map((p) => p.split('/'));
  const first = segs[0];
  const common: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    if (segs.every((s) => s[i] === seg)) common.push(seg);
    else break;
  }
  let root = common.join('/');
  // 结果恰好等于某个仓库路径（典型：单仓库）→ 退到父目录。
  if (norm.includes(root)) {
    root = common.slice(0, -1).join('/');
  }
  if (root === '' || root === '/') {
    // 只剩空/根（如不同盘符 C:/ 与 D:/，或全在文件系统根下）→ 不安全，要求显式指定。
    throw new Error('注册表项目路径没有可用的公共父目录，请显式设置 REPOS_ROOT（见 docs/configuration.md）');
  }
  return root;
}

/** 取 reposRoot：优先用显式 override（非空），否则从注册表推导。 */
export function resolveReposRoot(registry: ProjectRegistry, override?: string): string {
  if (override && override.trim() !== '') return normalizePath(override);
  return deriveReposRoot(Object.values(registry).map((c) => c.path));
}

/** 简介目录绝对路径。 */
export function introsDir(reposRoot: string, dirName: string): string {
  return `${normalizePath(reposRoot)}/${dirName.replace(/^\/+|\/+$/g, '')}`;
}

/** 某工程简介文件的绝对路径。 */
export function introPath(reposRoot: string, dirName: string, alias: string): string {
  return `${introsDir(reposRoot, dirName)}/${alias}.md`;
}

/** 某工程简介文件相对 reposRoot 的路径（写进 AGENTS.md 索引表）。 */
export function introRelPath(dirName: string, alias: string): string {
  return `${dirName.replace(/^\/+|\/+$/g, '')}/${alias}.md`;
}

export interface RoutingEntry {
  alias: string;
  /** 仓库绝对路径（归一化）。 */
  repoPath: string;
  /** 简介相对路径（相对 reposRoot）。 */
  introRel: string;
}

/** 从注册表构造路由索引条目（供 AGENTS.md 生成用）。 */
export function buildRoutingEntries(registry: ProjectRegistry, dirName: string): RoutingEntry[] {
  return Object.entries(registry).map(([alias, cfg]) => ({
    alias,
    repoPath: normalizePath(cfg.path),
    introRel: introRelPath(dirName, alias),
  }));
}

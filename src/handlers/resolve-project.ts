/**
 * 项目解析（纯函数，便于测试）。
 * Resolve the target project for CLI handlers. 设计对齐 docs/handlers.md §2。
 *
 * 规则：
 * - 指定别名命中 → 用之；未命中 → 拒绝并列出可用项目。
 * - 未指定 → 有 default 用 default；只有一个项目用它；多个无默认 → 让用户说明。
 * - 解析到的本地目录必须存在（安全边界 + 防止 cwd 不存在）。
 */

import fs from 'fs';
import path from 'path';
import { ProjectRegistry, ProjectConfig } from '../config/projects';

/**
 * 项目展示名：取本地仓库目录名作为「工程完整名字」，别名不同则在括号里附上（便于回敲命令）。
 * 例：alias=portal, path=.../std-smart-office-portal → 「std-smart-office-portal（portal）」。
 */
export function projectLabel(alias: string, repoPath: string): string {
  const full = path.posix.basename(repoPath.replace(/\\/g, '/').replace(/\/+$/, ''));
  return full && full !== alias ? `${full}（${alias}）` : alias || full;
}

export type ResolveResult =
  | { ok: true; alias: string; config: ProjectConfig }
  | { ok: false; message: string };

export function resolveProject(
  projectAlias: string | undefined,
  registry: ProjectRegistry,
  exists: (p: string) => boolean = fs.existsSync
): ResolveResult {
  const aliases = Object.keys(registry);
  if (aliases.length === 0) {
    return { ok: false, message: '尚未注册任何项目，请先在 projects.json 配置后再试。' };
  }

  let alias: string | undefined = projectAlias;
  if (alias) {
    if (!registry[alias]) {
      return { ok: false, message: `未找到项目「${alias}」。可用项目：${aliases.join('、')}` };
    }
  } else {
    const def = aliases.find((a) => registry[a].default);
    if (def) {
      alias = def;
    } else if (aliases.length === 1) {
      alias = aliases[0];
    } else {
      return { ok: false, message: `请说明要查看哪个项目。可用项目：${aliases.join('、')}` };
    }
  }

  const config = registry[alias];
  if (!exists(config.path)) {
    return { ok: false, message: `项目「${alias}」的本地目录不存在：${config.path}` };
  }
  return { ok: true, alias, config };
}

export type ResolvedProject = { alias: string; config: ProjectConfig };

export type ResolveManyResult =
  | { ok: true; projects: ResolvedProject[] }
  | { ok: false; message: string };

/**
 * 解析一组项目 token（供 /git 批量命令用，纯函数）。
 * - 含 `all`（忽略大小写）→ 全部已注册项目。
 * - 空数组 → 默认/唯一项目（复用 resolveProject 的规则）。
 * - 否则逐个解析并去重；任一未命中/目录不存在 → 显式报错（fail fast）。
 */
export function resolveProjects(
  tokens: string[],
  registry: ProjectRegistry,
  exists: (p: string) => boolean = fs.existsSync
): ResolveManyResult {
  const aliases = Object.keys(registry);
  if (aliases.length === 0) {
    return { ok: false, message: '尚未注册任何项目，请先在 projects.json 配置后再试。' };
  }

  if (tokens.some((t) => t.toLowerCase() === 'all')) {
    const projects: ResolvedProject[] = [];
    for (const alias of aliases) {
      const config = registry[alias];
      if (!exists(config.path)) {
        return { ok: false, message: `项目「${alias}」的本地目录不存在：${config.path}` };
      }
      projects.push({ alias, config });
    }
    return { ok: true, projects };
  }

  if (tokens.length === 0) {
    const r = resolveProject(undefined, registry, exists);
    return r.ok ? { ok: true, projects: [{ alias: r.alias, config: r.config }] } : { ok: false, message: r.message };
  }

  const seen = new Set<string>();
  const projects: ResolvedProject[] = [];
  for (const token of tokens) {
    const r = resolveProject(token, registry, exists);
    if (!r.ok) return { ok: false, message: r.message };
    if (!seen.has(r.alias)) {
      seen.add(r.alias);
      projects.push({ alias: r.alias, config: r.config });
    }
  }
  return { ok: true, projects };
}

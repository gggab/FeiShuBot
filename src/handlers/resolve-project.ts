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
import { ProjectRegistry, ProjectConfig } from '../config/projects';

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

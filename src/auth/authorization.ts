/**
 * 代码修改授权：只有白名单内的飞书用户(open_id)可触发"修改代码"（Bug 修复/写操作）。
 * Authorization for code-modifying actions. 设计对齐 docs/configuration.md。
 *
 * 加载优先级（与项目注册表一致）：
 * 1. 文件 BUGFIX_ALLOWLIST_FILE（默认 bugfix-allowlist.json，内容为 open_id 字符串数组）；
 * 2. 否则环境变量 BUGFIX_ALLOWLIST（逗号/空白分隔）；
 * 3. 都没有则为空 —— **fail-closed：空名单时拒绝所有人**（强制校验）。
 */

import fs from 'fs';
import path from 'path';

export function parseAllowlistEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 是否有权限修改代码。空名单一律拒绝（fail-closed）。 */
export function canModifyCode(userId: string, allowlist: string[]): boolean {
  return allowlist.length > 0 && allowlist.includes(userId);
}

function loadAllowlist(): string[] {
  const file = process.env.BUGFIX_ALLOWLIST_FILE?.trim() || 'bugfix-allowlist.json';
  const resolved = path.resolve(process.cwd(), file);

  if (fs.existsSync(resolved)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } catch (e) {
      throw new Error(`代码修改白名单文件不是合法 JSON ${resolved}: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`代码修改白名单文件应为字符串数组 ${resolved}`);
    }
    return parsed.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
  }

  return parseAllowlistEnv(process.env.BUGFIX_ALLOWLIST);
}

export const codeWriteAllowlist: string[] = loadAllowlist();

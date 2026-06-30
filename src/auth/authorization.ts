/**
 * 代码修改授权：部门白名单为主、open_id 白名单兜底。
 * Authorization for code-modifying actions. 设计对齐 docs/development-plan.md M6-B / configuration.md §2.2。
 *
 * 加载优先级（文件 > 内联 env > 空）：
 * - open_id 白名单：BUGFIX_ALLOWLIST_FILE（默认 bugfix-allowlist.json）/ BUGFIX_ALLOWLIST
 * - 部门白名单：    BUGFIX_ALLOWED_DEPARTMENTS_FILE（默认 bugfix-allowed-departments.json）/ BUGFIX_ALLOWED_DEPARTMENTS
 *
 * **fail-closed**：两者都空 → 拒绝所有人。
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

/** 仅 open_id 维度（保留以兼容/单独使用）。 */
export function canModifyCode(userId: string, allowlist: string[]): boolean {
  return allowlist.length > 0 && allowlist.includes(userId);
}

/** 综合判定：open_id 命中 或 用户部门 ∩ 允许部门 ≠ ∅。两者皆空则拒绝（fail-closed）。 */
export function isAuthorizedToModify(opts: {
  userId: string;
  departmentIds: string[];
  openIdAllowlist: string[];
  allowedDepartments: string[];
}): boolean {
  if (opts.openIdAllowlist.includes(opts.userId)) return true;
  if (opts.allowedDepartments.length > 0 && opts.departmentIds.some((d) => opts.allowedDepartments.includes(d))) {
    return true;
  }
  return false;
}

function loadStringList(fileEnvKey: string, defaultFile: string, inlineEnvKey: string): string[] {
  const file = process.env[fileEnvKey]?.trim() || defaultFile;
  const resolved = path.resolve(process.cwd(), file);

  if (fs.existsSync(resolved)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    } catch (e) {
      throw new Error(`配置文件不是合法 JSON ${resolved}: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`配置文件应为字符串数组 ${resolved}`);
    }
    return parsed.map(String).map((s) => s.trim()).filter((s) => s.length > 0);
  }

  return parseAllowlistEnv(process.env[inlineEnvKey]);
}

export const codeWriteAllowlist: string[] = loadStringList(
  'BUGFIX_ALLOWLIST_FILE',
  'bugfix-allowlist.json',
  'BUGFIX_ALLOWLIST'
);

export const allowedDepartments: string[] = loadStringList(
  'BUGFIX_ALLOWED_DEPARTMENTS_FILE',
  'bugfix-allowed-departments.json',
  'BUGFIX_ALLOWED_DEPARTMENTS'
);

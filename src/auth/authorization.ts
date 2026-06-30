/**
 * 授权：
 * - 代码修改（写）：部门白名单为主、open_id 白名单兜底。对齐 configuration.md §2.2。
 * - 代码理解（只读阅读源码）：群(chat_id) 白名单 或 个人(open_id) 白名单。对齐 configuration.md §2.3。
 *
 * 加载优先级（文件 > 内联 env > 空）：
 * - 修改-open_id 白名单：BUGFIX_ALLOWLIST_FILE（默认 bugfix-allowlist.json）/ BUGFIX_ALLOWLIST
 * - 修改-部门白名单：    BUGFIX_ALLOWED_DEPARTMENTS_FILE（默认 bugfix-allowed-departments.json）/ BUGFIX_ALLOWED_DEPARTMENTS
 * - 阅读-群白名单：      CODE_READ_ALLOWED_CHATS_FILE（默认 code-read-allowed-chats.json）/ CODE_READ_ALLOWED_CHATS
 * - 阅读-open_id 白名单：CODE_READ_ALLOWLIST_FILE（默认 code-read-allowlist.json）/ CODE_READ_ALLOWLIST
 *
 * **fail-closed**：相关名单都空 → 拒绝所有人。
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

/**
 * 代码理解（只读阅读源码）访问授权：消息所在群 chat_id 命中群白名单 或 触发人 open_id 命中人员白名单 → 放行；
 * 两份名单皆空 → 拒绝所有人（fail-closed）。只按「群 / 人」维度，不涉及部门。
 */
export function isAuthorizedToRead(opts: {
  userId: string;
  chatId: string;
  openIdAllowlist: string[];
  allowedChats: string[];
}): boolean {
  if (opts.openIdAllowlist.includes(opts.userId)) return true;
  if (opts.allowedChats.includes(opts.chatId)) return true;
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

/** 代码理解（只读）群白名单：群内任何人可阅读源码。 */
export const codeReadAllowedChats: string[] = loadStringList(
  'CODE_READ_ALLOWED_CHATS_FILE',
  'code-read-allowed-chats.json',
  'CODE_READ_ALLOWED_CHATS'
);

/** 代码理解（只读）个人 open_id 白名单：含单聊/任意群。 */
export const codeReadAllowlist: string[] = loadStringList(
  'CODE_READ_ALLOWLIST_FILE',
  'code-read-allowlist.json',
  'CODE_READ_ALLOWLIST'
);

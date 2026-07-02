/**
 * 授权：
 * - 代码修改（写）：部门白名单为主、人员白名单（open_id 或邮箱）兜底。对齐 configuration.md §2.2。
 * - 代码理解（只读阅读源码）：群(chat_id) 白名单 或 人员白名单（open_id 或邮箱）。对齐 configuration.md §2.3。
 *
 * 人员名单条目格式（可混用）：含 `@` 视为邮箱（忽略大小写比对，需通讯录邮箱字段权限）；其余视为 open_id。
 * 群名单仍用 chat_id（`oc_...`）。
 *
 * 加载优先级（文件 > 内联 env > 空）：
 * - 修改-人员白名单：BUGFIX_ALLOWLIST_FILE（默认 bugfix-allowlist.json）/ BUGFIX_ALLOWLIST
 * - 修改-部门白名单：BUGFIX_ALLOWED_DEPARTMENTS_FILE（默认 bugfix-allowed-departments.json）/ BUGFIX_ALLOWED_DEPARTMENTS
 * - 阅读-群白名单：  CODE_READ_ALLOWED_CHATS_FILE（默认 code-read-allowed-chats.json）/ CODE_READ_ALLOWED_CHATS
 * - 阅读-人员白名单：CODE_READ_ALLOWLIST_FILE（默认 code-read-allowlist.json）/ CODE_READ_ALLOWLIST
 *
 * **fail-closed**：相关名单都空 → 拒绝所有人；邮箱解析失败 → 邮箱维度不命中。
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

/** 人员名单拆分：含 `@` 的按邮箱（小写归一），其余按 open_id。 */
export function splitUserEntries(list: string[]): { openIds: string[]; emails: string[] } {
  const openIds: string[] = [];
  const emails: string[] = [];
  for (const raw of list) {
    const entry = raw.trim();
    if (entry === '') continue;
    if (entry.includes('@')) emails.push(entry.toLowerCase());
    else openIds.push(entry);
  }
  return { openIds, emails };
}

/** 人员命中：open_id 精确匹配 或 邮箱忽略大小写匹配（email 未解析到则邮箱维度不命中）。 */
function matchesUser(allowlist: string[], userId: string, email: string | undefined): boolean {
  const { openIds, emails } = splitUserEntries(allowlist);
  if (openIds.includes(userId)) return true;
  if (email && emails.includes(email.trim().toLowerCase())) return true;
  return false;
}

/** 仅 open_id 维度（保留以兼容/单独使用）。 */
export function canModifyCode(userId: string, allowlist: string[]): boolean {
  return allowlist.length > 0 && allowlist.includes(userId);
}

/** 综合判定：人员名单（open_id/邮箱）命中 或 用户部门 ∩ 允许部门 ≠ ∅。两者皆空则拒绝（fail-closed）。 */
export function isAuthorizedToModify(opts: {
  userId: string;
  /** 已解析的用户邮箱；取不到传 undefined（邮箱维度按不命中处理）。 */
  email?: string;
  departmentIds: string[];
  /** 人员白名单：open_id 或邮箱，可混用。 */
  allowlist: string[];
  allowedDepartments: string[];
}): boolean {
  if (matchesUser(opts.allowlist, opts.userId, opts.email)) return true;
  if (opts.allowedDepartments.length > 0 && opts.departmentIds.some((d) => opts.allowedDepartments.includes(d))) {
    return true;
  }
  return false;
}

/**
 * 代码理解（只读阅读源码）访问授权：消息所在群 chat_id 命中群白名单 或
 * 触发人命中人员白名单（open_id 或邮箱）→ 放行；两份名单皆空 → 拒绝所有人（fail-closed）。
 * 只按「群 / 人」维度，不涉及部门。
 */
export function isAuthorizedToRead(opts: {
  userId: string;
  /** 已解析的用户邮箱；取不到传 undefined。 */
  email?: string;
  chatId: string;
  /** 人员白名单：open_id 或邮箱，可混用。 */
  allowlist: string[];
  /** 群白名单：chat_id。 */
  allowedChats: string[];
}): boolean {
  if (matchesUser(opts.allowlist, opts.userId, opts.email)) return true;
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

/** 代码修改人员白名单（open_id 或邮箱）。 */
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

/** 代码理解（只读）群白名单（chat_id）：群内任何人可阅读源码。 */
export const codeReadAllowedChats: string[] = loadStringList(
  'CODE_READ_ALLOWED_CHATS_FILE',
  'code-read-allowed-chats.json',
  'CODE_READ_ALLOWED_CHATS'
);

/** 代码理解（只读）人员白名单（open_id 或邮箱）：含单聊/任意群。 */
export const codeReadAllowlist: string[] = loadStringList(
  'CODE_READ_ALLOWLIST_FILE',
  'code-read-allowlist.json',
  'CODE_READ_ALLOWLIST'
);

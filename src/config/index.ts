/**
 * 应用配置装载。
 * Loads configuration from environment variables (.env).
 *
 * 设计对齐 docs/configuration.md。
 * - 数值类环境变量非法时**显式抛错**（No hidden errors）。
 * - 必填项缺失的校验在各功能真正启用时进行（见 assertRequired），
 *   以保证 M0 空骨架在没有 .env 的情况下也能启动。
 */

import dotenv from 'dotenv';

// 先加载 .env，再用 .env.local 覆盖（本地私密配置，已被 .gitignore 忽略）。
// Load .env first, then override with .env.local (git-ignored local secrets).
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

function str(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`环境变量 ${key} 必须是整数，实际为: ${v}`);
  return n;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const normalized = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`环境变量 ${key} 必须是布尔值(true/false)，实际为: ${v}`);
}

function float(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`环境变量 ${key} 必须是数字，实际为: ${v}`);
  return n;
}

const llmModel = str('LLM_MODEL');

export const config = {
  feishu: {
    appId: str('APP_ID'),
    appSecret: str('APP_SECRET'),
    domain: str('LARK_DOMAIN', 'https://open.feishu.cn'),
  },
  llm: {
    provider: str('LLM_PROVIDER', 'deepseek'),
    baseUrl: str('LLM_BASE_URL'),
    apiKey: str('LLM_API_KEY'),
    model: llmModel,
    intentModel: str('INTENT_MODEL') || llmModel,
    intentMinConfidence: float('INTENT_MIN_CONFIDENCE', 0.5),
  },
  cli: {
    provider: str('CLI_PROVIDER', 'claude'),
    bin: str('CLI_BIN'),
    // 只读代码理解超时（默认 5 分钟）。
    timeoutMs: int('CLI_TIMEOUT_MS', 300000),
    // Bug 修复（写）超时（默认 20 分钟，定位+修改更耗时）。
    bugfixTimeoutMs: int('BUGFIX_TIMEOUT_MS', 1200000),
    // Bug 修复 worktree 基目录（默认系统临时目录）。会展开为长路径，避开 Windows 8.3 短名。
    worktreeDir: str('WORKTREE_DIR'),
  },
  gitlab: {
    baseUrl: str('GITLAB_BASE_URL'),
    token: str('GITLAB_TOKEN'),
    defaultBaseBranch: str('GIT_DEFAULT_BASE_BRANCH', 'test'),
    fixBranchPrefix: str('FIX_BRANCH_PREFIX', 'fix/'),
  },
  dify: {
    baseUrl: str('DIFY_BASE_URL'),
    apiKey: str('DIFY_API_KEY'),
  },
  service: {
    port: int('PORT', 3000),
    sessionMaxTurns: int('SESSION_MAX_TURNS', 10),
    logLevel: str('LOG_LEVEL', 'info'),
  },
  session: {
    // 是否把会话上下文持久化到 SQLite（false=纯内存，进程重启即丢）。
    persist: bool('SESSION_PERSIST', false),
    // SQLite 文件路径（git 忽略）。
    dbFile: str('SESSION_DB_FILE', 'session.db'),
    // 每个会话(chatId)在库中的归档消息硬上限，超出裁掉最旧。
    storeMaxMessages: int('SESSION_STORE_MAX_MESSAGES', 200),
    // 超过该天数的消息按 created_at 清理；0=不按时间清理。
    retentionDays: int('SESSION_RETENTION_DAYS', 365),
  },
} as const;

export type AppConfig = typeof config;

/**
 * 在功能启用前校验必填项；缺失即显式抛错（不静默兜底）。
 * Assert required env keys are present before a feature starts.
 */
export function assertRequired(entries: Array<[name: string, value: string]>): void {
  const missing = entries.filter(([, value]) => value.trim() === '').map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`缺少必填配置: ${missing.join(', ')}（见 docs/configuration.md）`);
  }
}

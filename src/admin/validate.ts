/**
 * config-ui 受管文件清单与保存前校验。
 * Managed-file list and pre-save validation for the config UI.
 * 设计对齐 docs/config-ui.md §3；projects/usermap 的形状对齐 src/config/projects.ts。
 */

export type FileKind = 'env' | 'projects' | 'usermap' | 'stringArray';

export interface ManagedFile {
  name: string;
  kind: FileKind;
  /** 页面上显示的用途说明。 */
  label: string;
}

/** 文件名白名单：config-ui 只读写这 7 个文件，不接受任意路径。 */
export const MANAGED_FILES: readonly ManagedFile[] = [
  { name: '.env', kind: 'env', label: '环境变量（密钥、开关、超时等，见 docs/configuration.md）' },
  { name: 'projects.json', kind: 'projects', label: '项目注册表：别名 → 容器内路径（CLI 安全边界）' },
  { name: 'usermap.json', kind: 'usermap', label: '飞书 open_id → GitLab 用户映射（建 MR 指派用）' },
  { name: 'bugfix-allowlist.json', kind: 'stringArray', label: '代码修改授权：open_id 白名单（兜底）' },
  { name: 'bugfix-allowed-departments.json', kind: 'stringArray', label: '代码修改授权：部门 id 白名单（主）' },
  { name: 'code-read-allowlist.json', kind: 'stringArray', label: '代码理解授权：open_id 白名单' },
  { name: 'code-read-allowed-chats.json', kind: 'stringArray', label: '代码理解授权：群 chat_id 白名单' },
] as const;

const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function validateEnv(content: string): string | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!ENV_LINE.test(line)) {
      return `第 ${i + 1} 行不是合法的 KEY=VALUE 格式: ${line}`;
    }
  }
  return null;
}

function parseJson(content: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(content) };
  } catch (e) {
    return { error: `不是合法 JSON: ${(e as Error).message}` };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateProjects(content: string): string | null {
  const { value, error } = parseJson(content);
  if (error) return error;
  if (!isPlainObject(value)) return '顶层必须是 JSON 对象（别名 → 项目配置）';

  let defaults = 0;
  for (const [alias, raw] of Object.entries(value)) {
    if (alias.startsWith('_')) continue; // _comment 等说明字段
    if (!isPlainObject(raw)) return `项目 "${alias}" 必须是对象`;
    if (typeof raw.path !== 'string' || raw.path.trim() === '') {
      return `项目 "${alias}" 缺少非空字符串 path`;
    }
    if (raw.default !== undefined && typeof raw.default !== 'boolean') {
      return `项目 "${alias}" 的 default 必须是布尔值`;
    }
    if (raw.gitlabProjectId !== undefined && typeof raw.gitlabProjectId !== 'string') {
      return `项目 "${alias}" 的 gitlabProjectId 必须是字符串`;
    }
    if (raw.baseBranch !== undefined && typeof raw.baseBranch !== 'string') {
      return `项目 "${alias}" 的 baseBranch 必须是字符串`;
    }
    if (raw.default === true) defaults++;
  }
  if (defaults > 1) return `最多只允许一个项目设 default: true（当前 ${defaults} 个）`;
  return null;
}

function validateUserMap(content: string): string | null {
  const { value, error } = parseJson(content);
  if (error) return error;
  if (!isPlainObject(value)) return '顶层必须是 JSON 对象（open_id → GitLab 用户）';

  for (const [openId, raw] of Object.entries(value)) {
    if (openId.startsWith('_')) continue;
    if (!isPlainObject(raw)) return `"${openId}" 的值必须是对象`;
    if (!Number.isInteger(raw.gitlabUserId)) return `"${openId}" 的 gitlabUserId 必须是整数`;
    if (typeof raw.gitlabUsername !== 'string' || raw.gitlabUsername.trim() === '') {
      return `"${openId}" 缺少非空字符串 gitlabUsername`;
    }
  }
  return null;
}

function validateStringArray(content: string): string | null {
  const { value, error } = parseJson(content);
  if (error) return error;
  if (!Array.isArray(value)) return '必须是 JSON 数组';
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || value[i].trim() === '') {
      return `第 ${i + 1} 个元素必须是非空字符串`;
    }
  }
  return null;
}

/** 按文件类型校验内容；返回 null 表示通过，否则为错误信息。 */
export function validateContent(kind: FileKind, content: string): string | null {
  switch (kind) {
    case 'env':
      return validateEnv(content);
    case 'projects':
      return validateProjects(content);
    case 'usermap':
      return validateUserMap(content);
    case 'stringArray':
      return validateStringArray(content);
  }
}

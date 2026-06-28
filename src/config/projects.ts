/**
 * 项目注册表 + 飞书用户 → GitLab 用户映射。
 * Project registry and Feishu-user → GitLab-user mapping.
 *
 * 设计对齐 docs/configuration.md §2 / §2.1。
 * 注册表是 CLI 执行的安全边界：CLI 只能在注册过的目录内运行。
 */

export interface ProjectConfig {
  /** 本地仓库绝对路径（安全边界） / Local repo absolute path. */
  path: string;
  /** 未指定项目时使用 / Used when no project is specified. */
  default?: boolean;
  /** GitLab 项目路径或数字 ID，建 MR 用 / GitLab project path or numeric id. */
  gitlabProjectId?: string;
  /** 测试分支，BugFix 从此切出并作为 MR target / Test branch. */
  baseBranch?: string;
}

export type ProjectRegistry = Record<string, ProjectConfig>;

export interface GitlabUser {
  gitlabUserId: number;
  gitlabUsername: string;
}

export type UserMap = Record<string, GitlabUser>;

function parseJsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`环境变量 ${key} 不是合法 JSON: ${(e as Error).message}`);
  }
}

export const projects: ProjectRegistry = parseJsonEnv<ProjectRegistry>('PROJECTS_JSON', {});
export const userMap: UserMap = parseJsonEnv<UserMap>('USER_MAP_JSON', {});

export function listProjectAliases(): string[] {
  return Object.keys(projects);
}

export function getProject(alias: string): ProjectConfig | undefined {
  return projects[alias];
}

export function getDefaultProject(): { alias: string; config: ProjectConfig } | undefined {
  for (const [alias, cfg] of Object.entries(projects)) {
    if (cfg.default) return { alias, config: cfg };
  }
  return undefined;
}

export function getGitlabUser(feishuOpenId: string): GitlabUser | undefined {
  return userMap[feishuOpenId];
}

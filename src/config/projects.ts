/**
 * 项目注册表 + 飞书用户 → GitLab 用户映射。
 * Project registry and Feishu-user → GitLab-user mapping.
 *
 * 设计对齐 docs/configuration.md §2 / §2.1。
 * 注册表是 CLI 执行的安全边界：CLI 只能在注册过的目录内运行。
 *
 * 加载优先级（显式，缺/坏即抛错，不静默兜底）：
 * 1. 文件：PROJECTS_FILE（默认 projects.json）/ USER_MAP_FILE（默认 usermap.json），存在即用；
 * 2. 否则用内联环境变量 PROJECTS_JSON / USER_MAP_JSON；
 * 3. 都没有则为空。
 */

import fs from 'fs';
import path from 'path';

export interface ProjectConfig {
  /** 本地仓库绝对路径（安全边界） / Local repo absolute path. */
  path: string;
  /** 未指定项目时使用 / Used when no project is specified. */
  default?: boolean;
  /** GitLab 项目路径或数字 ID，建 MR 用 / GitLab project path or numeric id. */
  gitlabProjectId?: string;
  /** 测试/集成分支，BugFix 从此切出并作为 MR target / Base branch. */
  baseBranch?: string;
}

export type ProjectRegistry = Record<string, ProjectConfig>;

export interface GitlabUser {
  gitlabUserId: number;
  gitlabUsername: string;
}

export type UserMap = Record<string, GitlabUser>;

function loadJsonConfig<T>(fileEnvKey: string, defaultFile: string, inlineEnvKey: string, fallback: T): T {
  const filePath = process.env[fileEnvKey]?.trim() || defaultFile;
  const resolved = path.resolve(process.cwd(), filePath);

  if (fs.existsSync(resolved)) {
    let raw: string;
    try {
      raw = fs.readFileSync(resolved, 'utf-8');
    } catch (e) {
      throw new Error(`读取配置文件失败 ${resolved}: ${(e as Error).message}`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      throw new Error(`配置文件不是合法 JSON ${resolved}: ${(e as Error).message}`);
    }
  }

  const inline = process.env[inlineEnvKey];
  if (inline && inline.trim() !== '') {
    try {
      return JSON.parse(inline) as T;
    } catch (e) {
      throw new Error(`环境变量 ${inlineEnvKey} 不是合法 JSON: ${(e as Error).message}`);
    }
  }

  return fallback;
}

export const projects: ProjectRegistry = loadJsonConfig<ProjectRegistry>(
  'PROJECTS_FILE',
  'projects.json',
  'PROJECTS_JSON',
  {}
);

export const userMap: UserMap = loadJsonConfig<UserMap>('USER_MAP_FILE', 'usermap.json', 'USER_MAP_JSON', {});

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

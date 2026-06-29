/**
 * Bug 修复相关的纯文本构造（分支名 / 提交信息 / 提示词 / MR 描述）。便于测试。
 * 设计对齐 docs/handlers.md §3。
 */

import { GitlabUser } from '../config/projects';

export function slugify(task: string): string {
  const ascii = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.slice(0, 30) || 'auto';
}

export function shortId(now: number = Date.now(), rnd: () => number = Math.random): string {
  const t = now.toString(36).slice(-4);
  const r = Math.floor(rnd() * 1296)
    .toString(36)
    .padStart(2, '0');
  return `${t}${r}`;
}

export function buildFixBranch(
  task: string,
  prefix = 'fix/',
  idGen: () => string = () => shortId()
): string {
  return `${prefix}${slugify(task)}-${idGen()}`;
}

export function buildCommitMessage(task: string): string {
  const subject = task.replace(/\s+/g, ' ').trim().slice(0, 72);
  return `fix: ${subject}`;
}

export function buildBugfixPrompt(task: string): string {
  return [
    '请在当前所在仓库中定位并修复下面描述的问题。要求：',
    '- 先找到根本原因，再做最小必要改动修复。',
    '- 直接修改相关源码文件（你处于可编辑模式）。',
    '- 不要执行 git 提交或推送（外层会处理提交与 Merge Request）。',
    '- 修复完成后，用简洁中文总结：根因、改了哪些文件、修复方式。',
    '',
    `问题：${task}`,
  ].join('\n');
}

export function buildMrDescription(
  task: string,
  summary: string,
  feishuUserId: string,
  gitlabUser?: GitlabUser
): string {
  const trigger = gitlabUser ? `${feishuUserId} → @${gitlabUser.gitlabUsername}` : `${feishuUserId}（无 GitLab 映射）`;
  return [
    `**Bug**: ${task}`,
    '',
    `**触发人(飞书)**: ${trigger}`,
    '',
    '**修复摘要（由 Claude 生成）**:',
    summary.trim().slice(0, 3000) || '（无摘要）',
    '',
    '---',
    '由 FeiShuBot 自动创建，请 review。',
  ].join('\n');
}

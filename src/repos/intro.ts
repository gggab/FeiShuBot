/**
 * 工程简介文件的 frontmatter 读写 + 「按变更量」更新决策（纯函数）。
 * 设计对齐 docs/handlers.md §9.3。
 *
 * 简介文件形如：
 *   ---
 *   alias: room
 *   repo: /repos/std-smart-office-room
 *   commit: <生成时的完整 SHA>
 *   generatedAt: <ISO 时间>
 *   ---
 *   <codex 写的简介正文>
 */

export interface IntroMeta {
  alias: string;
  repo: string;
  /** 生成/更新简介时仓库 HEAD 的完整 SHA，作为下次 diff 的基线。 */
  commit: string;
  /** ISO 时间戳。 */
  generatedAt: string;
}

export interface ParsedIntro {
  meta: Partial<IntroMeta>;
  body: string;
}

/** 组装简介文件内容（frontmatter + 正文）。 */
export function formatIntro(meta: IntroMeta, body: string): string {
  const fm = [
    '---',
    `alias: ${meta.alias}`,
    `repo: ${meta.repo}`,
    `commit: ${meta.commit}`,
    `generatedAt: ${meta.generatedAt}`,
    '---',
  ].join('\n');
  return `${fm}\n\n${body.trim()}\n`;
}

/** 解析简介文件：提取 frontmatter 与正文；无 frontmatter 时 meta 为空、body 为原文。 */
export function parseIntro(raw: string): ParsedIntro {
  const text = raw.replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };

  const meta: Partial<IntroMeta> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (key === 'alias' || key === 'repo' || key === 'commit' || key === 'generatedAt') {
      meta[key] = value;
    }
  }
  return { meta, body: m[2].trim() };
}

/** git diff --stat 汇总（改动文件数与增删行数）。 */
export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export type IntroAction = 'skip' | 'update' | 'regenerate';

export interface RegenThresholds {
  files: number;
  lines: number;
}

/**
 * 决定简介更新动作：
 * - 无改动 → skip；
 * - 改动文件数 ≥ files 或 增删行数合计 ≥ lines → regenerate（整份重写）；
 * - 其余 → update（增量修订）。
 */
export function decideIntroAction(diff: DiffStat, thresholds: RegenThresholds): IntroAction {
  if (diff.filesChanged <= 0 && diff.insertions <= 0 && diff.deletions <= 0) return 'skip';
  const totalLines = diff.insertions + diff.deletions;
  if (diff.filesChanged >= thresholds.files || totalLines >= thresholds.lines) return 'regenerate';
  return 'update';
}

/**
 * 解析 `git diff --shortstat` 输出，形如：
 *   ` 3 files changed, 12 insertions(+), 4 deletions(-)`
 * 缺省项按 0 处理；空串（无改动）→ 全 0。
 */
export function parseShortStat(out: string): DiffStat {
  const files = out.match(/(\d+)\s+files?\s+changed/);
  const ins = out.match(/(\d+)\s+insertions?\(\+\)/);
  const del = out.match(/(\d+)\s+deletions?\(-\)/);
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

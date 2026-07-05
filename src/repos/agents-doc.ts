/**
 * 生成 reposRoot/AGENTS.md 与 CLAUDE.md 内容（纯函数）。设计对齐 docs/handlers.md §9.1/§9.2。
 *
 * AGENTS.md 是 codex 在 /repos 作用域内的路由说明：别名→目录→简介索引 + 硬约束。
 * 自动生成，请勿手改。CLAUDE.md 仅 `@AGENTS.md` 引用同一份内容。
 */

import { RoutingEntry } from './scope';

/** 标记：codex 在正文末尾用它声明最终依据的工程。系统据此采样版本、并剥离该行。 */
export const PROJECT_DECL_MARKER = '__PROJECT__';

const GENERATED_NOTICE = '<!-- 由 FeiShuBot 自动生成，请勿手改；改注册表或简介后会被覆盖 -->';

/** 生成 AGENTS.md 内容。 */
export function buildAgentsDoc(entries: RoutingEntry[], introsDirName: string): string {
  const rows = entries.map((e) => `| \`${e.alias}\` | ${e.repoPath} | ${e.introRel} |`).join('\n');
  return [
    '# 工程路由索引（/repos 作用域）',
    '',
    GENERATED_NOTICE,
    '',
    '你当前的工作目录是本目录，下面有多个 git 仓库（工程）。回答用户问题前，**先确定用户指的是哪个工程**。',
    '',
    '## 规则',
    '',
    `1. 先阅读下表每个工程的「简介」文件（目录 \`${introsDirName}/\`），理解各工程职责，据此判断用户问的是哪个工程。用户可能用完整仓库名（如 \`std-smart-office-room\`）或短别名（\`room\`）指代。`,
    '2. 只做**只读**分析，禁止修改任何文件。**允许跨工程阅读**：当问题涉及前后端联动的完整链路时（例如前端 `xxx-frontend` 与其对应后端服务），可以同时只读阅读相关的多个工程，把端到端逻辑讲清楚；但要聚焦相关工程，不要翻与问题无关的工程。',
    `3. 正文最后**单独一行**输出：\`${PROJECT_DECL_MARKER}: <别名>\`，声明你依据的工程；跨工程时列出**全部**依据的工程、用逗号分隔（如 \`${PROJECT_DECL_MARKER}: portal, user\`）。取下表「别名」列的值。这行由系统解析后移除，不必向用户解释。`,
    '4. 若无法确定是哪个工程，选最相关的一个并照常声明；实在无法判断时，也要输出一行说明并省略声明。',
    '',
    '## 工程清单',
    '',
    '| 别名 | 目录 | 简介 |',
    '|------|------|------|',
    rows,
    '',
  ].join('\n');
}

/** 生成 CLAUDE.md 内容（复用同一份，Claude Code 走 @import）。 */
export function buildClaudeDoc(): string {
  return ['# CLAUDE.md', '', GENERATED_NOTICE, '', '@AGENTS.md', ''].join('\n');
}

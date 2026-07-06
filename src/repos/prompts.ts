/**
 * codex/claude 提示词（/repos 作用域路由 + 简介维护）。设计对齐 docs/handlers.md §9.2/§9.3。
 * 抽成纯函数便于测试与统一维护。
 */

import { PROJECT_DECL_MARKER } from './agents-doc';

/** 代码理解：在 /repos 作用域内先定位工程、只读作答、末尾声明工程。 */
export function buildRoutingReadPrompt(task: string): string {
  return [
    '你在一个包含多个 git 仓库（工程）的目录中工作。先阅读本目录的 AGENTS.md 与其中列出的各工程「简介」，',
    '判断用户的问题指向哪个工程（用户可能用完整仓库名或短别名指代）。',
    '要求：',
    '- 只做**只读**分析，禁止修改任何文件。',
    '- **允许跨工程阅读**：若问题涉及前后端联动的完整链路（如前端与其后端服务），可同时只读阅读相关的多个工程把端到端逻辑讲清楚；但聚焦相关工程，不要翻无关工程。',
    '- 用与用户提问相同的语言、简洁地说明实现逻辑，并给出关键代码位置（文件路径:行号）。',
    `- 正文最后**单独一行**输出：\`${PROJECT_DECL_MARKER}: <别名>\`，声明你依据的工程；跨工程时列出全部、用逗号分隔（取 AGENTS.md 清单中的「别名」）。`,
    '',
    `问题：${task}`,
  ].join('\n');
}

/** BugFix 前置路由：只判定工程别名，尽量不长篇分析。 */
export function buildRoutingLocatePrompt(task: string): string {
  return [
    '你在一个包含多个 git 仓库（工程）的目录中工作。阅读本目录 AGENTS.md 与各工程「简介」，',
    '判断下面的诉求应落在哪个工程上（用户可能用完整仓库名或短别名指代）。',
    '只需判定工程，不要动手改代码、不必展开实现分析。',
    `最后**单独一行**输出：\`${PROJECT_DECL_MARKER}: <别名>\`（取 AGENTS.md 清单中的「别名」）。`,
    '',
    `诉求：${task}`,
  ].join('\n');
}

/** 首次生成某工程简介：只读该仓库，只输出简介正文。 */
export function buildIntroGenPrompt(alias: string): string {
  return [
    `请只读阅读当前仓库（工程别名：${alias}）的源码，写一份简明的**工程简介**，供后续快速判断"用户问题属于哪个工程"之用。`,
    '覆盖：① 工程职责/主要功能；② 关键模块与目录结构；③ 技术栈/框架；④ 对外入口或接口（如有）。',
    '要求：中文、300~600 字、**只输出简介正文**，不要寒暄、不要前后缀说明、不要用代码块包裹整段。禁止修改任何文件。',
  ].join('\n');
}

/** 增量更新某工程简介：给出旧简介与改动摘要，只输出修订后的简介正文。 */
export function buildIntroUpdatePrompt(alias: string, oldBody: string, diffStat: string): string {
  return [
    `工程别名：${alias}。下面是它现有的简介，以及自上次生成以来的代码改动摘要（git diff --stat）。`,
    '请只读阅读相关改动涉及的源码，**在原简介基础上做必要修订**（结构/职责/技术栈若有变化则更新），保持简明。',
    '要求：中文、300~600 字、**只输出修订后的简介正文**，不要前后缀说明、不要代码块包裹整段。禁止修改任何文件。',
    '',
    '=== 现有简介 ===',
    oldBody.trim() || '（无）',
    '',
    '=== 改动摘要（git diff --stat）===',
    diffStat.trim() || '（无）',
  ].join('\n');
}

/**
 * 从 codex 输出解析工程声明 `__PROJECT__: <别名>[, <别名> …]`（纯函数）。
 * 设计对齐 docs/handlers.md §9.2。
 *
 * codex 在正文末尾单独一行声明它依据的工程（允许跨工程 → 多个，逗号分隔）；
 * 系统据此采样版本作页脚，并把声明行从展示正文中剥离。声明缺失/别名非法 → 空，页脚降级。
 */

import { PROJECT_DECL_MARKER } from './agents-doc';

// 匹配声明行并捕获冒号后的剩余部分（容忍加粗/反引号包裹标记、半/全角冒号）。
const DECL_LINE = new RegExp(`^\\s*[*\`]*\\s*${PROJECT_DECL_MARKER}\\s*[*\`]*\\s*[:：]\\s*(.+)$`, 'i');
// 别名之间的分隔符：空白、半/全角逗号、顿号、竖线，以及 markdown 修饰符 * ` 。
const SEP = /[\s,，、|`*]+/;

/**
 * 解析声明的**全部**合法别名（按出现顺序去重）。跨工程时可能多个；
 * 校验每个 token 在 aliases 内，返回规范别名（大小写按 aliases 写法）。
 */
export function parseDeclaredProjects(output: string, aliases: string[]): string[] {
  const canon = new Map(aliases.map((a) => [a.toLowerCase(), a]));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(DECL_LINE);
    if (!m) continue;
    for (const tok of m[1].split(SEP)) {
      if (tok === '') continue;
      const c = canon.get(tok.toLowerCase());
      if (c && !seen.has(c)) {
        seen.add(c);
        result.push(c);
      }
    }
  }
  return result;
}

/** 单个「主工程」别名（取第一个合法声明）：供必须落在唯一工程上的场景（如 BugFix）。 */
export function parseDeclaredProject(output: string, aliases: string[]): string | undefined {
  return parseDeclaredProjects(output, aliases)[0];
}

/** 从展示正文中剥离所有 `__PROJECT__` 声明行（不改其余内容）。 */
export function stripDeclaration(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => !DECL_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

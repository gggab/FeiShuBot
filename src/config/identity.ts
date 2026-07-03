/**
 * 助手身份装载：从 IDENTITY.md 顶部 frontmatter 读取「名字 / 描述」。
 * Loads assistant identity (name / description) from IDENTITY.md frontmatter.
 *
 * IDENTITY.md 是助手身份的事实来源；frontmatter 是代码读取的机器可读契约。
 * 缺文件 / 缺 frontmatter / 缺字段一律**显式抛错**（No hidden errors，不静默兜底）。
 *
 * 加载路径：IDENTITY_FILE（默认 IDENTITY.md），从 process.cwd() 解析。
 */

import fs from 'fs';
import path from 'path';

export interface Identity {
  /** 助手名字，如 "Sahib" / Assistant name. */
  name: string;
  /** 助手自述（用于系统提示词） / Self-description used in the system prompt. */
  description: string;
}

/**
 * 解析 Markdown 顶部 YAML frontmatter 里的简单 `key: value` 对。
 * 仅支持单行标量值（可带引号）；契约足够明确，不引入 YAML 依赖。
 */
function parseFrontmatter(raw: string, source: string): Record<string, string> {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    throw new Error(`身份文件缺少 frontmatter 起始 '---'：${source}`);
  }

  const fields: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') return fields; // frontmatter 结束
    if (line.trim() === '') continue;

    const idx = line.indexOf(':');
    if (idx === -1) {
      throw new Error(`身份文件 frontmatter 行缺少 ':'：「${line}」（${source}）`);
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  throw new Error(`身份文件 frontmatter 未闭合（缺少结束 '---'）：${source}`);
}

/**
 * 从 IDENTITY.md 原始文本解析助手身份（纯函数，无 IO）；缺 frontmatter/字段即显式抛错。
 * 运行时装载与 config-ui 保存前校验共用同一套解析，避免规则漂移。
 */
export function parseIdentity(raw: string, source = 'IDENTITY.md'): Identity {
  const fields = parseFrontmatter(raw, source);
  const name = fields.name?.trim() ?? '';
  const description = fields.description?.trim() ?? '';
  if (name === '') throw new Error(`身份文件缺少 name 字段：${source}`);
  if (description === '') throw new Error(`身份文件缺少 description 字段：${source}`);
  return { name, description };
}

/**
 * 从 IDENTITY.md 装载助手身份；缺文件/字段即显式抛错。
 */
export function loadIdentity(): Identity {
  const filePath = process.env.IDENTITY_FILE?.trim() || 'IDENTITY.md';
  const resolved = path.resolve(process.cwd(), filePath);

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf-8');
  } catch (e) {
    throw new Error(`读取身份文件失败 ${resolved}: ${(e as Error).message}（见 IDENTITY.md）`);
  }

  return parseIdentity(raw, resolved);
}

/**
 * 由身份构造普通聊天的系统提示词。
 * Build the chat system prompt from the assistant identity.
 */
export function buildChatSystemPrompt(identity: Identity): string {
  return (
    `你叫 ${identity.name}，${identity.description}` +
    `当用户问起你的名字时，回答你叫 ${identity.name}。请用简洁、友好的中文回答用户的问题。`
  );
}

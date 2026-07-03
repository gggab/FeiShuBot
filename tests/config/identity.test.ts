import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadIdentity, buildChatSystemPrompt } from '../../src/config/identity';

const tmpFiles: string[] = [];

/** 写一个临时 IDENTITY 文件，并把 IDENTITY_FILE 指向它。 */
function useIdentityFile(content: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-'));
  const file = path.join(dir, 'IDENTITY.md');
  fs.writeFileSync(file, content, 'utf-8');
  tmpFiles.push(file);
  process.env.IDENTITY_FILE = file;
}

afterEach(() => {
  delete process.env.IDENTITY_FILE;
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('loadIdentity', () => {
  it('解析 frontmatter 的 name / description', () => {
    useIdentityFile('---\nname: Sahib\ndescription: 是一个飞书智能助手。\n---\n\n# 正文\n');
    expect(loadIdentity()).toEqual({ name: 'Sahib', description: '是一个飞书智能助手。' });
  });

  it('去除值两侧的引号', () => {
    useIdentityFile('---\nname: "Sahib"\ndescription: \'是助手。\'\n---\n');
    expect(loadIdentity()).toEqual({ name: 'Sahib', description: '是助手。' });
  });

  it('文件不存在时显式抛错', () => {
    process.env.IDENTITY_FILE = path.join(os.tmpdir(), 'does-not-exist-xyz', 'IDENTITY.md');
    expect(() => loadIdentity()).toThrow(/读取身份文件失败/);
  });

  it('缺少 frontmatter 起始 --- 时抛错', () => {
    useIdentityFile('# 没有 frontmatter\nname: Sahib\n');
    expect(() => loadIdentity()).toThrow(/frontmatter 起始/);
  });

  it('frontmatter 未闭合时抛错', () => {
    useIdentityFile('---\nname: Sahib\ndescription: x\n');
    expect(() => loadIdentity()).toThrow(/未闭合/);
  });

  it('缺少 name 字段时抛错', () => {
    useIdentityFile('---\ndescription: 只有描述\n---\n');
    expect(() => loadIdentity()).toThrow(/缺少 name/);
  });

  it('缺少 description 字段时抛错', () => {
    useIdentityFile('---\nname: Sahib\n---\n');
    expect(() => loadIdentity()).toThrow(/缺少 description/);
  });
});

describe('buildChatSystemPrompt', () => {
  it('提示词里带名字（两处）与描述', () => {
    const prompt = buildChatSystemPrompt({ name: 'Sahib', description: '是一个飞书智能助手。' });
    expect(prompt).toContain('你叫 Sahib，是一个飞书智能助手。');
    expect(prompt).toContain('回答你叫 Sahib');
  });
});

import { describe, it, expect } from 'vitest';
import {
  slugify,
  shortId,
  buildFixBranch,
  buildCommitMessage,
  buildMrDescription,
} from '../../src/handlers/bugfix-naming';

describe('bugfix naming', () => {
  it('slugify 英文转 kebab，中文回退 auto', () => {
    expect(slugify('Fix Login Error')).toBe('fix-login-error');
    expect(slugify('修复登录报错')).toBe('auto');
    expect(slugify('  ')).toBe('auto');
  });

  it('shortId 确定性可注入', () => {
    expect(shortId(0, () => 0)).toBe('000');
  });

  it('buildFixBranch 拼出前缀+slug+id', () => {
    const b = buildFixBranch('Fix Login', 'fix/', () => 'abcd');
    expect(b).toBe('fix/fix-login-abcd');
  });

  it('buildCommitMessage 用 fix: 前缀并截断', () => {
    expect(buildCommitMessage('登录页报错')).toBe('fix: 登录页报错');
    expect(buildCommitMessage('x'.repeat(100)).length).toBe('fix: '.length + 72);
  });

  it('buildMrDescription 含触发人映射与摘要', () => {
    const withMap = buildMrDescription('bug', '改了 a.ts', 'ou_1', {
      gitlabUserId: 9,
      gitlabUsername: 'zhangsan',
    });
    expect(withMap).toContain('@zhangsan');
    expect(withMap).toContain('改了 a.ts');
    const noMap = buildMrDescription('bug', 's', 'ou_2');
    expect(noMap).toContain('无 GitLab 映射');
  });
});

import { describe, it, expect } from 'vitest';
import { buildClaudeArgs } from '../../src/cli/claude';

describe('buildClaudeArgs', () => {
  it('read 模式：print + 只读工具，不允许编辑', () => {
    const args = buildClaudeArgs({ cwd: '/x', prompt: 'explain login', mode: 'read' });
    expect(args).toContain('-p');
    expect(args).toContain('explain login');
    expect(args.join(' ')).toContain('--allowedTools Read Grep Glob');
    expect(args).not.toContain('acceptEdits');
  });

  it('write 模式：允许编辑', () => {
    const args = buildClaudeArgs({ cwd: '/x', prompt: 'fix bug', mode: 'write' });
    expect(args.join(' ')).toContain('--permission-mode acceptEdits');
  });

  it('prompt 作为独立参数传递（不拼 shell）', () => {
    const prompt = 'a; rm -rf / "quoted"';
    const args = buildClaudeArgs({ cwd: '/x', prompt, mode: 'read' });
    expect(args).toContain(prompt);
  });
});

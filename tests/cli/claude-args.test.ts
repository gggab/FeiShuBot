import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, parseClaudeStream } from '../../src/cli/claude';

describe('buildClaudeArgs', () => {
  it('read 模式：stream-json + 只读工具，不允许编辑', () => {
    const args = buildClaudeArgs({ cwd: '/x', prompt: 'explain login', mode: 'read' });
    expect(args).toContain('-p');
    expect(args).toContain('explain login');
    expect(args.join(' ')).toContain('--output-format stream-json --verbose');
    expect(args.join(' ')).toContain('--allowedTools Read Grep Glob');
    expect(args).not.toContain('acceptEdits');
  });

  it('write 模式：允许编辑并限定读+编辑工具', () => {
    const args = buildClaudeArgs({ cwd: '/x', prompt: 'fix bug', mode: 'write' });
    expect(args.join(' ')).toContain('--permission-mode acceptEdits');
    expect(args.join(' ')).toContain('--allowedTools Read Grep Glob Edit Write MultiEdit');
  });

  it('prompt 作为独立参数传递（不拼 shell）', () => {
    const prompt = 'a; rm -rf / "quoted"';
    const args = buildClaudeArgs({ cwd: '/x', prompt, mode: 'read' });
    expect(args).toContain(prompt);
  });
});

async function* lines(...ls: string[]): AsyncIterable<string> {
  for (const l of ls) yield l + '\n';
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of it) out += t;
  return out;
}

describe('parseClaudeStream', () => {
  it('只产出 assistant 文本块，忽略思考/工具/result 重复', async () => {
    const out = await collect(
      parseClaudeStream(
        lines(
          '{"type":"system","subtype":"init","model":"x","tools":[]}',
          '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"想一下"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.ts"}}]}}',
          '{"type":"user","message":{"content":[{"type":"tool_result","content":"some content"}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"答案"}]}}',
          '{"type":"result","subtype":"success","result":"答案","duration_ms":10}'
        )
      )
    );
    expect(out).toBe('答案');
  });

  it('助手无文本时用 result 文本兜底', async () => {
    const out = await collect(parseClaudeStream(lines('{"type":"result","result":"只有结果"}')));
    expect(out).toBe('只有结果');
  });

  it('跨 chunk 的半行能正确缓冲拼接', async () => {
    async function* split(): AsyncIterable<string> {
      yield '{"type":"assist';
      yield 'ant","message":{"content":[{"type":"text","text":"hi"}]}}\n';
    }
    expect(await collect(parseClaudeStream(split()))).toBe('hi');
  });
});

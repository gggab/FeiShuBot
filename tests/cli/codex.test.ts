import { describe, it, expect } from 'vitest';
import { buildCodexArgs, parseCodexStream } from '../../src/cli/codex';

describe('buildCodexArgs', () => {
  it('read 模式：exec --json + 只读沙箱', () => {
    const args = buildCodexArgs({ cwd: '/x', prompt: 'explain login', mode: 'read' });
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args.join(' ')).toContain('--sandbox read-only');
    expect(args[args.length - 1]).toBe('explain login');
  });

  it('write 模式：工作区可写沙箱', () => {
    const args = buildCodexArgs({ cwd: '/x', prompt: 'fix bug', mode: 'write' });
    expect(args.join(' ')).toContain('--sandbox workspace-write');
    expect(args.join(' ')).not.toContain('read-only');
  });

  it('prompt 作为独立参数传递（不拼 shell）', () => {
    const prompt = 'a; rm -rf / "quoted"';
    const args = buildCodexArgs({ cwd: '/x', prompt, mode: 'read' });
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

describe('parseCodexStream', () => {
  it('只产出 agent_message 文本，忽略 reasoning/命令/turn 事件', async () => {
    const out = await collect(
      parseCodexStream(
        lines(
          '{"type":"thread.started","thread_id":"t1"}',
          '{"type":"turn.started"}',
          '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"想一下"}}',
          '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"ls","status":"in_progress"}}',
          '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls","aggregated_output":"src\\n","exit_code":0,"status":"completed"}}',
          '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"答案"}}',
          '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
        )
      )
    );
    expect(out).toBe('答案');
  });

  it('多条 agent_message 依次产出', async () => {
    const out = await collect(
      parseCodexStream(
        lines(
          '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"一"}}',
          '{"type":"item.completed","item":{"id":"b","type":"agent_message","text":"二"}}'
        )
      )
    );
    expect(out).toBe('一二');
  });

  it('跨 chunk 的半行能正确缓冲拼接', async () => {
    async function* split(): AsyncIterable<string> {
      yield '{"type":"item.completed","item":{"id":"a","type":"agent_';
      yield 'message","text":"hi"}}\n';
    }
    expect(await collect(parseCodexStream(split()))).toBe('hi');
  });

  it('turn.failed 显式抛错（进程可能仍以 0 退出，不能吞掉）', async () => {
    await expect(
      collect(parseCodexStream(lines('{"type":"turn.failed","error":{"message":"model stream ended unexpectedly"}}')))
    ).rejects.toThrow(/model stream ended unexpectedly/);
  });

  it('流级 error 事件显式抛错', async () => {
    await expect(
      collect(parseCodexStream(lines('{"type":"error","message":"stream error: broken pipe"}')))
    ).rejects.toThrow(/broken pipe/);
  });

  it('非 JSON 行忽略不抛错', async () => {
    const out = await collect(
      parseCodexStream(
        lines('not json', '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"ok"}}')
      )
    );
    expect(out).toBe('ok');
  });
});

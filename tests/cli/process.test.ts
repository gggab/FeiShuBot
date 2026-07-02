import { describe, it, expect } from 'vitest';
import { spawnStream } from '../../src/cli/process';

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of it) out += t;
  return out;
}

describe('spawnStream', () => {
  it('子进程 stdin 必须已关闭（codex exec 会等 stdin EOF，不关会挂到超时）', async () => {
    // 子进程等 stdin 结束才输出：stdin 未被关闭时本用例会超时失败。
    const out = await collect(
      spawnStream({
        cmd: process.execPath,
        args: ['-e', "process.stdin.on('end',()=>{console.log('stdin-closed')});process.stdin.resume()"],
        cwd: process.cwd(),
        timeoutMs: 10_000,
      })
    );
    expect(out).toContain('stdin-closed');
  }, 15_000);

  it('超时错误包含 stderr（可诊断挂住原因）', async () => {
    await expect(
      collect(
        spawnStream({
          cmd: process.execPath,
          // 超时窗口要给足子进程启动时间：全量测试并发跑时 node 启动可能超过 1-2 秒，
          // 窗口太小会在 stderr 输出前就超时，导致断言偶发失败。
          args: ['-e', "console.error('waiting for something');setTimeout(()=>{},60000)"],
          cwd: process.cwd(),
          timeoutMs: 8_000,
        })
      )
    ).rejects.toThrow(/超时.*waiting for something/s);
  }, 15_000);

  it('非 0 退出码抛错并带 stderr', async () => {
    await expect(
      collect(
        spawnStream({
          cmd: process.execPath,
          args: ['-e', "console.error('boom detail');process.exit(3)"],
          cwd: process.cwd(),
          timeoutMs: 10_000,
        })
      )
    ).rejects.toThrow(/退出码 3.*boom detail/s);
  }, 15_000);
});

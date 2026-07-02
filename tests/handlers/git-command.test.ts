import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseGitCommand, isGitCommand, GitCommandHandler } from '../../src/handlers/git-command';
import { KeyedMutex } from '../../src/util/repo-lock';
import { GitOps, GitRefusedError } from '../../src/git/ops';
import { ReplyStream } from '../../src/handlers/types';
import { ProjectRegistry } from '../../src/config/projects';

describe('isGitCommand', () => {
  it('识别 /git 前缀（后跟空白或结束）', () => {
    expect(isGitCommand('/git')).toBe(true);
    expect(isGitCommand('/git pull')).toBe(true);
    expect(isGitCommand('  /git status portal ')).toBe(true);
    expect(isGitCommand('/gitfoo')).toBe(false);
    expect(isGitCommand('git pull')).toBe(false);
    expect(isGitCommand('讲讲 /git 用法')).toBe(false);
  });
});

describe('parseGitCommand', () => {
  it('help / 空命令', () => {
    expect(parseGitCommand('/git')).toEqual({ op: 'help' });
    expect(parseGitCommand('/git help')).toEqual({ op: 'help' });
  });

  it('pull / status：其后 token 全是项目列表（可空、可多个、可 all）', () => {
    expect(parseGitCommand('/git pull')).toEqual({ op: 'pull', projectTokens: [] });
    expect(parseGitCommand('/git pull portal')).toEqual({ op: 'pull', projectTokens: ['portal'] });
    expect(parseGitCommand('/git pull portal data')).toEqual({ op: 'pull', projectTokens: ['portal', 'data'] });
    expect(parseGitCommand('/git pull all')).toEqual({ op: 'pull', projectTokens: ['all'] });
    expect(parseGitCommand('/git status portal data')).toEqual({ op: 'status', projectTokens: ['portal', 'data'] });
  });

  it('switch：最后一个 token 是 ref，其前是项目列表；checkout 同义', () => {
    expect(parseGitCommand('/git switch main')).toEqual({ op: 'switch', projectTokens: [], ref: 'main' });
    expect(parseGitCommand('/git switch portal v1.2')).toEqual({ op: 'switch', projectTokens: ['portal'], ref: 'v1.2' });
    expect(parseGitCommand('/git switch portal data main')).toEqual({
      op: 'switch',
      projectTokens: ['portal', 'data'],
      ref: 'main',
    });
    expect(parseGitCommand('/git switch all release')).toEqual({ op: 'switch', projectTokens: ['all'], ref: 'release' });
    expect(parseGitCommand('/git checkout portal release')).toEqual({
      op: 'switch',
      projectTokens: ['portal'],
      ref: 'release',
    });
  });

  it('switch 缺 ref / 未知子命令 → error', () => {
    expect(parseGitCommand('/git switch')).toMatchObject({ op: 'error' });
    expect(parseGitCommand('/git frobnicate')).toMatchObject({ op: 'error' });
  });
});

// ---- Handler orchestration（注入替身，不触网） ----

class FakeReply implements ReplyStream {
  pushed: string[] = [];
  final?: string;
  failed?: string;
  push(t: string): void {
    this.pushed.push(t);
  }
  async done(t?: string): Promise<void> {
    this.final = t;
  }
  async fail(m: string): Promise<void> {
    this.failed = m;
  }
}

// resolveProject 会用 fs.existsSync 校验目录存在，故用真实临时目录。
let tmpRoot: string;
let portalPath: string;
let dataPath: string;
let registry: ProjectRegistry;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fbgitcmd-'));
  portalPath = path.join(tmpRoot, 'portal');
  dataPath = path.join(tmpRoot, 'data');
  fs.mkdirSync(portalPath);
  fs.mkdirSync(dataPath);
  registry = {
    portal: { path: portalPath, default: true },
    data: { path: dataPath },
  };
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function makeHandler(opts: {
  allowlist?: string[];
  ops?: Partial<GitOps>;
  reply: FakeReply;
}) {
  const ops: GitOps = {
    version: vi.fn(async () => ({ branch: 'develop', detached: false, sha: 'abc1234', subject: '初始', relDate: '刚刚', dirty: false })),
    pull: vi.fn(async () => ({ branch: 'develop', before: 'abc1234', after: 'def5678', updated: true, subject: '新提交', relDate: '1 分钟前' })),
    switchRef: vi.fn(async () => ({ version: { branch: 'main', detached: false, sha: 'aaa1111', subject: 'm', relDate: '刚刚', dirty: false } })),
    ...opts.ops,
  };
  const handler = new GitCommandHandler(
    registry,
    opts.allowlist ?? ['ou_admin'],
    [],
    null,
    new KeyedMutex(),
    ops,
    async () => opts.reply
  );
  return { handler, ops };
}

describe('GitCommandHandler.run', () => {
  it('未授权 → ⛔ 提示，不执行 ops', async () => {
    const reply = new FakeReply();
    const { handler, ops } = makeHandler({ allowlist: ['ou_admin'], reply });
    await handler.run('ou_stranger', 'oc_x', '/git pull');
    expect(reply.final).toContain('⛔');
    expect(ops.pull).not.toHaveBeenCalled();
  });

  it('授权 pull（默认项目，单个）→ 调 ops.pull 并回报', async () => {
    const reply = new FakeReply();
    const { handler, ops } = makeHandler({ reply });
    await handler.run('ou_admin', 'oc_x', '/git pull');
    expect(ops.pull).toHaveBeenCalledWith(portalPath); // 默认项目
    expect(reply.final).toContain('portal');
    expect(reply.final).toContain('def5678');
    expect(reply.final).not.toContain('📦'); // 单项目无批量标题
  });

  it('switch 指定项目 → 调 ops.switchRef', async () => {
    const reply = new FakeReply();
    const { handler, ops } = makeHandler({ reply });
    await handler.run('ou_admin', 'oc_x', '/git switch data main');
    expect(ops.switchRef).toHaveBeenCalledWith(dataPath, 'main');
    expect(reply.final).toContain('已切换');
    expect(reply.final).toContain('data');
  });

  it('pull all → 两个项目并发执行，汇总成一张卡片', async () => {
    const reply = new FakeReply();
    const { handler, ops } = makeHandler({ reply });
    await handler.run('ou_admin', 'oc_x', '/git pull all');
    expect(ops.pull).toHaveBeenCalledTimes(2);
    expect(ops.pull).toHaveBeenCalledWith(portalPath);
    expect(ops.pull).toHaveBeenCalledWith(dataPath);
    expect(reply.final).toContain('📦 批量拉取（2 个项目）');
    expect(reply.final).toContain('portal');
    expect(reply.final).toContain('data');
  });

  it('批量中单个被拒 → 只影响那一行，其余照常', async () => {
    const reply = new FakeReply();
    const { handler } = makeHandler({
      reply,
      ops: {
        pull: vi.fn(async (p: string) => {
          if (p === dataPath) throw new GitRefusedError('工作区有未提交改动');
          return { branch: 'develop', before: 'abc1234', after: 'def5678', updated: true, subject: 'x', relDate: '刚刚' };
        }),
      },
    });
    await handler.run('ou_admin', 'oc_x', '/git pull portal data');
    expect(reply.final).toContain('✅ portal');
    expect(reply.final).toContain('⚠️ data');
    expect(reply.failed).toBeUndefined();
  });

  it('未知项目 → 显式提示可用项目，不执行 ops', async () => {
    const reply = new FakeReply();
    const { handler, ops } = makeHandler({ reply });
    await handler.run('ou_admin', 'oc_x', '/git pull nope');
    expect(reply.final).toContain('未找到项目');
    expect(ops.pull).not.toHaveBeenCalled();
  });

  it('GitRefusedError → 以 ⚠️ 提示（reply.done，非 fail）', async () => {
    const reply = new FakeReply();
    const { handler } = makeHandler({
      reply,
      ops: { pull: vi.fn(async () => { throw new GitRefusedError('工作区有未提交改动'); }) },
    });
    await handler.run('ou_admin', 'oc_x', '/git pull');
    expect(reply.final).toContain('⚠️');
    expect(reply.final).toContain('未提交改动');
    expect(reply.failed).toBeUndefined();
  });

  it('其它异常 → 收敛为 ❌ 结果行（reply.done，不整体 fail）', async () => {
    const reply = new FakeReply();
    const { handler } = makeHandler({
      reply,
      ops: { pull: vi.fn(async () => { throw new Error('网络炸了'); }) },
    });
    await handler.run('ou_admin', 'oc_x', '/git pull');
    expect(reply.final).toContain('❌');
    expect(reply.final).toContain('网络炸了');
    expect(reply.failed).toBeUndefined();
  });

  it('help → 回用法', async () => {
    const reply = new FakeReply();
    const { handler } = makeHandler({ reply });
    await handler.run('ou_admin', 'oc_x', '/git');
    expect(reply.final).toContain('用法');
  });
});

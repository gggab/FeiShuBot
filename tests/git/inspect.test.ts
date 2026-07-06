import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getRepoVersion, formatVersionFooter, RepoVersion } from '../../src/git/inspect';

function run(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

describe('formatVersionFooter (纯函数)', () => {
  const base: RepoVersion = { branch: 'develop', detached: false, sha: 'abc1234', subject: '修复登录', relDate: '2 天前', dirty: false };

  it('普通分支', () => {
    expect(formatVersionFooter('portal', base)).toBe('📌 基于 **portal** · 分支 `develop` · 提交 `abc1234`（修复登录，2 天前）');
  });

  it('工作区脏 → 追加警告', () => {
    expect(formatVersionFooter('portal', { ...base, dirty: true })).toContain('⚠️ 工作区有未提交改动');
  });

  it('游离在 tag 上', () => {
    const v: RepoVersion = { ...base, branch: '', detached: true, tag: 'v1.0' };
    expect(formatVersionFooter('portal', v)).toContain('tag `v1.0`');
  });

  it('游离且不在任何 tag 上', () => {
    const v: RepoVersion = { ...base, branch: '', detached: true, tag: undefined };
    expect(formatVersionFooter('portal', v)).toContain('游离 HEAD');
  });

  it('英文变体（lang=en）', () => {
    const v: RepoVersion = { ...base, subject: 'fix login', relDate: '2 days ago' };
    expect(formatVersionFooter('portal', v, 'en')).toBe(
      '📌 Based on **portal** · branch `develop` · commit `abc1234` (fix login, 2 days ago)'
    );
  });
});

describe('getRepoVersion (临时仓库集成)', () => {
  let repo: string;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fbinspect-'));
    run(['init', '-b', 'main', '.'], repo);
    // 关掉 CRLF 转换，避免 Windows 下 status 把 README 误判为已修改（dirty 抖动）。
    fs.writeFileSync(path.join(repo, '.gitattributes'), '* -text\n');
    fs.writeFileSync(path.join(repo, 'README.md'), '# base\n');
    run(['add', '-A'], repo);
    // 内联身份，避免并行下 `git config` 写 .git/config 的瞬时文件锁（Windows）。
    run(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init commit'], repo);
    run(['tag', 'v1.0'], repo);
  });

  afterAll(() => {
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('分支上：branch/sha/subject 正确，dirty=false', async () => {
    const v = await getRepoVersion(repo);
    expect(v.branch).toBe('main');
    expect(v.detached).toBe(false);
    expect(v.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(v.subject).toBe('init commit');
    expect(v.dirty).toBe(false);
  });

  it('有未提交改动 → dirty=true', async () => {
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x\n');
    const v = await getRepoVersion(repo);
    expect(v.dirty).toBe(true);
    fs.rmSync(path.join(repo, 'dirty.txt'));
  });

  it('checkout 到 tag → detached 且识别出 tag 名', async () => {
    run(['checkout', 'v1.0'], repo);
    const v = await getRepoVersion(repo);
    expect(v.detached).toBe(true);
    expect(v.tag).toBe('v1.0');
    run(['checkout', 'main'], repo);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GitWorkspace } from '../../src/git/workspace';

/**
 * 在临时目录搭一个「裸仓库(origin) + 克隆(work)」，全程本地、不触网、不碰公司仓库，
 * 验证 worktree 修复流程：fetch → createWorktree → 改动 → commit → push → cleanup。
 */
function run(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

let root: string;
let originPath: string;
let workPath: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fbws-'));
  originPath = path.join(root, 'origin.git');
  workPath = path.join(root, 'work');

  fs.mkdirSync(originPath);
  run(['init', '--bare', '-b', 'develop', '.'], originPath);

  run(['clone', originPath, workPath], root);
  run(['config', 'user.email', 'test@example.com'], workPath);
  run(['config', 'user.name', 'Test'], workPath);
  run(['checkout', '-b', 'develop'], workPath);
  fs.writeFileSync(path.join(workPath, 'README.md'), '# base\n');
  run(['add', '-A'], workPath);
  run(['commit', '-m', 'init'], workPath);
  run(['push', '-u', 'origin', 'develop'], workPath);
});

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('GitWorkspace (worktree 流程)', () => {
  it('fetch → worktree → 改动 → commit → push → cleanup', async () => {
    const ws = new GitWorkspace(workPath);
    const wt = path.join(root, 'wt-fix');
    const branch = 'fix/test-abcd';

    await ws.fetch();
    await ws.createWorktree(wt, branch, 'develop');
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true);

    // 无改动时
    expect(await ws.hasChanges(wt)).toBe(false);

    // 制造一处改动
    fs.writeFileSync(path.join(wt, 'fix.txt'), 'patched\n');
    expect(await ws.hasChanges(wt)).toBe(true);
    expect(await ws.changedFiles(wt)).toHaveLength(1);

    await ws.commitAll(wt, 'fix: add fix.txt');
    await ws.push(wt, branch);

    // origin 上应已存在该分支
    const ref = run(['rev-parse', '--verify', `refs/heads/${branch}`], originPath).trim();
    expect(ref).toMatch(/^[0-9a-f]{40}$/);

    await ws.cleanup(wt, branch);
    // worktree 目录已移除
    expect(fs.existsSync(wt)).toBe(false);
    // 用户的 work 仓库当前分支仍是 develop（未被打扰）
    expect(run(['rev-parse', '--abbrev-ref', 'HEAD'], workPath).trim()).toBe('develop');
  }, 60000);
});

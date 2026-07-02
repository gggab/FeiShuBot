import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defaultGitOps, GitRefusedError } from '../../src/git/ops';

/**
 * 本地「裸仓库(origin) + 克隆(work)」，全程本地不触网，验证 pull / switchRef 行为。
 */
function run(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

let root: string;
let originPath: string;
let pusherPath: string;
let workPath: string;

// 提交时内联身份，避免并行下 `git config` 写 .git/config 的瞬时文件锁（Windows）。
function commit(cwd: string, msg: string): void {
  run(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', msg], cwd);
}

function commitAndPush(cwd: string, file: string, content: string, msg: string, branch = 'develop'): void {
  fs.writeFileSync(path.join(cwd, file), content);
  run(['add', '-A'], cwd);
  commit(cwd, msg);
  run(['push', 'origin', branch], cwd);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fbops-'));
  originPath = path.join(root, 'origin.git');
  pusherPath = path.join(root, 'pusher');
  workPath = path.join(root, 'work');

  fs.mkdirSync(originPath);
  run(['init', '--bare', '-b', 'develop', '.'], originPath);

  // pusher：初始化 develop + feature 分支 + v1.0 tag，推到 origin。
  run(['clone', originPath, pusherPath], root);
  run(['checkout', '-b', 'develop'], pusherPath);
  // 关掉 CRLF 转换，避免 Windows 下 status 把文件误判为已修改（脏工作区抖动）。
  fs.writeFileSync(path.join(pusherPath, '.gitattributes'), '* -text\n');
  commitAndPush(pusherPath, 'README.md', '# base\n', 'init');
  run(['tag', 'v1.0'], pusherPath);
  run(['push', 'origin', 'v1.0'], pusherPath);
  run(['checkout', '-b', 'feature'], pusherPath);
  commitAndPush(pusherPath, 'feat.txt', 'feature\n', 'feat', 'feature');
  run(['checkout', 'develop'], pusherPath);

  // work：使用者的本地克隆，停在 develop。
  run(['clone', originPath, workPath], root);
  run(['checkout', 'develop'], workPath);
});

afterAll(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('defaultGitOps.pull', () => {
  it('远端有新提交 → 快进更新，updated=true', async () => {
    const before = run(['rev-parse', '--short', 'HEAD'], workPath).trim();
    // 远端推进一条新提交
    commitAndPush(pusherPath, 'a.txt', 'aaa\n', 'add a', 'develop');

    const r = await defaultGitOps.pull(workPath);
    expect(r.branch).toBe('develop');
    expect(r.updated).toBe(true);
    expect(r.before).toBe(before);
    expect(r.after).not.toBe(before);
    expect(run(['rev-parse', '--short', 'HEAD'], workPath).trim()).toBe(r.after);
  }, 30000);

  it('已是最新 → updated=false', async () => {
    const r = await defaultGitOps.pull(workPath);
    expect(r.updated).toBe(false);
  }, 30000);

  it('工作区有未提交改动 → 拒绝（GitRefusedError），不改动 HEAD', async () => {
    const head = run(['rev-parse', 'HEAD'], workPath).trim();
    fs.writeFileSync(path.join(workPath, 'dirty.txt'), 'x\n');
    await expect(defaultGitOps.pull(workPath)).rejects.toBeInstanceOf(GitRefusedError);
    expect(run(['rev-parse', 'HEAD'], workPath).trim()).toBe(head);
    fs.rmSync(path.join(workPath, 'dirty.txt'));
  }, 30000);
});

describe('defaultGitOps.switchRef', () => {
  it('切到远端分支 → 在该分支上（非游离）', async () => {
    const r = await defaultGitOps.switchRef(workPath, 'feature');
    expect(r.version.detached).toBe(false);
    expect(r.version.branch).toBe('feature');
    await defaultGitOps.switchRef(workPath, 'develop'); // 复位
  }, 30000);

  it('切到 tag → 游离 HEAD 且识别 tag', async () => {
    const r = await defaultGitOps.switchRef(workPath, 'v1.0');
    expect(r.version.detached).toBe(true);
    expect(r.version.tag).toBe('v1.0');
    await defaultGitOps.switchRef(workPath, 'develop'); // 复位
  }, 30000);

  it('工作区有未提交改动 → 拒绝切换', async () => {
    fs.writeFileSync(path.join(workPath, 'dirty.txt'), 'x\n');
    await expect(defaultGitOps.switchRef(workPath, 'feature')).rejects.toBeInstanceOf(GitRefusedError);
    fs.rmSync(path.join(workPath, 'dirty.txt'));
  }, 30000);
});

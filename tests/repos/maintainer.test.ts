import { describe, it, expect, beforeEach } from 'vitest';
import { IntroMaintainer, IntroFs, GitFn } from '../../src/repos/maintainer';
import { CliRunner, CliTask } from '../../src/cli/runner';
import { ProjectRegistry } from '../../src/config/projects';
import { formatIntro, parseIntro } from '../../src/repos/intro';

/** 内存 fs 假实现。 */
function makeFs(seed: Record<string, string> = {}): IntroFs & { files: Record<string, string> } {
  const files = { ...seed };
  return {
    files,
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    writeFileSync: (p, data) => {
      files[p] = data;
    },
    mkdirSync: () => undefined,
  };
}

/** 记录调用的假 CLI runner；每次 run 产出固定文本。 */
function makeRunner(output: string): CliRunner & { calls: CliTask[] } {
  const calls: CliTask[] = [];
  return {
    name: 'codex',
    calls,
    async *run(task: CliTask) {
      calls.push(task);
      yield output;
    },
  };
}

const registry: ProjectRegistry = {
  room: { path: '/repos/std-smart-office-room' },
};

const reposRoot = '/repos';
const introsDirName = '.agent-intros';
const introFile = '/repos/.agent-intros/room.md';
const thresholds = { files: 8, lines: 400 };

function makeMaintainer(fs: IntroFs, runner: CliRunner, git: GitFn) {
  return new IntroMaintainer({
    runner,
    reposRoot,
    registry,
    introsDirName,
    thresholds,
    timeoutMs: 1000,
    git,
    fs,
    now: () => new Date('2026-07-05T00:00:00.000Z'),
  });
}

const gitOk: GitFn = async (args) => {
  if (args[0] === 'rev-parse') return 'newshaaaaaaaaaaaa\n';
  return '';
};

describe('writeAgentsDocs', () => {
  it('写 AGENTS.md 与 CLAUDE.md', () => {
    const fs = makeFs();
    makeMaintainer(fs, makeRunner('x'), gitOk).writeAgentsDocs();
    expect(fs.files['/repos/AGENTS.md']).toContain('| `room` | /repos/std-smart-office-room | .agent-intros/room.md |');
    expect(fs.files['/repos/CLAUDE.md']).toContain('@AGENTS.md');
  });

  it('内容未变 → 跳过写入（不重复覆盖）', () => {
    const fs = makeFs();
    let writes = 0;
    const spied: IntroFs = { ...fs, writeFileSync: (p, d) => { writes++; fs.writeFileSync(p, d); } };
    const m = makeMaintainer(spied, makeRunner('x'), gitOk);
    m.writeAgentsDocs();
    expect(writes).toBe(2); // 首次：AGENTS.md + CLAUDE.md
    m.writeAgentsDocs();
    expect(writes).toBe(2); // 第二次内容一致 → 不再写
  });
});

describe('ensureIntro', () => {
  it('缺失 → 生成并落盘（含 frontmatter 与 HEAD SHA）', async () => {
    const fs = makeFs();
    const runner = makeRunner('会议室工程简介');
    await makeMaintainer(fs, runner, gitOk).ensureIntro('room');
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].cwd).toBe('/repos/std-smart-office-room');
    expect(runner.calls[0].mode).toBe('read');
    const parsed = parseIntro(fs.files[introFile]);
    expect(parsed.meta.commit).toBe('newshaaaaaaaaaaaa');
    expect(parsed.body).toBe('会议室工程简介');
  });

  it('已存在 → 不重复生成', async () => {
    const fs = makeFs({ [introFile]: 'x' });
    const runner = makeRunner('不该被调用');
    await makeMaintainer(fs, runner, gitOk).ensureIntro('room');
    expect(runner.calls).toHaveLength(0);
  });
});

describe('refreshIntro', () => {
  const existing = formatIntro(
    { alias: 'room', repo: '/repos/std-smart-office-room', commit: 'oldsha', generatedAt: 'x' },
    '旧简介'
  );

  it('无改动 → skip（不调用 CLI，不改文件）', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('不该被调用');
    const git: GitFn = async (args) => (args[0] === 'diff' ? '' : 'sha');
    await makeMaintainer(fs, runner, git).refreshIntro('room');
    expect(runner.calls).toHaveLength(0);
    expect(fs.files[introFile]).toBe(existing);
  });

  it('小改 → update（喂旧简介+diff，覆盖落盘）', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('修订后的简介');
    const git: GitFn = async (args) => {
      if (args[0] === 'rev-parse') return 'newsha';
      return ' 2 files changed, 10 insertions(+), 3 deletions(-)';
    };
    await makeMaintainer(fs, runner, git).refreshIntro('room');
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].prompt).toContain('现有简介');
    expect(parseIntro(fs.files[introFile]).body).toBe('修订后的简介');
  });

  it('大改 → regenerate（生成提示，不含旧简介）', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('重写的简介');
    const git: GitFn = async (args) => {
      if (args[0] === 'rev-parse') return 'newsha';
      return ' 20 files changed, 900 insertions(+), 100 deletions(-)';
    };
    await makeMaintainer(fs, runner, git).refreshIntro('room');
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].prompt).not.toContain('现有简介');
    expect(parseIntro(fs.files[introFile]).body).toBe('重写的简介');
  });

  it('简介无基线 commit → 直接重写', async () => {
    const noCommit = formatIntro(
      { alias: 'room', repo: '/repos/std-smart-office-room', commit: '', generatedAt: 'x' },
      '旧'
    );
    const fs = makeFs({ [introFile]: noCommit });
    const runner = makeRunner('重写');
    await makeMaintainer(fs, runner, gitOk).refreshIntro('room');
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].prompt).not.toContain('现有简介');
  });

  it('基线提交不可达（diff 抛错）→ 重写', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('重写');
    const git: GitFn = async (args) => {
      if (args[0] === 'rev-parse') return 'newsha';
      throw new Error('bad revision');
    };
    await makeMaintainer(fs, runner, git).refreshIntro('room');
    expect(runner.calls).toHaveLength(1);
  });

  it('简介缺失 → 生成', async () => {
    const fs = makeFs();
    const runner = makeRunner('新简介');
    await makeMaintainer(fs, runner, gitOk).refreshIntro('room');
    expect(runner.calls).toHaveLength(1);
    expect(fs.files[introFile]).toBeDefined();
  });

  it('未注册别名 → 无操作', async () => {
    const fs = makeFs();
    const runner = makeRunner('x');
    await makeMaintainer(fs, runner, gitOk).refreshIntro('ghost');
    expect(runner.calls).toHaveLength(0);
  });

  it('游离 HEAD（切到 tag）→ 跳过刷新已有简介', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('不该被调用');
    const git: GitFn = async (args) =>
      args[0] === 'rev-parse' && args[1] === '--abbrev-ref' ? 'HEAD' : 'x';
    await makeMaintainer(fs, runner, git).refreshIntro('room');
    expect(runner.calls).toHaveLength(0);
    expect(fs.files[introFile]).toBe(existing);
  });
});

describe('刷新调度（去抖/节流/单飞）', () => {
  const existing = formatIntro(
    { alias: 'room', repo: '/repos/std-smart-office-room', commit: 'oldsha', generatedAt: 'x' },
    '旧简介'
  );
  // 有实质小改动 → update；abbrev-ref 返回分支名（非游离）。
  const gitSmallChange: GitFn = async (args) => {
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'develop';
    if (args[0] === 'rev-parse') return 'newsha';
    return ' 2 files changed, 10 insertions(+), 0 deletions(-)';
  };

  function throttleMaintainer(fs: IntroFs, runner: CliRunner, nowRef: { t: number }) {
    return new IntroMaintainer({
      runner,
      reposRoot,
      registry,
      introsDirName,
      thresholds,
      timeoutMs: 1000,
      git: gitSmallChange,
      fs,
      now: () => new Date(nowRef.t),
      refreshDebounceMs: 10_000_000, // 定时器不在测试期触发；手动调 flushDirty
      refreshMinIntervalMs: 10_000,
    });
  }

  it('节流窗口内重复标记 → 只刷新一次；过窗后再刷', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('修订');
    const nowRef = { t: 1_000_000 };
    const m = throttleMaintainer(fs, runner, nowRef);

    m.markDirty('room');
    await m.flushDirty();
    expect(runner.calls).toHaveLength(1);

    m.markDirty('room'); // 同一节流窗口内
    await m.flushDirty();
    expect(runner.calls).toHaveLength(1); // 未再刷新

    nowRef.t += 20_000; // 超过 minInterval
    m.markDirty('room');
    await m.flushDirty();
    expect(runner.calls).toHaveLength(2);

    m.dispose();
  });

  it('markDirty 未注册别名 → 不入队', async () => {
    const fs = makeFs({ [introFile]: existing });
    const runner = makeRunner('x');
    const m = throttleMaintainer(fs, runner, { t: 0 });
    m.markDirty('ghost');
    await m.flushDirty();
    expect(runner.calls).toHaveLength(0);
    m.dispose();
  });
});

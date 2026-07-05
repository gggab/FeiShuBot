/**
 * 工程简介维护器：生成 AGENTS.md/CLAUDE.md，懒生成 + 按变更量更新各工程简介。
 * 设计对齐 docs/handlers.md §9.1/§9.3。
 *
 * 关键：codex/claude **只读**输出简介正文；**由本类落盘**（含 frontmatter/SHA），
 * 生成过程不需要写沙箱。git 与 fs 注入以便测试。
 */

import fsDefault from 'fs';
import { CliRunner } from '../cli/runner';
import { ProjectRegistry } from '../config/projects';
import { git as gitDefault } from '../git/run';
import { logger } from '../util/logger';
import { buildAgentsDoc, buildClaudeDoc } from './agents-doc';
import {
  buildRoutingEntries,
  introsDir,
  introPath,
} from './scope';
import {
  formatIntro,
  parseIntro,
  parseShortStat,
  decideIntroAction,
  RegenThresholds,
} from './intro';
import { buildIntroGenPrompt, buildIntroUpdatePrompt } from './prompts';

export type GitFn = (args: string[], cwd: string) => Promise<string>;

export interface IntroFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: BufferEncoding): string;
  writeFileSync(p: string, data: string): void;
  mkdirSync(p: string, opts: { recursive: true }): void;
}

export interface MaintainerOptions {
  runner: CliRunner;
  reposRoot: string;
  registry: ProjectRegistry;
  introsDirName: string;
  thresholds: RegenThresholds;
  /** 简介生成/更新的只读 CLI 超时（复用代码理解超时）。 */
  timeoutMs: number;
  /** 连续 /git 变更的去抖窗口（ms）：窗口内多次触发合并为一次刷新。 */
  refreshDebounceMs?: number;
  /** 单个工程两次刷新的最小间隔（ms）：频繁切换在此窗口内只刷一次。 */
  refreshMinIntervalMs?: number;
  git?: GitFn;
  fs?: IntroFs;
  now?: () => Date;
}

export class IntroMaintainer {
  private readonly runner: CliRunner;
  private readonly reposRoot: string;
  private readonly registry: ProjectRegistry;
  private readonly introsDirName: string;
  private readonly thresholds: RegenThresholds;
  private readonly timeoutMs: number;
  private readonly git: GitFn;
  private readonly fs: IntroFs;
  private readonly now: () => Date;
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;

  // 刷新调度状态（与分支名无关）：去抖合并、节流限频、单飞防并发覆盖。
  private readonly dirty = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly lastRefreshed = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: MaintainerOptions) {
    this.runner = opts.runner;
    this.reposRoot = opts.reposRoot;
    this.registry = opts.registry;
    this.introsDirName = opts.introsDirName;
    this.thresholds = opts.thresholds;
    this.timeoutMs = opts.timeoutMs;
    this.debounceMs = opts.refreshDebounceMs ?? 20_000;
    this.minIntervalMs = opts.refreshMinIntervalMs ?? 600_000;
    this.git = opts.git ?? gitDefault;
    this.fs = opts.fs ?? (fsDefault as unknown as IntroFs);
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * 写 reposRoot/AGENTS.md 与 CLAUDE.md（从注册表生成）。
   * **仅当内容变化才覆盖**：注册表未变（内容一致）则跳过写入，避免每次启动无谓改动文件。
   */
  writeAgentsDocs(): void {
    const entries = buildRoutingEntries(this.registry, this.introsDirName);
    this.ensureDir(this.reposRoot);
    const a = this.writeIfChanged(`${this.reposRoot}/AGENTS.md`, buildAgentsDoc(entries, this.introsDirName));
    const c = this.writeIfChanged(`${this.reposRoot}/CLAUDE.md`, buildClaudeDoc());
    logger.info(
      a || c
        ? `[简介] 已${this.fs.existsSync(`${this.reposRoot}/AGENTS.md`) ? '更新' : '生成'} AGENTS.md/CLAUDE.md（${entries.length} 个工程）`
        : `[简介] AGENTS.md 内容未变，跳过（${entries.length} 个工程）`
    );
  }

  /** 内容与现有文件一致则跳过、返回 false；否则写入、返回 true。 */
  private writeIfChanged(file: string, content: string): boolean {
    try {
      if (this.fs.existsSync(file) && this.fs.readFileSync(file, 'utf-8') === content) return false;
    } catch {
      /* 读失败则照常写 */
    }
    this.fs.writeFileSync(file, content);
    return true;
  }

  /** 启动预热：对所有缺失简介的工程懒生成（逐个 best-effort，失败只记日志）。 */
  async ensureAllIntros(): Promise<void> {
    for (const alias of Object.keys(this.registry)) {
      try {
        await this.ensureIntro(alias);
      } catch (e) {
        logger.warn(`[简介] 预生成「${alias}」失败（忽略）: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 标记某工程「代码已变、待刷新」（供 /git pull|switch 钩子调用）。
   * 不立即刷新——去抖合并连续切换，实际刷新由 flushDirty 在窗口后择机进行。
   */
  markDirty(alias: string): void {
    if (!this.registry[alias]) return;
    this.dirty.add(alias);
    this.armFlush();
  }

  private armFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushDirty();
    }, this.debounceMs);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  /**
   * 处理待刷新工程（去抖窗口后触发，或测试直接调用）：
   * - 单飞：同一工程正在刷新则跳过（保持 dirty，稍后再来）；
   * - 节流：距上次刷新不足 minIntervalMs 则本轮跳过（保持 dirty）；
   * - 串行逐个刷新，避免一次批量切换并发起多个 CLI 打满资源。
   * 仍有 dirty 未处理时再挂一次定时器，等窗口过后重试。
   */
  async flushDirty(): Promise<void> {
    const nowMs = this.now().getTime();
    for (const alias of [...this.dirty]) {
      if (this.inFlight.has(alias)) continue;
      const last = this.lastRefreshed.get(alias) ?? 0;
      if (nowMs - last < this.minIntervalMs) continue;
      this.dirty.delete(alias);
      this.inFlight.add(alias);
      this.lastRefreshed.set(alias, nowMs);
      try {
        await this.refreshIntro(alias);
      } catch (e) {
        logger.warn(`[简介] 刷新「${alias}」失败（忽略）: ${(e as Error).message}`);
      } finally {
        this.inFlight.delete(alias);
      }
    }
    if (this.dirty.size > 0) this.armFlush();
  }

  /** 释放去抖定时器（进程退出/测试清理用）。 */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** 简介缺失才生成；已存在则不动（要按变更量更新用 refreshIntro）。 */
  async ensureIntro(alias: string): Promise<void> {
    const file = introPath(this.reposRoot, this.introsDirName, alias);
    if (this.fs.existsSync(file)) return;
    await this.generate(alias);
  }

  /**
   * 按变更量刷新某工程简介（供 /git pull|switch 钩子调用）：
   * - 无简介 → 生成；
   * - 有简介但无基线 commit / 基线不可达 → 重写；
   * - 否则按 diff --stat 决策 skip/update/regenerate。
   * 任何失败向上抛给调用方决定（钩子里会吞掉只记日志）。
   */
  async refreshIntro(alias: string): Promise<void> {
    const cfg = this.registry[alias];
    if (!cfg) return;
    const file = introPath(this.reposRoot, this.introsDirName, alias);
    if (!this.fs.existsSync(file)) {
      await this.generate(alias); // 缺简介：无论在哪个分支/游离态都先生成（简介与分支无关）
      return;
    }

    // 游离 HEAD（切到 tag/临时提交）通常是「临时看看」，不重写已有简介，避免被临时态污染。
    if (await this.isDetached(cfg.path)) {
      logger.info(`[简介]「${alias}」处于游离 HEAD（tag/临时），跳过刷新`);
      return;
    }

    const { meta, body } = parseIntro(this.fs.readFileSync(file, 'utf-8'));
    if (!meta.commit) {
      await this.generate(alias);
      return;
    }

    let statOut: string;
    try {
      statOut = await this.git(['diff', '--stat', `${meta.commit}..HEAD`], cfg.path);
    } catch (e) {
      logger.info(`[简介]「${alias}」基线提交不可达（${(e as Error).message}），重写`);
      await this.generate(alias);
      return;
    }

    const action = decideIntroAction(parseShortStat(statOut), this.thresholds);
    logger.info(`[简介]「${alias}」变更决策 → ${action}`);
    if (action === 'skip') return;
    if (action === 'regenerate') {
      await this.generate(alias);
    } else {
      await this.update(alias, body, statOut);
    }
  }

  /** 首次/重写：只读读仓库，收集简介正文，落盘（记录当前 HEAD）。 */
  private async generate(alias: string): Promise<void> {
    const cfg = this.registry[alias];
    if (!cfg) return;
    logger.info(`[简介] 生成「${alias}」…`);
    const body = await this.collect(cfg.path, buildIntroGenPrompt(alias));
    await this.writeIntro(alias, cfg.path, body);
  }

  /** 增量更新：带上旧简介与 diff 摘要，只读读仓库，收集修订正文，落盘。 */
  private async update(alias: string, oldBody: string, diffStat: string): Promise<void> {
    const cfg = this.registry[alias];
    if (!cfg) return;
    logger.info(`[简介] 更新「${alias}」…`);
    const body = await this.collect(cfg.path, buildIntroUpdatePrompt(alias, oldBody, diffStat));
    await this.writeIntro(alias, cfg.path, body);
  }

  /** 跑一次只读 CLI，累积输出为纯文本。 */
  private async collect(cwd: string, prompt: string): Promise<string> {
    let acc = '';
    for await (const chunk of this.runner.run({ cwd, prompt, mode: 'read', timeoutMs: this.timeoutMs })) {
      acc += chunk;
    }
    const text = acc.trim();
    if (text === '') throw new Error('CLI 未产出简介文本');
    return text;
  }

  /** 由 bot 落盘简介文件（补 frontmatter + 当前 HEAD SHA）。 */
  private async writeIntro(alias: string, repoPath: string, body: string): Promise<void> {
    let commit = '';
    try {
      commit = (await this.git(['rev-parse', 'HEAD'], repoPath)).trim();
    } catch (e) {
      logger.warn(`[简介]「${alias}」读取 HEAD 失败，commit 留空: ${(e as Error).message}`);
    }
    const dir = introsDir(this.reposRoot, this.introsDirName);
    this.ensureDir(dir);
    const content = formatIntro(
      { alias, repo: repoPath, commit, generatedAt: this.now().toISOString() },
      body
    );
    this.fs.writeFileSync(introPath(this.reposRoot, this.introsDirName, alias), content);
    logger.info(`[简介]「${alias}」已落盘（commit ${commit.slice(0, 7) || '?'}）`);
  }

  /** 是否处于游离 HEAD（切到 tag/裸提交）。读失败按「非游离」处理，不阻断。 */
  private async isDetached(repoPath: string): Promise<boolean> {
    try {
      return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).trim() === 'HEAD';
    } catch {
      return false;
    }
  }

  private ensureDir(dir: string): void {
    try {
      this.fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* 已存在或无需创建 */
    }
  }
}

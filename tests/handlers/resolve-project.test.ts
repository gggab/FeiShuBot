import { describe, it, expect } from 'vitest';
import { resolveProject, resolveProjects, projectLabel } from '../../src/handlers/resolve-project';
import { ProjectRegistry } from '../../src/config/projects';

const always = () => true;

const multi: ProjectRegistry = {
  portal: { path: '/repos/portal', default: true },
  login: { path: '/repos/login' },
};

describe('resolveProject', () => {
  it('指定命中的别名 → 用之', () => {
    const r = resolveProject('login', multi, always);
    expect(r).toMatchObject({ ok: true, alias: 'login' });
  });

  it('指定未命中 → 拒绝并列出可用', () => {
    const r = resolveProject('ghost', multi, always);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('portal');
  });

  it('未指定 → 用 default', () => {
    const r = resolveProject(undefined, multi, always);
    expect(r).toMatchObject({ ok: true, alias: 'portal' });
  });

  it('未指定且无 default 但只有一个 → 用唯一项目', () => {
    const single: ProjectRegistry = { only: { path: '/repos/only' } };
    const r = resolveProject(undefined, single, always);
    expect(r).toMatchObject({ ok: true, alias: 'only' });
  });

  it('未指定且多个无 default → 让用户说明', () => {
    const noDefault: ProjectRegistry = { a: { path: '/a' }, b: { path: '/b' } };
    const r = resolveProject(undefined, noDefault, always);
    expect(r.ok).toBe(false);
  });

  it('空注册表 → 拒绝', () => {
    const r = resolveProject(undefined, {}, always);
    expect(r.ok).toBe(false);
  });

  it('本地目录不存在 → 拒绝', () => {
    const r = resolveProject('portal', multi, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('不存在');
  });
});

describe('projectLabel', () => {
  it('目录名不同于别名 → 「完整名（别名）」', () => {
    expect(projectLabel('portal', 'C:/Users/you/work/std-smart-office-portal')).toBe('std-smart-office-portal（portal）');
  });

  it('目录名与别名相同 → 只显示别名', () => {
    expect(projectLabel('portal', '/repos/portal')).toBe('portal');
  });

  it('反斜杠路径与结尾斜杠都能取到目录名', () => {
    expect(projectLabel('p', 'D:\\work\\my-repo\\')).toBe('my-repo（p）');
  });
});

describe('resolveProjects (批量)', () => {
  it('空 → 默认项目（单个）', () => {
    const r = resolveProjects([], multi, always);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projects.map((p) => p.alias)).toEqual(['portal']);
  });

  it('显式列举多个 → 按序解析', () => {
    const r = resolveProjects(['login', 'portal'], multi, always);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projects.map((p) => p.alias)).toEqual(['login', 'portal']);
  });

  it('去重', () => {
    const r = resolveProjects(['portal', 'portal'], multi, always);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projects.map((p) => p.alias)).toEqual(['portal']);
  });

  it('all（忽略大小写）→ 全部已注册项目', () => {
    const r = resolveProjects(['ALL'], multi, always);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projects.map((p) => p.alias).sort()).toEqual(['login', 'portal']);
  });

  it('任一未命中 → 显式报错（fail fast）', () => {
    const r = resolveProjects(['portal', 'ghost'], multi, always);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('ghost');
  });

  it('空注册表 → 拒绝', () => {
    const r = resolveProjects(['all'], {}, always);
    expect(r.ok).toBe(false);
  });
});

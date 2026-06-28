import { describe, it, expect } from 'vitest';
import { resolveProject } from '../../src/handlers/resolve-project';
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

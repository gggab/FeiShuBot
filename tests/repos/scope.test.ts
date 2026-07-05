import { describe, it, expect } from 'vitest';
import {
  deriveReposRoot,
  resolveReposRoot,
  introsDir,
  introPath,
  introRelPath,
  buildRoutingEntries,
  normalizePath,
} from '../../src/repos/scope';
import { ProjectRegistry } from '../../src/config/projects';

describe('deriveReposRoot', () => {
  it('多仓库 → 公共父目录', () => {
    expect(deriveReposRoot(['/repos/std-smart-office-room', '/repos/std-smart-office-portal'])).toBe('/repos');
  });

  it('单仓库 → 退到父目录', () => {
    expect(deriveReposRoot(['/repos/std-smart-office-room'])).toBe('/repos');
  });

  it('Windows 反斜杠与结尾斜杠归一化', () => {
    expect(deriveReposRoot(['C:\\work\\a\\', 'C:\\work\\b'])).toBe('C:/work');
  });

  it('空注册表 → 抛错', () => {
    expect(() => deriveReposRoot([])).toThrow();
  });

  it('没有可用公共父目录（跨盘符）→ 抛错', () => {
    expect(() => deriveReposRoot(['C:/a/x', 'D:/b/y'])).toThrow(/REPOS_ROOT/);
  });

  it('不同父目录但同一祖父 → 取公共祖父', () => {
    expect(deriveReposRoot(['/w/frontend/portal', '/w/backend/room'])).toBe('/w');
  });
});

describe('resolveReposRoot', () => {
  const reg: ProjectRegistry = {
    room: { path: '/repos/std-smart-office-room' },
    portal: { path: '/repos/std-smart-office-portal', default: true },
  };

  it('override 非空 → 用之（归一化）', () => {
    expect(resolveReposRoot(reg, 'D:\\custom\\repos\\')).toBe('D:/custom/repos');
  });

  it('override 空 → 推导', () => {
    expect(resolveReposRoot(reg, '')).toBe('/repos');
    expect(resolveReposRoot(reg, undefined)).toBe('/repos');
  });
});

describe('简介路径', () => {
  it('introsDir / introPath / introRelPath', () => {
    expect(introsDir('/repos', '.agent-intros')).toBe('/repos/.agent-intros');
    expect(introPath('/repos', '.agent-intros', 'room')).toBe('/repos/.agent-intros/room.md');
    expect(introRelPath('.agent-intros', 'room')).toBe('.agent-intros/room.md');
  });

  it('目录名带多余斜杠也能归一', () => {
    expect(introsDir('/repos/', '/x/')).toBe('/repos/x');
  });
});

describe('buildRoutingEntries', () => {
  it('从注册表构造条目（含归一化路径与简介相对路径）', () => {
    const reg: ProjectRegistry = {
      room: { path: 'C:\\repos\\std-smart-office-room\\' },
    };
    expect(buildRoutingEntries(reg, '.agent-intros')).toEqual([
      { alias: 'room', repoPath: 'C:/repos/std-smart-office-room', introRel: '.agent-intros/room.md' },
    ]);
  });
});

describe('normalizePath', () => {
  it('去结尾斜杠、反斜杠转正斜杠', () => {
    expect(normalizePath('C:\\a\\b\\')).toBe('C:/a/b');
    expect(normalizePath('/')).toBe('/');
  });
});

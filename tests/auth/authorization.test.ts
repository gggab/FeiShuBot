import { describe, it, expect } from 'vitest';
import {
  canModifyCode,
  parseAllowlistEnv,
  splitUserEntries,
  isAuthorizedToModify,
  isAuthorizedToRead,
} from '../../src/auth/authorization';

describe('canModifyCode (open_id, fail-closed)', () => {
  it('名单内 → 允许；名单外/空名单 → 拒绝', () => {
    expect(canModifyCode('ou_a', ['ou_a', 'ou_b'])).toBe(true);
    expect(canModifyCode('ou_x', ['ou_a'])).toBe(false);
    expect(canModifyCode('ou_a', [])).toBe(false);
  });
});

describe('splitUserEntries (open_id / 邮箱混合)', () => {
  it('含 @ 的按邮箱（小写归一），其余按 open_id', () => {
    expect(splitUserEntries(['ou_a', 'Zhang.San@Corp.com', ' ou_b ', 'lisi@corp.com'])).toEqual({
      openIds: ['ou_a', 'ou_b'],
      emails: ['zhang.san@corp.com', 'lisi@corp.com'],
    });
  });

  it('空列表 → 两边皆空', () => {
    expect(splitUserEntries([])).toEqual({ openIds: [], emails: [] });
  });
});

describe('isAuthorizedToModify (部门为主 + open_id/邮箱兜底，fail-closed)', () => {
  it('open_id 命中 → 允许', () => {
    expect(
      isAuthorizedToModify({ userId: 'ou_a', departmentIds: [], allowlist: ['ou_a'], allowedDepartments: [] })
    ).toBe(true);
  });

  it('邮箱命中（忽略大小写）→ 允许', () => {
    expect(
      isAuthorizedToModify({
        userId: 'ou_x',
        email: 'Zhang.San@Corp.com',
        departmentIds: [],
        allowlist: ['zhang.san@corp.com'],
        allowedDepartments: [],
      })
    ).toBe(true);
  });

  it('名单是邮箱但用户邮箱取不到 → 拒绝', () => {
    expect(
      isAuthorizedToModify({
        userId: 'ou_x',
        departmentIds: [],
        allowlist: ['zhang.san@corp.com'],
        allowedDepartments: [],
      })
    ).toBe(false);
  });

  it('部门命中 → 允许', () => {
    expect(
      isAuthorizedToModify({
        userId: 'ou_x',
        departmentIds: ['od-dev', 'od-other'],
        allowlist: [],
        allowedDepartments: ['od-dev'],
      })
    ).toBe(true);
  });

  it('都不命中 → 拒绝', () => {
    expect(
      isAuthorizedToModify({
        userId: 'ou_x',
        email: 'wangwu@corp.com',
        departmentIds: ['od-sales'],
        allowlist: ['ou_a', 'zhang.san@corp.com'],
        allowedDepartments: ['od-dev'],
      })
    ).toBe(false);
  });

  it('两者皆空 → 拒绝所有人（fail-closed）', () => {
    expect(
      isAuthorizedToModify({ userId: 'ou_a', departmentIds: ['od-dev'], allowlist: [], allowedDepartments: [] })
    ).toBe(false);
  });
});

describe('isAuthorizedToRead (群 chat_id 或 人 open_id/邮箱，fail-closed)', () => {
  it('open_id 命中 → 允许', () => {
    expect(isAuthorizedToRead({ userId: 'ou_a', chatId: 'oc_x', allowlist: ['ou_a'], allowedChats: [] })).toBe(true);
  });

  it('邮箱命中（忽略大小写）→ 允许', () => {
    expect(
      isAuthorizedToRead({
        userId: 'ou_x',
        email: 'LiSi@Corp.com',
        chatId: 'oc_x',
        allowlist: ['lisi@corp.com'],
        allowedChats: [],
      })
    ).toBe(true);
  });

  it('chat_id 命中 → 允许（群内任何人）', () => {
    expect(
      isAuthorizedToRead({ userId: 'ou_stranger', chatId: 'oc_dev', allowlist: [], allowedChats: ['oc_dev'] })
    ).toBe(true);
  });

  it('名单是邮箱但用户邮箱取不到 → 拒绝', () => {
    expect(
      isAuthorizedToRead({ userId: 'ou_x', chatId: 'oc_y', allowlist: ['lisi@corp.com'], allowedChats: ['oc_dev'] })
    ).toBe(false);
  });

  it('都不命中 → 拒绝', () => {
    expect(
      isAuthorizedToRead({
        userId: 'ou_x',
        email: 'wangwu@corp.com',
        chatId: 'oc_y',
        allowlist: ['ou_a', 'lisi@corp.com'],
        allowedChats: ['oc_dev'],
      })
    ).toBe(false);
  });

  it('两者皆空 → 拒绝所有人（fail-closed）', () => {
    expect(isAuthorizedToRead({ userId: 'ou_a', chatId: 'oc_x', allowlist: [], allowedChats: [] })).toBe(false);
  });
});

describe('parseAllowlistEnv', () => {
  it('按逗号/空白分隔并去空', () => {
    expect(parseAllowlistEnv('od-a, od-b\nod-c')).toEqual(['od-a', 'od-b', 'od-c']);
    expect(parseAllowlistEnv(undefined)).toEqual([]);
  });
});

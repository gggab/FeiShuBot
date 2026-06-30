import { describe, it, expect } from 'vitest';
import { canModifyCode, parseAllowlistEnv, isAuthorizedToModify, isAuthorizedToRead } from '../../src/auth/authorization';

describe('canModifyCode (open_id, fail-closed)', () => {
  it('名单内 → 允许；名单外/空名单 → 拒绝', () => {
    expect(canModifyCode('ou_a', ['ou_a', 'ou_b'])).toBe(true);
    expect(canModifyCode('ou_x', ['ou_a'])).toBe(false);
    expect(canModifyCode('ou_a', [])).toBe(false);
  });
});

describe('isAuthorizedToModify (部门为主 + open_id 兜底，fail-closed)', () => {
  it('open_id 命中 → 允许', () => {
    expect(
      isAuthorizedToModify({ userId: 'ou_a', departmentIds: [], openIdAllowlist: ['ou_a'], allowedDepartments: [] })
    ).toBe(true);
  });

  it('部门命中 → 允许', () => {
    expect(
      isAuthorizedToModify({
        userId: 'ou_x',
        departmentIds: ['od-dev', 'od-other'],
        openIdAllowlist: [],
        allowedDepartments: ['od-dev'],
      })
    ).toBe(true);
  });

  it('都不命中 → 拒绝', () => {
    expect(
      isAuthorizedToModify({
        userId: 'ou_x',
        departmentIds: ['od-sales'],
        openIdAllowlist: ['ou_a'],
        allowedDepartments: ['od-dev'],
      })
    ).toBe(false);
  });

  it('两者皆空 → 拒绝所有人（fail-closed）', () => {
    expect(
      isAuthorizedToModify({ userId: 'ou_a', departmentIds: ['od-dev'], openIdAllowlist: [], allowedDepartments: [] })
    ).toBe(false);
  });
});

describe('isAuthorizedToRead (群 chat_id 或 人 open_id，fail-closed)', () => {
  it('open_id 命中 → 允许', () => {
    expect(
      isAuthorizedToRead({ userId: 'ou_a', chatId: 'oc_x', openIdAllowlist: ['ou_a'], allowedChats: [] })
    ).toBe(true);
  });

  it('chat_id 命中 → 允许（群内任何人）', () => {
    expect(
      isAuthorizedToRead({ userId: 'ou_stranger', chatId: 'oc_dev', openIdAllowlist: [], allowedChats: ['oc_dev'] })
    ).toBe(true);
  });

  it('都不命中 → 拒绝', () => {
    expect(
      isAuthorizedToRead({ userId: 'ou_x', chatId: 'oc_y', openIdAllowlist: ['ou_a'], allowedChats: ['oc_dev'] })
    ).toBe(false);
  });

  it('两者皆空 → 拒绝所有人（fail-closed）', () => {
    expect(
      isAuthorizedToRead({ userId: 'ou_a', chatId: 'oc_x', openIdAllowlist: [], allowedChats: [] })
    ).toBe(false);
  });
});

describe('parseAllowlistEnv', () => {
  it('按逗号/空白分隔并去空', () => {
    expect(parseAllowlistEnv('od-a, od-b\nod-c')).toEqual(['od-a', 'od-b', 'od-c']);
    expect(parseAllowlistEnv(undefined)).toEqual([]);
  });
});

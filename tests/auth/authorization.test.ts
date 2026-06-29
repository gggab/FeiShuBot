import { describe, it, expect } from 'vitest';
import { canModifyCode, parseAllowlistEnv } from '../../src/auth/authorization';

describe('canModifyCode (fail-closed)', () => {
  it('名单内 → 允许', () => {
    expect(canModifyCode('ou_a', ['ou_a', 'ou_b'])).toBe(true);
  });

  it('名单外 → 拒绝', () => {
    expect(canModifyCode('ou_x', ['ou_a', 'ou_b'])).toBe(false);
  });

  it('空名单 → 拒绝所有人（fail-closed）', () => {
    expect(canModifyCode('ou_a', [])).toBe(false);
  });
});

describe('parseAllowlistEnv', () => {
  it('按逗号/空白分隔并去空', () => {
    expect(parseAllowlistEnv('ou_a, ou_b\nou_c  ou_d')).toEqual(['ou_a', 'ou_b', 'ou_c', 'ou_d']);
  });

  it('空/未定义 → 空数组', () => {
    expect(parseAllowlistEnv(undefined)).toEqual([]);
    expect(parseAllowlistEnv('   ')).toEqual([]);
  });
});

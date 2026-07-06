import { describe, it, expect } from 'vitest';
import { detectLang, pick } from '../../src/util/lang';

describe('detectLang', () => {
  it('含汉字 → zh', () => {
    expect(detectLang('员工登录怎么实现的？')).toBe('zh');
    expect(detectLang('fix 登录 bug')).toBe('zh');
  });

  it('纯英文/数字/符号 → en', () => {
    expect(detectLang('How is employee login implemented?')).toBe('en');
    expect(detectLang('fix bug #123')).toBe('en');
  });
});

describe('pick', () => {
  it('按语言取文案', () => {
    expect(pick('zh', '中', 'en')).toBe('中');
    expect(pick('en', '中', 'en')).toBe('en');
  });
});

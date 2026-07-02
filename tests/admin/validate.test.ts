/**
 * config-ui 校验逻辑测试。设计对齐 docs/config-ui.md §3。
 */

import { describe, it, expect } from 'vitest';
import { MANAGED_FILES, validateContent } from '../../src/admin/validate';

describe('MANAGED_FILES', () => {
  it('恰好管理 7 个部署配置文件', () => {
    expect(MANAGED_FILES.map((f) => f.name)).toEqual([
      '.env',
      'projects.json',
      'usermap.json',
      'bugfix-allowlist.json',
      'bugfix-allowed-departments.json',
      'code-read-allowlist.json',
      'code-read-allowed-chats.json',
    ]);
  });
});

describe('validateContent: env', () => {
  it('接受 KEY=VALUE、注释与空行', () => {
    const content = '# comment\n\nAPP_ID=cli_xxx\nLLM_API_KEY=sk-1\nEMPTY_OK=\n';
    expect(validateContent('env', content)).toBeNull();
  });

  it('拒绝没有等号的行', () => {
    expect(validateContent('env', 'APP_ID cli_xxx')).toMatch(/第 1 行/);
  });

  it('拒绝非法变量名，并报出行号', () => {
    expect(validateContent('env', 'OK=1\n1BAD=x')).toMatch(/第 2 行/);
  });
});

describe('validateContent: projects', () => {
  it('接受合法注册表（含可选字段与 _comment）', () => {
    const content = JSON.stringify({
      _comment: '说明文字',
      portal: { path: '/repos/portal', default: true, gitlabProjectId: 'g/portal', baseBranch: 'develop' },
      data: { path: '/repos/data' },
    });
    expect(validateContent('projects', content)).toBeNull();
  });

  it('拒绝非法 JSON', () => {
    expect(validateContent('projects', '{oops')).toMatch(/JSON/);
  });

  it('拒绝非对象（数组）', () => {
    expect(validateContent('projects', '[]')).toMatch(/对象/);
  });

  it('拒绝缺少 path 的项目', () => {
    expect(validateContent('projects', JSON.stringify({ a: { default: true } }))).toMatch(/path/);
  });

  it('拒绝空字符串 path', () => {
    expect(validateContent('projects', JSON.stringify({ a: { path: '' } }))).toMatch(/path/);
  });

  it('拒绝错误类型的可选字段', () => {
    expect(validateContent('projects', JSON.stringify({ a: { path: '/x', baseBranch: 1 } }))).toMatch(/baseBranch/);
  });

  it('拒绝多个 default: true（隐式取第一个的行为不允许）', () => {
    const content = JSON.stringify({
      a: { path: '/x', default: true },
      b: { path: '/y', default: true },
    });
    expect(validateContent('projects', content)).toMatch(/default/);
  });
});

describe('validateContent: usermap', () => {
  it('接受合法映射', () => {
    const content = JSON.stringify({ ou_1: { gitlabUserId: 12, gitlabUsername: 'zhangsan' } });
    expect(validateContent('usermap', content)).toBeNull();
  });

  it('拒绝非整数 gitlabUserId', () => {
    const content = JSON.stringify({ ou_1: { gitlabUserId: 1.5, gitlabUsername: 'a' } });
    expect(validateContent('usermap', content)).toMatch(/gitlabUserId/);
  });

  it('拒绝缺少 gitlabUsername', () => {
    const content = JSON.stringify({ ou_1: { gitlabUserId: 12 } });
    expect(validateContent('usermap', content)).toMatch(/gitlabUsername/);
  });
});

describe('validateContent: stringArray', () => {
  it('接受字符串数组与空数组', () => {
    expect(validateContent('stringArray', '["ou_a", "ou_b"]')).toBeNull();
    expect(validateContent('stringArray', '[]')).toBeNull();
  });

  it('拒绝非数组', () => {
    expect(validateContent('stringArray', '{}')).toMatch(/数组/);
  });

  it('拒绝空字符串元素与非字符串元素', () => {
    expect(validateContent('stringArray', '[""]')).toMatch(/第 1 个/);
    expect(validateContent('stringArray', '["ok", 3]')).toMatch(/第 2 个/);
  });
});

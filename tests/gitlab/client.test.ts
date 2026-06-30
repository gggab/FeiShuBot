import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildMergeRequestUrl, buildUserSearchUrl, GitLabClient } from '../../src/gitlab/client';

describe('buildMergeRequestUrl', () => {
  it('对 projectId 整体 URL 编码（斜杠变 %2F）', () => {
    const url = buildMergeRequestUrl(
      'https://gitlab.sz.sensetime.com',
      'ksa/standard-smart-office/frontend/std-smart-office-portal'
    );
    expect(url).toBe(
      'https://gitlab.sz.sensetime.com/api/v4/projects/ksa%2Fstandard-smart-office%2Ffrontend%2Fstd-smart-office-portal/merge_requests'
    );
  });

  it('去掉 baseUrl 尾部斜杠', () => {
    const url = buildMergeRequestUrl('https://gitlab.example.com/', '12');
    expect(url).toBe('https://gitlab.example.com/api/v4/projects/12/merge_requests');
  });
});

describe('buildUserSearchUrl', () => {
  it('按 email 搜索并编码', () => {
    expect(buildUserSearchUrl('https://g.com', 'a@b.com')).toBe('https://g.com/api/v4/users?search=a%40b.com');
  });
});

describe('GitLabClient.findUserByEmail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('精确邮箱匹配优先', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { id: 1, username: 'other', email: 'x@b.com' },
          { id: 2, username: 'me', email: 'a@b.com' },
        ],
      }))
    );
    const gl = new GitLabClient('https://g.com', 't');
    expect(await gl.findUserByEmail('a@b.com')).toEqual({ id: 2, username: 'me' });
  });

  it('无结果 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    const gl = new GitLabClient('https://g.com', 't');
    expect(await gl.findUserByEmail('none@b.com')).toBeNull();
  });

  it('邮箱搜不到 → 回退按邮箱前缀(用户名)搜', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 9, username: 'liaowentao', name: 'x' }] });
    vi.stubGlobal('fetch', f);
    const gl = new GitLabClient('https://g.com', 't');
    expect(await gl.findUserByEmail('liaowentao@sensetime.com')).toEqual({ id: 9, username: 'liaowentao' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect } from 'vitest';
import { buildMergeRequestUrl } from '../../src/gitlab/client';

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

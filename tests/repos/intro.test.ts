import { describe, it, expect } from 'vitest';
import {
  formatIntro,
  parseIntro,
  decideIntroAction,
  parseShortStat,
  IntroMeta,
} from '../../src/repos/intro';

const meta: IntroMeta = {
  alias: 'room',
  repo: '/repos/std-smart-office-room',
  commit: 'a1b2c3d4e5f6',
  generatedAt: '2026-07-05T10:00:00.000Z',
};

describe('formatIntro / parseIntro', () => {
  it('往返：format 后 parse 能拿回 meta 与正文', () => {
    const raw = formatIntro(meta, '这是会议室工程，负责……');
    const parsed = parseIntro(raw);
    expect(parsed.meta).toEqual(meta);
    expect(parsed.body).toBe('这是会议室工程，负责……');
  });

  it('无 frontmatter → meta 空、body 为原文', () => {
    const parsed = parseIntro('只有正文没有 frontmatter');
    expect(parsed.meta).toEqual({});
    expect(parsed.body).toBe('只有正文没有 frontmatter');
  });

  it('缺字段容错：只认识已知键', () => {
    const raw = ['---', 'alias: room', 'unknown: x', 'commit: deadbeef', '---', '正文'].join('\n');
    const parsed = parseIntro(raw);
    expect(parsed.meta).toEqual({ alias: 'room', commit: 'deadbeef' });
    expect(parsed.body).toBe('正文');
  });

  it('兼容 CRLF 换行', () => {
    const raw = ['---', 'alias: room', '---', '正文行'].join('\r\n');
    expect(parseIntro(raw).meta.alias).toBe('room');
  });
});

describe('decideIntroAction', () => {
  const th = { files: 8, lines: 400 };

  it('无改动 → skip', () => {
    expect(decideIntroAction({ filesChanged: 0, insertions: 0, deletions: 0 }, th)).toBe('skip');
  });

  it('小改 → update', () => {
    expect(decideIntroAction({ filesChanged: 2, insertions: 10, deletions: 5 }, th)).toBe('update');
  });

  it('文件数达阈值 → regenerate', () => {
    expect(decideIntroAction({ filesChanged: 8, insertions: 1, deletions: 0 }, th)).toBe('regenerate');
  });

  it('增删行数合计达阈值 → regenerate', () => {
    expect(decideIntroAction({ filesChanged: 1, insertions: 300, deletions: 100 }, th)).toBe('regenerate');
  });
});

describe('parseShortStat', () => {
  it('完整三段', () => {
    expect(parseShortStat(' 3 files changed, 12 insertions(+), 4 deletions(-)')).toEqual({
      filesChanged: 3,
      insertions: 12,
      deletions: 4,
    });
  });

  it('只有插入', () => {
    expect(parseShortStat(' 1 file changed, 5 insertions(+)')).toEqual({
      filesChanged: 1,
      insertions: 5,
      deletions: 0,
    });
  });

  it('空串（无改动）→ 全 0', () => {
    expect(parseShortStat('')).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

import { describe, it, expect } from 'vitest';
import { parseDeclaredProject, parseDeclaredProjects, stripDeclaration } from '../../src/repos/routing';

const aliases = ['room', 'portal', 'ai-assistant', 'user'];

describe('parseDeclaredProjects (可多个)', () => {
  it('单个声明 → 单元素数组', () => {
    expect(parseDeclaredProjects('回答……\n\n__PROJECT__: room', aliases)).toEqual(['room']);
  });

  it('逗号分隔多个（跨工程）→ 按序去重', () => {
    expect(parseDeclaredProjects('__PROJECT__: portal, user', aliases)).toEqual(['portal', 'user']);
  });

  it('全角逗号/顿号/空格混合分隔', () => {
    expect(parseDeclaredProjects('__PROJECT__：portal，user、room', aliases)).toEqual(['portal', 'user', 'room']);
  });

  it('多行声明 → 合并去重（按出现顺序）', () => {
    expect(parseDeclaredProjects('__PROJECT__: portal\n...\n__PROJECT__: portal, room', aliases)).toEqual([
      'portal',
      'room',
    ]);
  });

  it('大小写不敏感 + 反引号/加粗包裹', () => {
    expect(parseDeclaredProjects('**__PROJECT__**：`PORTAL`, `Room`', aliases)).toEqual(['portal', 'room']);
  });

  it('过滤非法别名，仅保留合法', () => {
    expect(parseDeclaredProjects('__PROJECT__: portal, std-smart-office-room', aliases)).toEqual(['portal']);
  });

  it('缺声明 → 空数组', () => {
    expect(parseDeclaredProjects('普通回答', aliases)).toEqual([]);
  });

  it('带连字符别名', () => {
    expect(parseDeclaredProjects('__PROJECT__: ai-assistant', aliases)).toEqual(['ai-assistant']);
  });
});

describe('parseDeclaredProject (主工程=第一个)', () => {
  it('取第一个合法声明', () => {
    expect(parseDeclaredProject('__PROJECT__: portal, user', aliases)).toBe('portal');
  });

  it('非法 → undefined', () => {
    expect(parseDeclaredProject('__PROJECT__: ghost', aliases)).toBeUndefined();
  });
});

describe('stripDeclaration', () => {
  it('移除声明行，保留正文', () => {
    expect(stripDeclaration('第一段\n\n第二段\n\n__PROJECT__: room')).toBe('第一段\n\n第二段');
  });

  it('移除多处声明并压缩空行', () => {
    expect(stripDeclaration('A\n__PROJECT__: portal\n\n\nB\n__PROJECT__: portal, room')).toBe('A\n\nB');
  });

  it('无声明 → 原样（trim）', () => {
    expect(stripDeclaration('  正文  ')).toBe('正文');
  });
});

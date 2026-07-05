import { describe, it, expect } from 'vitest';
import { buildAgentsDoc, buildClaudeDoc, PROJECT_DECL_MARKER } from '../../src/repos/agents-doc';
import { RoutingEntry } from '../../src/repos/scope';

const entries: RoutingEntry[] = [
  { alias: 'room', repoPath: '/repos/std-smart-office-room', introRel: '.agent-intros/room.md' },
  { alias: 'portal', repoPath: '/repos/std-smart-office-portal', introRel: '.agent-intros/portal.md' },
];

describe('buildAgentsDoc', () => {
  const doc = buildAgentsDoc(entries, '.agent-intros');

  it('索引表含全部别名、目录、简介路径', () => {
    expect(doc).toContain('| `room` | /repos/std-smart-office-room | .agent-intros/room.md |');
    expect(doc).toContain('| `portal` | /repos/std-smart-office-portal | .agent-intros/portal.md |');
  });

  it('包含声明标记与自动生成提示', () => {
    expect(doc).toContain(`${PROJECT_DECL_MARKER}: <别名>`);
    expect(doc).toContain('自动生成');
    expect(doc).toContain('.agent-intros/');
  });
});

describe('buildClaudeDoc', () => {
  it('通过 @AGENTS.md 复用同一份', () => {
    expect(buildClaudeDoc()).toContain('@AGENTS.md');
  });
});

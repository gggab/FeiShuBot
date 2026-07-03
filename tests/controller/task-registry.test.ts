import { describe, it, expect } from 'vitest';
import { TaskRegistry } from '../../src/controller/task-registry';

describe('TaskRegistry', () => {
  it('create 返回唯一 taskId 与未中止的 signal', () => {
    const reg = new TaskRegistry();
    const a = reg.create();
    const b = reg.create();
    expect(a.taskId).not.toBe(b.taskId);
    expect(a.signal.aborted).toBe(false);
    expect(reg.size).toBe(2);
  });

  it('abort 命中任务：触发 signal 并返回 true', () => {
    const reg = new TaskRegistry();
    const { taskId, signal } = reg.create();
    let fired = false;
    signal.addEventListener('abort', () => (fired = true));
    expect(reg.abort(taskId)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(fired).toBe(true);
  });

  it('abort 未知任务返回 false', () => {
    const reg = new TaskRegistry();
    expect(reg.abort('nope')).toBe(false);
  });

  it('remove 后 abort 返回 false（已注销）', () => {
    const reg = new TaskRegistry();
    const { taskId } = reg.create();
    reg.remove(taskId);
    expect(reg.size).toBe(0);
    expect(reg.abort(taskId)).toBe(false);
  });
});

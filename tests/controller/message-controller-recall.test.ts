import { describe, it, expect } from 'vitest';
import { MessageController } from '../../src/controller/message-controller';
import type { ConversationQueue } from '../../src/util/conversation-queue';

/** 构造一个只用于测试 recall 的 controller；recognizer/registry 在此路径不参与。 */
function makeController() {
  return new MessageController({} as any, {} as any);
}

/** 造一个可外部释放的任务，便于把一个任务钉在「运行中」。 */
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

describe('MessageController.recall', () => {
  it('撤回仍在排队的消息 → 从队列移除，永不执行', async () => {
    const c = makeController();
    const queue = (c as any).queue as ConversationQueue;
    const ran: string[] = [];
    const d = deferred();

    queue.enqueue({ key: 'k', messageId: 'running', run: () => d.promise }); // 运行中占位
    queue.enqueue({ key: 'k', messageId: 'queued', run: async () => void ran.push('queued') });
    expect(queue.depth('k')).toBe(2);

    c.recall('queued');
    expect(queue.depth('k')).toBe(1); // 仅剩运行中的那个

    d.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(ran).toEqual([]); // 被撤回的排队消息没有执行
  });

  it('撤回不存在/已处理的消息 → 静默无副作用', () => {
    const c = makeController();
    expect(() => c.recall('unknown')).not.toThrow();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** 捕获发送/更新的卡片内容，避免真正走网络。 */
const created: unknown[] = [];
const patched: unknown[] = [];

vi.mock('../../src/feishu/client', () => ({
  larkClient: {
    im: {
      v1: {
        message: {
          create: vi.fn(async ({ data }: { data: { content: string } }) => {
            created.push(JSON.parse(data.content));
            return { code: 0, data: { message_id: 'm1' } };
          }),
          patch: vi.fn(async ({ data }: { data: { content: string } }) => {
            patched.push(JSON.parse(data.content));
            return { code: 0, data: {} };
          }),
        },
      },
    },
  },
}));

import { CardReplyStream } from '../../src/feishu/reply';

describe('CardReplyStream 处理状态可视化', () => {
  beforeEach(() => {
    created.length = 0;
    patched.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('init 发送处理中占位卡片（蓝色头部 + 流式）', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    expect(created).toHaveLength(1);
    const card = created[0] as any;
    expect(card.header.template).toBe('blue');
    expect(card.config.streaming_mode).toBe(true);
  });

  it('done 后终态为绿色「已完成」且关闭流式', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    await s.done('结果');
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('green');
    expect(last.config.streaming_mode).toBe(false);
    expect(last.body.elements[0].content).toBe('结果');
  });

  it('fail 后终态为红色「处理失败」', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    await s.fail('炸了');
    const last = patched[patched.length - 1] as any;
    expect(last.header.template).toBe('red');
    expect(last.config.streaming_mode).toBe(false);
    expect(last.body.elements[0].content).toBe('炸了');
  });

  it('长时间静默时心跳持续刷新已用时长', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    // 无任何 push，仅靠心跳推进
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(patched.length).toBeGreaterThanOrEqual(2);
    const beat = patched[0] as any;
    expect(beat.header.template).toBe('blue');
    expect(beat.header.subtitle.content).toMatch(/已用时/);
  });

  it('done 后心跳停止，不再产生额外刷新', async () => {
    const s = new CardReplyStream('chat');
    await s.init();
    await s.done('好了');
    const count = patched.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(patched.length).toBe(count);
  });
});

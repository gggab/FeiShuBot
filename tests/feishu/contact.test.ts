import { describe, it, expect, vi } from 'vitest';
import { ContactService, FeishuUser } from '../../src/feishu/contact';

const sample: FeishuUser = { openId: 'ou_1', name: '张三', email: 'z@x.com', departmentIds: ['od-dev'] };

describe('ContactService 缓存', () => {
  it('命中缓存不重复请求', async () => {
    const fetcher = vi.fn(async () => sample);
    const svc = new ContactService(fetcher, 10_000);
    const a = await svc.getUser('ou_1');
    const b = await svc.getUser('ou_1');
    expect(a).toEqual(sample);
    expect(b).toEqual(sample);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('过期后重新请求', async () => {
    const fetcher = vi.fn(async () => sample);
    const svc = new ContactService(fetcher, 0); // 立即过期
    await svc.getUser('ou_1');
    await svc.getUser('ou_1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

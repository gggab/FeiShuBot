import { describe, it, expect, vi } from 'vitest';
import { ChatAdminService, ChatAdmins } from '../../src/feishu/chat-admin';

const admins = (o: Partial<ChatAdmins>): ChatAdmins => ({ ownerId: '', managerIds: [], ...o });

describe('ChatAdminService', () => {
  it('isOwnerOrManager：群主/管理员为 true，其余 false', async () => {
    const svc = new ChatAdminService(async () => admins({ ownerId: 'ou_owner', managerIds: ['ou_mgr'] }));
    expect(await svc.isOwnerOrManager('oc_1', 'ou_owner')).toBe(true);
    expect(await svc.isOwnerOrManager('oc_1', 'ou_mgr')).toBe(true);
    expect(await svc.isOwnerOrManager('oc_1', 'ou_other')).toBe(false);
  });

  it('命中缓存：TTL 内同一 chatId 只查一次', async () => {
    const fetcher = vi.fn(async () => admins({ ownerId: 'ou_owner' }));
    const svc = new ChatAdminService(fetcher, 60_000);
    await svc.getAdmins('oc_1');
    await svc.getAdmins('oc_1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期后重新拉取', async () => {
    const fetcher = vi.fn(async () => admins({ ownerId: 'ou_owner' }));
    const svc = new ChatAdminService(fetcher, 0); // 立即过期
    await svc.getAdmins('oc_1');
    await svc.getAdmins('oc_1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fetcher 失败向上抛（由调用方 fail-closed）', async () => {
    const svc = new ChatAdminService(async () => {
      throw new Error('boom');
    });
    await expect(svc.isOwnerOrManager('oc_1', 'ou_x')).rejects.toThrow('boom');
  });
});

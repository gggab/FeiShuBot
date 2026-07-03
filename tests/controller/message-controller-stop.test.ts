import { describe, it, expect, vi } from 'vitest';
import { MessageController } from '../../src/controller/message-controller';
import { ChatAdminService } from '../../src/feishu/chat-admin';
import type { TaskMeta } from '../../src/controller/task-registry';

/** 构造一个只用于测试 stop() 的 controller；recognizer/registry 在 stop 路径中不参与。 */
function makeController(chatAdmin: ChatAdminService | null) {
  return new MessageController({} as any, {} as any, null, chatAdmin);
}

/** 通过内部 TaskRegistry 登记一个任务，返回 taskId 与其 signal。 */
function registerTask(controller: MessageController, meta: TaskMeta) {
  return (controller as any).tasks.create(meta) as { taskId: string; signal: AbortSignal };
}

const groupMeta = (userId: string): TaskMeta => ({ userId, chatId: 'oc_1', chatType: 'group' });
const p2pMeta = (userId: string): TaskMeta => ({ userId, chatId: 'oc_p', chatType: 'p2p' });

describe('MessageController.stop 权限', () => {
  it('任务不存在 → not_found', async () => {
    const c = makeController(null);
    expect(await c.stop('missing', 'ou_a')).toBe('not_found');
  });

  it('发起人本人可停并触发中止信号（p2p）', async () => {
    const c = makeController(null);
    const { taskId, signal } = registerTask(c, p2pMeta('ou_owner'));
    expect(await c.stop(taskId, 'ou_owner')).toBe('stopped');
    expect(signal.aborted).toBe(true);
  });

  it('p2p 非发起人 → forbidden', async () => {
    const c = makeController(null);
    const { taskId } = registerTask(c, p2pMeta('ou_owner'));
    expect(await c.stop(taskId, 'ou_other')).toBe('forbidden');
  });

  it('群管理员可停', async () => {
    const admin = new ChatAdminService(async () => ({ ownerId: 'ou_gowner', managerIds: ['ou_mgr'] }));
    const c = makeController(admin);
    const { taskId } = registerTask(c, groupMeta('ou_asker'));
    expect(await c.stop(taskId, 'ou_mgr')).toBe('stopped');
  });

  it('群普通成员 → forbidden', async () => {
    const admin = new ChatAdminService(async () => ({ ownerId: 'ou_gowner', managerIds: [] }));
    const c = makeController(admin);
    const { taskId } = registerTask(c, groupMeta('ou_asker'));
    expect(await c.stop(taskId, 'ou_random')).toBe('forbidden');
  });

  it('群里群管理员查询失败 → fail-closed forbidden', async () => {
    const admin = new ChatAdminService(async () => {
      throw new Error('api down');
    });
    const c = makeController(admin);
    const { taskId } = registerTask(c, groupMeta('ou_asker'));
    expect(await c.stop(taskId, 'ou_random')).toBe('forbidden');
  });

  it('发起人本人不依赖群信息 API：即使 chatAdmin 会抛错也能停', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const admin = new ChatAdminService(fetcher);
    const c = makeController(admin);
    const { taskId } = registerTask(c, groupMeta('ou_asker'));
    expect(await c.stop(taskId, 'ou_asker')).toBe('stopped');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('未注入 chatAdmin 的群聊：非发起人 → forbidden', async () => {
    const c = makeController(null);
    const { taskId } = registerTask(c, groupMeta('ou_asker'));
    expect(await c.stop(taskId, 'ou_mgr')).toBe('forbidden');
  });
});

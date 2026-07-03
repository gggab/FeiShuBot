/**
 * 运行中任务登记表：taskId → { AbortController, 元数据 }。
 * Registry of in-flight tasks so a card「停止」button can cancel the right one.
 * 元数据用于停止按钮的权限判断（发起人 / 群管理员）。设计对齐 docs/feishu-integration.md §3.2。
 */

import { randomUUID } from 'crypto';

/** 任务元数据：用于「谁能停止」的权限判断。 */
export interface TaskMeta {
  /** 发起人 open_id。 */
  userId: string;
  /** 会话 id。 */
  chatId: string;
  /** 会话类型：p2p / group。 */
  chatType: string;
}

export class TaskRegistry {
  private readonly tasks = new Map<string, { controller: AbortController; meta: TaskMeta }>();

  /** 登记一个新任务，返回 taskId 与其取消信号。 */
  create(meta: TaskMeta): { taskId: string; signal: AbortSignal } {
    const taskId = randomUUID();
    const controller = new AbortController();
    this.tasks.set(taskId, { controller, meta });
    return { taskId, signal: controller.signal };
  }

  /** 读取任务元数据；任务不存在返回 undefined。 */
  get(taskId: string): TaskMeta | undefined {
    return this.tasks.get(taskId)?.meta;
  }

  /** 取消指定任务；任务不存在（已结束/进程重启）返回 false。 */
  abort(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.controller.abort();
    return true;
  }

  /** 注销任务（在处理结束的 finally 中调用）。 */
  remove(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /** 当前登记的任务数（测试/诊断用）。 */
  get size(): number {
    return this.tasks.size;
  }
}

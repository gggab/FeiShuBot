/**
 * 通讯录服务（A）：open_id → {姓名, 邮箱, 部门}，带 TTL 缓存。
 * 设计对齐 docs/development-plan.md M6-A。
 *
 * fetcher 可注入，便于在不依赖飞书 SDK 的情况下测试缓存逻辑。
 */

import { larkClient } from './client';

export interface FeishuUser {
  openId: string;
  name: string;
  /** 企业邮箱优先；取不到为空（取决于已授予的字段权限）。 */
  email: string;
  /** 直属部门 id 列表（open_department_id）。 */
  departmentIds: string[];
}

export type UserFetcher = (openId: string) => Promise<FeishuUser>;

export class ContactService {
  private readonly cache = new Map<string, { user: FeishuUser; expiresAt: number }>();

  constructor(
    private readonly fetcher: UserFetcher,
    private readonly ttlMs: number = 30 * 60 * 1000
  ) {}

  async getUser(openId: string): Promise<FeishuUser> {
    const now = Date.now();
    const hit = this.cache.get(openId);
    if (hit && hit.expiresAt > now) return hit.user;

    const user = await this.fetcher(openId);
    this.cache.set(openId, { user, expiresAt: now + this.ttlMs });
    return user;
  }
}

/** 真实 fetcher：用飞书 SDK 调通讯录。需应用具备 contact 读权限。 */
export function createLarkUserFetcher(): UserFetcher {
  return async (openId: string): Promise<FeishuUser> => {
    const res = await larkClient.contact.v3.user.get({
      path: { user_id: openId },
      params: { user_id_type: 'open_id', department_id_type: 'open_department_id' },
    });
    if (res.code !== 0) {
      throw new Error(`通讯录查询失败: code=${res.code} msg=${res.msg}`);
    }
    const u = (res.data?.user ?? {}) as {
      name?: string;
      email?: string;
      enterprise_email?: string;
      department_ids?: string[];
    };
    return {
      openId,
      name: u.name ?? '',
      email: u.enterprise_email || u.email || '',
      departmentIds: Array.isArray(u.department_ids) ? u.department_ids : [],
    };
  };
}

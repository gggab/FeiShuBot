/**
 * 群管理员服务：chatId → { 群主, 群管理员 }，带 TTL 缓存。
 * Chat admin lookup (owner + managers) with TTL cache.
 * 用于卡片「停止回复」按钮的权限判断（见 docs/feishu-integration.md §3.2）。
 *
 * fetcher 可注入，便于在不依赖飞书 SDK 的情况下测试缓存与鉴权逻辑。
 */

import { larkClient } from './client';

export interface ChatAdmins {
  /** 群主 open_id；取不到为空串。 */
  ownerId: string;
  /** 群管理员 open_id 列表（不含群主）。 */
  managerIds: string[];
}

export type ChatAdminFetcher = (chatId: string) => Promise<ChatAdmins>;

export class ChatAdminService {
  private readonly cache = new Map<string, { admins: ChatAdmins; expiresAt: number }>();

  constructor(
    private readonly fetcher: ChatAdminFetcher,
    private readonly ttlMs: number = 5 * 60 * 1000
  ) {}

  /** 拉取群主 + 管理员（带缓存）。fetcher 失败向上抛，由调用方决定 fail-closed。 */
  async getAdmins(chatId: string): Promise<ChatAdmins> {
    const now = Date.now();
    const hit = this.cache.get(chatId);
    if (hit && hit.expiresAt > now) return hit.admins;

    const admins = await this.fetcher(chatId);
    this.cache.set(chatId, { admins, expiresAt: now + this.ttlMs });
    return admins;
  }

  /** 该 open_id 是否为群主或群管理员。 */
  async isOwnerOrManager(chatId: string, openId: string): Promise<boolean> {
    const { ownerId, managerIds } = await this.getAdmins(chatId);
    return openId === ownerId || managerIds.includes(openId);
  }
}

/** 真实 fetcher：用飞书 SDK 获取群信息。需应用具备 im:chat:readonly 权限。 */
export function createLarkChatAdminFetcher(): ChatAdminFetcher {
  return async (chatId: string): Promise<ChatAdmins> => {
    const res = await larkClient.im.v1.chat.get({
      path: { chat_id: chatId },
      params: { user_id_type: 'open_id' },
    });
    if (res.code !== 0) {
      throw new Error(`获取群信息失败: code=${res.code} msg=${res.msg}`);
    }
    const data = (res.data ?? {}) as { owner_id?: string; user_manager_id_list?: string[] };
    return {
      ownerId: data.owner_id ?? '',
      managerIds: Array.isArray(data.user_manager_id_list) ? data.user_manager_id_list : [],
    };
  };
}

/**
 * GitLab API 客户端：创建 Merge Request。
 * 设计对齐 docs/handlers.md §3。
 */

export interface CreateMrParams {
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  assigneeId?: number;
}

export interface MergeRequest {
  webUrl: string;
  iid: number;
}

export interface GitlabUserRef {
  id: number;
  username: string;
}

/** 构造 MR 创建 endpoint（projectId 需整体 URL 编码）。 */
export function buildMergeRequestUrl(baseUrl: string, projectId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests`;
}

/** 构造按邮箱搜索用户的 endpoint。 */
export function buildUserSearchUrl(baseUrl: string, email: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/v4/users?search=${encodeURIComponent(email)}`;
}

export class GitLabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async createMergeRequest(params: CreateMrParams): Promise<MergeRequest> {
    const url = buildMergeRequestUrl(this.baseUrl, params.projectId);
    const body: Record<string, unknown> = {
      source_branch: params.sourceBranch,
      target_branch: params.targetBranch,
      title: params.title,
      description: params.description,
      remove_source_branch: true,
    };
    if (params.assigneeId) body.assignee_id = params.assigneeId;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`创建 MR 失败 HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as { web_url: string; iid: number };
    return { webUrl: data.web_url, iid: data.iid };
  }

  /**
   * 按邮箱查 GitLab 用户：先按完整邮箱搜（仅公开邮箱/管理员 token 有效），
   * 搜不到再按邮箱前缀（通常等于 GitLab 用户名）搜。命中优先精确匹配。无则 null。
   */
  async findUserByEmail(email: string): Promise<GitlabUserRef | null> {
    const localPart = email.split('@')[0] ?? '';
    const terms = localPart && localPart !== email ? [email, localPart] : [email];

    for (const term of terms) {
      const users = await this.searchUsers(term);
      if (users.length === 0) continue;
      const byEmail = users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
      const byUsername = users.find((u) => u.username.toLowerCase() === localPart.toLowerCase());
      const picked = byEmail ?? byUsername ?? users[0];
      return { id: picked.id, username: picked.username };
    }
    return null;
  }

  private async searchUsers(term: string): Promise<Array<{ id: number; username: string; email?: string }>> {
    const res = await fetch(buildUserSearchUrl(this.baseUrl, term), {
      headers: { 'PRIVATE-TOKEN': this.token },
    });
    if (!res.ok) {
      throw new Error(`GitLab 用户查询失败 HTTP ${res.status}`);
    }
    const users = (await res.json()) as Array<{ id: number; username: string; email?: string }>;
    return Array.isArray(users) ? users : [];
  }
}

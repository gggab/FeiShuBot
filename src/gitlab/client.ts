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

/** 构造 MR 创建 endpoint（projectId 需整体 URL 编码）。 */
export function buildMergeRequestUrl(baseUrl: string, projectId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests`;
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
}

/**
 * 飞书流式 markdown 卡片构建（schema 2.0）。
 * Build a streaming markdown card (schema 2.0).
 * 设计对齐 docs/feishu-integration.md §3。
 */

export function buildMarkdownCard(content: string, streaming = true) {
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      streaming_mode: streaming,
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 12px 12px',
      elements: [
        {
          tag: 'markdown',
          content,
          text_align: 'left',
          text_size: 'normal',
        },
      ],
    },
  };
}

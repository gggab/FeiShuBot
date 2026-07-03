/**
 * 飞书流式 markdown 卡片构建（schema 2.0）。
 * Build a streaming markdown card (schema 2.0).
 * 设计对齐 docs/feishu-integration.md §3 / §3.1。
 */

/** 卡片处理状态：处理中 / 已完成 / 失败。 */
export type CardStatus = 'processing' | 'done' | 'error';

/** 状态 → 头部标题与主题色 + 是否开启流式。集中在此，便于统一调整文案/配色。 */
export const CARD_STATUS: Record<CardStatus, { title: string; template: string; streaming: boolean }> = {
  processing: { title: '⏳ 处理中…', template: 'blue', streaming: true },
  done: { title: '✅ 已完成', template: 'green', streaming: false },
  error: { title: '❌ 处理失败', template: 'red', streaming: false },
};

/** 把毫秒格式化为「已用时 12s」「已用时 1m5s」。 */
export function formatElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const label = totalSec < 60 ? `${totalSec}s` : `${Math.floor(totalSec / 60)}m${totalSec % 60}s`;
  return `已用时 ${label}`;
}

/**
 * 构建带状态头部的 markdown 卡片。
 * @param content markdown 正文。
 * @param status  处理状态，决定头部文案/配色与 streaming_mode（默认 done）。
 * @param elapsedMs 处理已用毫秒；仅在 processing 时作为头部副标题显示。
 */
export function buildMarkdownCard(content: string, status: CardStatus = 'done', elapsedMs?: number) {
  const meta = CARD_STATUS[status];
  const header: {
    title: { tag: string; content: string };
    template: string;
    subtitle?: { tag: string; content: string };
  } = {
    title: { tag: 'plain_text', content: meta.title },
    template: meta.template,
  };
  if (status === 'processing' && elapsedMs !== undefined) {
    header.subtitle = { tag: 'plain_text', content: formatElapsed(elapsedMs) };
  }

  return {
    schema: '2.0',
    config: {
      update_multi: true,
      streaming_mode: meta.streaming,
    },
    header,
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

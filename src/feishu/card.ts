/**
 * 飞书流式 markdown 卡片构建（schema 2.0）。
 * Build a streaming markdown card (schema 2.0).
 * 设计对齐 docs/feishu-integration.md §3 / §3.1 / §3.2。
 */

/** 卡片处理状态：处理中 / 已完成 / 失败 / 已停止（用户主动停止）。 */
export type CardStatus = 'processing' | 'done' | 'error' | 'stopped';

/** 状态 → 头部标题与主题色 + 是否开启流式。集中在此，便于统一调整文案/配色。 */
export const CARD_STATUS: Record<CardStatus, { title: string; template: string; streaming: boolean }> = {
  processing: { title: '⏳ 处理中…', template: 'blue', streaming: true },
  done: { title: '✅ 已完成', template: 'green', streaming: false },
  error: { title: '❌ 处理失败', template: 'red', streaming: false },
  stopped: { title: '⏹ 已停止', template: 'grey', streaming: false },
};

/** 停止按钮 value 里的动作标识，dispatcher 据此路由到取消逻辑。 */
export const STOP_ACTION = 'stop';

/** 把毫秒格式化为「已用时 12s」「已用时 1m5s」。 */
export function formatElapsed(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const label = totalSec < 60 ? `${totalSec}s` : `${Math.floor(totalSec / 60)}m${totalSec % 60}s`;
  return `已用时 ${label}`;
}

/** 「⏹ 停止回复」回传按钮（schema 2.0 callback behavior）。 */
function stopButton(taskId: string) {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: '⏹ 停止回复' },
    type: 'danger',
    size: 'small',
    width: 'default',
    behaviors: [{ type: 'callback', value: { action: STOP_ACTION, taskId } }],
  };
}

/**
 * 构建带状态头部的 markdown 卡片。
 * @param content 正文 markdown。
 * @param status  处理状态，决定头部文案/配色与 streaming_mode（默认 done）。
 * @param elapsedMs 处理已用毫秒；仅在 processing 时作为头部副标题显示。
 * @param stopTaskId 有值且处于 processing 时，底部渲染「停止回复」按钮，携带该 taskId。
 */
export function buildMarkdownCard(
  content: string,
  status: CardStatus = 'done',
  elapsedMs?: number,
  stopTaskId?: string
) {
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

  const elements: object[] = [
    { tag: 'markdown', content, text_align: 'left', text_size: 'normal' },
  ];
  // 仅处理中且登记了任务时才可停止；终态不再渲染按钮。
  if (status === 'processing' && stopTaskId) {
    elements.push(stopButton(stopTaskId));
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
      elements,
    },
  };
}

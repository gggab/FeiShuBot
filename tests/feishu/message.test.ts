import { describe, it, expect } from 'vitest';
import { parseIncoming } from '../../src/feishu/message';

function textEvent(text: string, chatType = 'p2p') {
  return {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      chat_id: 'oc_chat1',
      chat_type: chatType,
      message_type: 'text',
      message_id: 'om_msg1',
      content: JSON.stringify({ text }),
    },
  };
}

describe('parseIncoming', () => {
  it('解析 p2p 文本消息并 trim', () => {
    const msg = parseIncoming(textEvent('  hello  '));
    expect(msg.supported).toBe(true);
    expect(msg.text).toBe('hello');
    expect(msg.userId).toBe('ou_user1');
    expect(msg.chatId).toBe('oc_chat1');
    expect(msg.chatType).toBe('p2p');
    expect(msg.messageType).toBe('text');
    expect(msg.messageId).toBe('om_msg1');
  });

  it('非文本消息标记为 unsupported 且 text 为空', () => {
    const msg = parseIncoming({
      sender: { sender_id: { open_id: 'ou_2' } },
      message: { chat_id: 'oc_2', chat_type: 'group', message_type: 'image', content: '{"image_key":"x"}' },
    });
    expect(msg.supported).toBe(false);
    expect(msg.text).toBe('');
    expect(msg.chatType).toBe('group');
  });

  it('content 非法 JSON 时 text 为空（错误被记录、不抛出）', () => {
    const msg = parseIncoming({
      sender: { sender_id: { open_id: 'ou_3' } },
      message: { chat_id: 'oc_3', chat_type: 'p2p', message_type: 'text', content: 'not-json' },
    });
    expect(msg.supported).toBe(true);
    expect(msg.text).toBe('');
  });

  it('缺失字段时回退为空字符串', () => {
    const msg = parseIncoming({ message: { message_type: 'text', content: '{"text":"hi"}' } });
    expect(msg.userId).toBe('');
    expect(msg.chatId).toBe('');
    expect(msg.text).toBe('hi');
  });
});

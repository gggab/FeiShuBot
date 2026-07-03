import { describe, it, expect } from 'vitest';
import { parseIncoming, stripMentions } from '../../src/feishu/message';

function textEvent(text: string, chatType = 'p2p', mentions?: unknown[]) {
  return {
    sender: { sender_id: { open_id: 'ou_user1' } },
    message: {
      chat_id: 'oc_chat1',
      chat_type: chatType,
      message_type: 'text',
      message_id: 'om_msg1',
      content: JSON.stringify({ text }),
      mentions,
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

  it('群里 @机器人 的命令：剥离提及占位符后命令前缀可用', () => {
    const msg = parseIncoming(
      textEvent('@_user_1 /git status portal', 'group', [{ key: '@_user_1', name: 'Sahib' }])
    );
    expect(msg.text).toBe('/git status portal');
  });
});

describe('stripMentions', () => {
  it('无 mentions 时原样返回', () => {
    expect(stripMentions('/git status', undefined)).toBe('/git status');
    expect(stripMentions('/git status', [])).toBe('/git status');
  });

  it('剥离首个 @机器人 占位符并折叠空白', () => {
    expect(stripMentions('@_user_1 /clear', [{ key: '@_user_1' }])).toBe('/clear');
  });

  it('剥离多个提及占位符', () => {
    const text = '@_user_1 帮 @_user_2 看看登录问题';
    expect(stripMentions(text, [{ key: '@_user_1' }, { key: '@_user_2' }])).toBe('帮 看看登录问题');
  });

  it('前瞻避免 @_user_1 误伤 @_user_10', () => {
    const text = '@_user_1 和 @_user_10 都在';
    // 仅剥离 @_user_1（含末尾空格），@_user_10 保留
    expect(stripMentions(text, [{ key: '@_user_1' }])).toBe('和 @_user_10 都在');
  });

  it('key 缺失的 mention 项被跳过', () => {
    expect(stripMentions('@_user_1 hi', [{ name: '无 key' }, { key: '@_user_1' }])).toBe('hi');
  });
});

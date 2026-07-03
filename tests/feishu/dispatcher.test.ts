import { describe, it, expect } from 'vitest';
import { parseCardAction, parseRecalledMessageId } from '../../src/feishu/dispatcher';

describe('parseCardAction', () => {
  it('识别 stop 动作并取出 taskId 与点击者 open_id', () => {
    const data = { operator: { open_id: 'ou_x' }, action: { value: { action: 'stop', taskId: 'abc' } } };
    expect(parseCardAction(data)).toEqual({ action: 'stop', taskId: 'abc', operatorId: 'ou_x' });
  });

  it('兼容 operator.operator_id.open_id 形态', () => {
    const data = { operator: { operator_id: { open_id: 'ou_y' } }, action: { value: { action: 'stop', taskId: 'abc' } } };
    expect(parseCardAction(data)?.operatorId).toBe('ou_y');
  });

  it('取不到点击者时 operatorId 为空串（不抛错）', () => {
    const data = { action: { value: { action: 'stop', taskId: 'abc' } } };
    expect(parseCardAction(data)).toEqual({ action: 'stop', taskId: 'abc', operatorId: '' });
  });

  it('value 为 JSON 字符串时也能识别', () => {
    const data = { operator: { open_id: 'ou_x' }, action: { value: JSON.stringify({ action: 'stop', taskId: 'abc' }) } };
    expect(parseCardAction(data)).toMatchObject({ action: 'stop', taskId: 'abc', operatorId: 'ou_x' });
  });

  it('value 为非法 JSON 字符串返回 null，不抛错', () => {
    expect(parseCardAction({ action: { value: '{not json' } })).toBeNull();
  });

  it('非 stop 动作返回 null', () => {
    const data = { action: { value: { action: 'apply_fix', taskId: 'abc' } } };
    expect(parseCardAction(data)).toBeNull();
  });

  it('缺 taskId 返回 null', () => {
    expect(parseCardAction({ action: { value: { action: 'stop' } } })).toBeNull();
    expect(parseCardAction({ action: { value: { action: 'stop', taskId: '' } } })).toBeNull();
  });

  it('结构缺失/异常输入返回 null，不抛错', () => {
    expect(parseCardAction(undefined)).toBeNull();
    expect(parseCardAction({})).toBeNull();
    expect(parseCardAction({ action: {} })).toBeNull();
    expect(parseCardAction({ action: { value: 'stop' } })).toBeNull();
  });
});

describe('parseRecalledMessageId', () => {
  it('取出被撤回的 message_id', () => {
    expect(parseRecalledMessageId({ message_id: 'om_1', chat_id: 'oc_1' })).toBe('om_1');
  });

  it('缺 message_id / 异常输入返回空串，不抛错', () => {
    expect(parseRecalledMessageId({})).toBe('');
    expect(parseRecalledMessageId(undefined)).toBe('');
    expect(parseRecalledMessageId({ message_id: 123 })).toBe('');
  });
});

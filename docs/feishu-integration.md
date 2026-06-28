# 飞书接入细节

参考 `../lark-samples-main`：`echo_bot/nodejs`（最小事件接入）、`mcp_larkbot_demo/nodejs`（卡片流式 + AI）、`card_interaction_bot/nodejs`（卡片与回调）。

## 1. SDK 与客户端

```ts
import * as Lark from '@larksuiteoapi/node-sdk';

const baseConfig = { appId, appSecret, domain }; // domain: https://open.feishu.cn
const client   = new Lark.Client(baseConfig);    // 调 OpenAPI（发/改消息）
const wsClient = new Lark.WSClient(baseConfig);   // 长连接收事件
```

- `Client`：调用 OpenAPI，发送/更新消息。
- `WSClient`：长连接接收事件，**开发期无需公网回调地址 / 内网穿透**。

## 2. 接收消息事件

注册 `im.message.receive_v1`，归一化后交给 Controller：

```ts
const dispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (event) => {
    const userId   = event.sender?.sender_id?.open_id ?? '';
    const chatId   = event.message.chat_id ?? '';
    const chatType = event.message.chat_type;          // p2p / group
    const msgType  = event.message.message_type;        // text / post / ...
    // 仅处理 text / post；其它类型显式提示「请发送文本消息」
    // 解析 content → text，trim 后交给 MessageController
  },
});
wsClient.start({ eventDispatcher: dispatcher });
```

要点：
- 非文本消息（图片、文件等）→ 显式回复「请发送文本消息」。
- 群聊（`group`）通常需 @机器人 才触发；单聊（`p2p`）直接触发。是否限定 @ 由实现期与权限配置决定。

## 3. 回复：文本 vs 流式卡片

- 简短/一次性回复可用文本（`im.message.create`，`msg_type: text`）。
- 需要「边生成边显示」（CLI、LLM 流式）用**可更新交互卡片**：

```ts
// 卡片骨架（markdown，schema 2.0）
function buildCard(content: string) {
  return {
    schema: '2.0',
    config: { update_multi: true, streaming_mode: true },
    body: { direction: 'vertical', padding: '12px',
      elements: [{ tag: 'markdown', content }] },
  };
}
```

流式更新流程（对照 `mcp_larkbot_demo`）：
1. 先 `im.message.create`（`msg_type: interactive`）发送占位卡片「正在分析…」，拿到 `message_id`。
2. 内容增量到达时，**节流**（默认 200ms）调用 `im.message.patch` 更新同一卡片。
3. 完成时做最后一次完整更新。

> `streaming_mode`：流式过程开 `true`；如遇飞书端对频繁更新的限制，可在完成时切回 `false`。最终以实际 SDK / 卡片行为为准，并回写本节。

节流封装放在 `feishu/reply.ts`，对 Handler 暴露为 `ReplyStream`（见 [handlers.md](handlers.md)）。

## 4. 卡片交互回调（Bug 修复确认用）

BugFixHandler 的 `propose` 模式需要「确认应用 / 取消」按钮，走 `card.action.trigger` 事件（见 `card_interaction_bot`）：

```ts
'card.action.trigger': async (data) => {
  const { action } = data;          // action.value 区分按钮
  // value.action === 'apply_fix' → 执行应用步骤并更新卡片
  // value.action === 'cancel_fix' → 放弃并更新卡片
}
```

按钮 `value` 内携带本次修复的任务标识，便于回调时找回上下文。

## 5. 国内版 vs 国际版

| | Feishu（open.feishu.cn） | Lark（国际） |
|--|--|--|
| 事件接入 | 长连接 WSClient ✅ | 长连接不支持，需 Webhook |
| Webhook | 可选 | 必需（开发期需内网穿透） |

默认按 Feishu 长连接实现。若目标是 Lark，参照 `mcp_larkbot_demo` 的 `LarkWebhookChatProvider`（`Lark.adaptExpress(dispatcher, { autoChallenge: true })`）改造为 Webhook 接入。

## 6. 开发者后台需要的配置

- 创建应用，获取 `App ID` / `App Secret`。
- 开启**机器人**能力。
- 事件订阅：添加 `im.message.receive_v1`（及 Bug 确认用的卡片回调）。长连接模式下选「使用长连接接收事件」。
- 权限：至少「获取与发送单聊、群组消息」（`im:message`、`im:message:send_as_bot` 等，以后台实际项为准）。
- 把机器人加入测试群或开启单聊后联调。

具体权限 scope 清单随实现确定后回写 [configuration.md](configuration.md)。

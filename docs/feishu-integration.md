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
- **剥离 @ 提及占位符**：群里 @机器人 时，飞书会把 `@_user_1` 拼在正文最前（正文含占位符、真实姓名在 `message.mentions[].name`）。若不剥离，`text` 形如 `@_user_1 /git status portal`，会导致 `/git`、`/clear` 等**命令前缀失配**并**干扰意图识别**（实测被误判为 `knowledge_qa`）。`message.ts` 的 `stripMentions` 用 `mentions[].key` 精确剥离占位符（前瞻 `(?![0-9])` 防止 `@_user_1` 误伤 `@_user_10`）、折叠空白，再交给 Controller。注意：其它被 @ 的用户占位符也一并去除（姓名不进入归一化文本）。

### 2.1 事件投递：至少一次 + 去重 + 快速 ack（重要）

飞书事件为 **at-least-once 投递**：若消费方未在超时内 ack，飞书会**重推同一事件**（可达数次）。若处理逻辑长时间阻塞事件回调（如等待 LLM 流式完成数秒），就会触发重推，导致**重复回复**并污染会话上下文。

因此事件处理必须做到两点（见 `feishu/dispatcher.ts`）：
1. **立即返回 / 异步处理**：事件回调里不要 `await` 整个耗时流程；用 `void onMessage(msg).catch(...)` 触发后台处理，让 SDK 尽快 ack。
2. **按 message_id 去重**：用一个 TTL 窗口（如 10 分钟）记录已处理的 `message_id`，重推的同一消息直接忽略（`feishu/dedup.ts` 的 `Deduplicator`）。

> 历史问题：M2 联调时出现「一条消息回复多条、最后一条不停回复」，根因即为上述阻塞式 ack + 无去重导致的飞书重推风暴。修复后单消息仅处理一次。

### 2.2 并发与排队（每会话串行 + 撤回）

一次只应对**同一张卡片**写一路增量，否则流式内容会互相踩踏。为此 Controller 用**每会话串行队列**（`util/conversation-queue.ts` 的 `ConversationQueue`），键为 **`${userId}:${chatId}`**：

- **隔离维度是「人 × 会话」**：同一个人在**不同会话**（如某群 vs 单聊、或两个群）互不阻塞、可并行；同一会话内严格 **FIFO**，逐条处理。
- **忙则排队，不丢弃**：某会话已有任务在跑时，后续消息**进入队列**而非被拒。入队时若前方还有 N 条，回一条轻提示「已排队，前面还有 N 条」；前方空闲则立即开始（无提示）。前一条结束后自动接着跑下一条。
- **撤回=出队（含可见反馈）**：用户**撤回**尚在排队（未开始）的消息，订阅的 `im.message.recalled_v1` 事件触发 `MessageController.recall(messageId)` → `ConversationQueue.cancel(messageId)`，把它移出队列**永不执行**；移除时触发该排队项的 `onCancelled` 回调，回一条「🚫 已撤回：排队中的这条消息已取消」提示，让撤回**可见**（否则之前的「已排队」提示会显得仍在等待、无从判断是否生效）。已在处理中的任务**不受撤回影响**（它已出队、也没有排队项可移除），需要中止请用卡片「⏹ 停止回复」按钮（§3.2）。
  > 注意区分：排队中的消息**还没有卡片**（卡片在任务真正开始处理时才创建）；你看到仍在转圈的卡片是**另一条正在处理的消息**，撤回别的排队消息不会让它停下。
- **背压上限**：每会话待处理上限 `DEFAULT_MAX_PENDING`（默认 10，不含正在运行的那个），超出即拒绝并回「排队消息过多，请稍后再发」，避免无界堆积打满本地资源（No fallback / 行为显式）。
- **与仓库级锁的关系**：会话队列解决「同一会话不并发写卡片」；跨会话/跨人对**同一仓库**的 CLI 读写另由**仓库级锁**（`util/repo-lock.ts`，按 `config.path` 键控）串行，两层互补。
- **`/clear` 不入队**：清空当前会话上下文是即时命令，在入队前处理（与队列中的任务同其它并发写一样，属既有行为）。

> 取舍：键含 `chatId` 后，一个人在多个会话可并行多个任务，本地资源上限交由仓库级锁 + 排队上限兜底；「全局并发闸」列为后续（development-plan.md 顺延 E）。

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

### 3.1 处理状态可视化（卡片头部 + 心跳）

后端处理往往有**较长的静默段**（CLI 冷启动、`git fetch`、两段输出之间的等待）。仅靠正文文本，用户无法判断「还在跑」还是「卡死了」，一旦失败也只能靠读正文分辨。为此卡片带**状态头部**并在处理中**心跳刷新已用时长**：

- `buildMarkdownCard(content, status, elapsedMs?)` 按状态渲染带颜色的 `header`：
  - `processing` → 蓝色「⏳ 处理中…」，副标题显示已用时长（如「已用时 12s」），`streaming_mode: true`；
  - `done` → 绿色「✅ 已完成」，`streaming_mode: false`；
  - `error` → 红色「❌ 处理失败」，`streaming_mode: false`。
- `CardReplyStream` 在 `init()` 记录起始时刻并启动**心跳定时器**（默认 2s）：处理未完成时即使没有新增量，也定期 `patch` 刷新副标题的已用时长，卡片不会看起来「冻住」。`done()`/`fail()` 关闭心跳并切到终态头部。
- 心跳间隔（2s）远宽于流式节流（200ms），对频繁更新限制友好；每次刷新副标题时长都在变化，避免「内容未变」的无效 `patch`。
- **卡片更新串行化（避免终态回跳）**：所有 `patch` 经 `CardReplyStream.updateChain` 串成一条链**按提交顺序落地**。否则一个在途的 `processing` 更新（心跳/流式）可能比 `done` 的 `patch` **更晚返回**，把已完成的绿色卡片**打回「处理中」且内容回退成半截**。串行化保证终态（done/error/stopped）因最后提交而最后生效；`doFlush` 再加一道守卫——`finalized` 后丢弃仍排在链上的 `processing` 更新。

> 状态与头部映射集中在 `feishu/card.ts` 的 `CARD_STATUS`；心跳间隔为 `feishu/reply.ts` 的 `CARD_HEARTBEAT_INTERVAL_MS`。
> **语言**：卡片固定文案（状态标题、已用时、停止按钮、占位「思考中…」、「已由用户停止」）按用户消息语言取中/英版本——Controller 用 `detectLang(text)` 判定后经 `CardReplyOptions.lang` 传入，默认中文（`/git` 命令等中文入口不受影响）。

### 3.2 停止按钮与任务取消

长任务（CLI 阅读/修复、LLM 长回答）用户可能中途想停下。因此**处理中**的卡片底部带一个「⏹ 停止回复」按钮，点击即中止当前后端处理：

- **任务登记**：`MessageController` 处理每条消息时向 `TaskRegistry`（`controller/task-registry.ts`）登记一个 `taskId`，拿到对应的 `AbortController`；`signal` 注入 `HandlerContext.signal`，Handler 透传给 `CliRunner.run({ signal })` 与 `LlmClient.chatStream(msgs, { signal })`。处理结束（成功/失败/停止）在 `finally` 中注销该 `taskId`。
- **按钮**：`processing` 状态且带 `taskId` 时，卡片追加一个 `danger` 回传按钮，`value = { action: 'stop', taskId }`。终态（done/error/stopped）不再渲染按钮。
- **回调**：点击触发 `card.action.trigger`（需在开发者后台订阅「卡片回传交互」）。`dispatcher` 用纯函数 `parseCardAction` 解析出 `{ action: 'stop', taskId, operatorId }`（`operatorId` 取事件里的点击者 open_id，兼容 `operator.open_id` 与 `operator.operator_id.open_id`），再调 `onStop(taskId, operatorId)`（→ `MessageController.stop`），按结果回 toast。
- **中止效果**：`AbortController.abort()` 会 kill 掉 CLI 子进程 / 中断 LLM 流 / 取消 Dify fetch（各 Handler 均把 `ctx.signal` 透传给底层调用）。正在 `for await` 的 Handler 循环因此抛错落到 `catch → reply.fail()`，终态渲染为灰色「⏹ 已停止」并**保留已生成的部分内容**（不当作红色「处理失败」，也不显示底层报错文案）。
- **立即反馈（关键）**：`CardReplyStream` 直接监听 `signal`，收到 abort 就**抢先**把卡片收敛到「已停止」终态（停心跳、去按钮、刷新一次），**不依赖 Handler 循环抛错**。否则像知识问答这类「一次 `await` 且底层未响应 signal」的处理，点了停止卡片会一直停在「处理中」。收敛用 `finalize()` 幂等：谁先到（abort 抢先 / Handler 的 done/fail）谁定终态，晚到的 done/fail 被忽略，避免迟到的完整结果覆盖「已停止」。
- **范围**：停止按钮作用于 Controller 路由的四类意图（chat / 代码理解 / Bug 修复 / 知识问答）。`/git` 运维命令执行快、并发多项目，暂不挂停止按钮。

#### 停止权限（谁能停）

停止按钮对群内所有成员**可见**（同一张卡片对所有成员渲染一致，飞书无法按观看者隐藏单个按钮），因此权限在**点击回调时强制校验**，无权者点了只收到 toast 被拒、任务不受影响。规则：

```
可停止  ⟺  点击者 == 发起人
         ∨  (群聊 ∧ 点击者 ∈ {群主} ∪ {群管理员})
```

- 建任务时把 `{ userId(发起人), chatId, chatType }` 存进 `TaskRegistry`（`create(meta)` / `get(taskId)`）。
- 单聊（p2p）：会话里只有发起人与机器人，点击者必是发起人 → 直接放行，**不查 API**。
- 群聊：先比对发起人（内存，零 API）；非发起人再经 `ChatAdminService.isOwnerOrManager(chatId, operatorId)` 判断是否群主/管理员。群主 + 管理员一次 `im.v1.chat.get` 即取回（`owner_id` + `user_manager_id_list`），按 `chatId` 带 TTL 缓存（默认 5 分钟）。
- **fail-closed**：群管理员查询失败按拒绝处理（返回 `forbidden`）；发起人本人不依赖该 API，不受影响。
- `MessageController.stop` 返回 `stopped | not_found | forbidden`，`dispatcher` 分别回：已停止 / 任务已结束 / 仅发起人或群管理员可停止。

> `taskId` 用 `randomUUID()` 生成，仅进程内有效；进程重启后旧卡片上的按钮点击会得到「任务已结束」toast（`abort` 返回 false），不会误伤。所需飞书权限见 [configuration.md](configuration.md)（读取群信息 `im:chat:readonly`）。

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
- 事件订阅：添加 `im.message.receive_v1`（收消息）与 `im.message.recalled_v1`（撤回消息 → 把仍在排队的消息移出队列，见 §2.2）。长连接模式下选「使用长连接接收事件」。
- 权限：至少「获取与发送单聊、群组消息」（`im:message`、`im:message:send_as_bot` 等，以后台实际项为准）；停止按钮的群管理员判断另需 `im:chat:readonly`（见 §6.1、[configuration.md](configuration.md) §2.4）。
- 把机器人加入测试群或开启单聊后联调。

### 6.1 卡片回调（停止按钮 / Bug 确认按钮）

卡片按钮点击走 `card.action.trigger`。本项目用**长连接（WSClient）**，回调与事件共用一条长连接，**无需公网 URL / 内网穿透**。配置步骤：

1. 开发者后台 →「开发配置 / 事件与回调」，**订阅方式**选「使用长连接接收」。
2. 在「回调」里添加 **卡片回传交互 `card.action.trigger`**（订阅方式同为长连接）。
3. 权限管理开通并发布：`im:message`（收发消息）、`im:chat:readonly`（读群信息，群管理员停止鉴权用）。
4. **创建并发布新版本**，权限/订阅才生效（内部应用可能需管理员审核）。
5. 验证：群里触发长任务后点「⏹ 停止回复」，控制台应打印 `[事件] card.action.trigger stop … → stopped/forbidden/not_found`，飞书端弹出对应 toast。

> 按钮的 `value`（`{ action:'stop', taskId }`）由代码在卡片里带上（`feishu/card.ts`），**无需在卡片搭建工具里另配** action。
> 排查：点后端**无日志**通常是第 2 步回调未订阅或版本未发布；**总是 forbidden** 多为 `im:chat:readonly` 未生效（群管理员查不到 → fail-closed）。

完整权限 scope 清单见 [configuration.md](configuration.md)（§2.2 修改代码 / §2.3 阅读源码 / §2.4 停止按钮）。

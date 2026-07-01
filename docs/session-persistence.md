# 会话持久化（Session Persistence）

> 本文是会话上下文持久化的事实来源。变更行为前先改这里，再改代码与测试。

## 1. 目标

- 进程重启 / 崩溃后，每个会话最近 N 轮对话仍能恢复。
- **不破坏现有同步 API**：`getSession / addUser / addAssistant / getHistory / clear` 全部保持同步。
- 默认行为不变：未开持久化时与纯内存实现完全一致（No fallback / 行为显式）。
- 对齐项目惯例：文件落盘、配置走 `.env`、缺失/损坏显式抛错。

## 2. 存储后端：SQLite（better-sqlite3）

选 **better-sqlite3** 的关键原因是它**同步**：现有 `SessionContext` 与 controller 全链路同步调用，用同步驱动可做到「写穿透持久化」而无需把 controller / handler 改成 async。单进程 + WAL 模式下，写性能对聊天频率绰绰有余。

- 单文件落盘（`SESSION_DB_FILE`，默认 `session.db`，git 忽略，含 `-wal`/`-shm` 旁文件）。
- 打开 / 建表失败 → 启动**显式抛错退出**，不静默回退内存。
- 仅单进程共享；多副本部署各自独立、不互通（已知取舍）。

## 3. 会话维度：chatId

会话以 **`chatId`** 为 key（不是 `userId`）：内存缓存 Map、DB 列、`getSession` 入参统一用 `chatId`。

- 群聊里所有成员**共享同一份上下文**；单聊等价于按人。
- `/clear` 清的是**当前会话(chatId)**的上下文。
- `SESSION_MAX_TURNS` 含义为「每个会话(chatId)在内存中保留的轮数」。
- 历史里额外记录 `sender_id`（谁说的）作为元数据；传给 LLM 的仍是纯 `{role, content}` 序列。
- 并发说明：`inFlight` 守卫仍是「每人单任务」（CLI 并发保护），与会话维度无关；同群多人并发触发时各自串行写库，库层一条消息一行、自增 id 保证时序。

## 4. 架构：内存缓存 + SQLite 事实来源

```
addUser/addAssistant ─▶ 内存数组(截断保留N轮) ─▶ INSERT 到 SQLite
getSession(未缓存)    ─▶ SELECT 最近 N 轮回灌 ─▶ 缓存
/clear               ─▶ 清空数组 + DELETE 该 chatId 行
```

- 保留现有 `Map<chatId, SessionContext>` 作为热缓存，SQLite 作为跨重启的事实来源。
- `getSession(chatId)` 缓存未命中时，新建 `SessionContext` 并从库回灌最近 `maxTurns*2` 条，再放入 Map。
- `SessionContext` 注入**可选** `SessionStore`；不注入 = 纯内存（单元测试用此形态）。
- `app.ts` 启动时按 `SESSION_PERSIST` 决定是否构造 `SqliteSessionStore` 并注入。

### 接口

```ts
// LLM 消费的形状保持不变（{role, content}），senderId 不进内存、不传给 LLM。
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

// 入库时携带发言人元数据。
export interface StoredTurn extends ChatTurn {
  senderId?: string; // 发言人 open_id；仅作存储/审计，不参与 getHistory()
}

export interface SessionStore {
  load(chatId: string, limit: number): ChatTurn[]; // 回灌只取 role/content
  append(chatId: string, turn: StoredTurn): void;
  clear(chatId: string): void;
}
```

> `SessionContext.addUser(content, senderId?)` 把 `senderId` 透传给 `store.append`；内存里只留 `{role, content}`，因此 `getHistory()`（喂给 LLM）天然不含 `senderId`。`assistant` 行 `senderId` 为空。

## 5. 表结构

一条消息一行（而非整段 JSON blob），便于按 N 轮裁剪与按发言人审计：

```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT    NOT NULL,
  sender_id  TEXT,                                  -- 发言人 open_id（assistant 行为空）
  role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL                       -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_session_chat ON session_messages(chat_id, id);
```

- 回灌：`SELECT sender_id, role, content FROM session_messages WHERE chat_id=? ORDER BY id DESC LIMIT ?` 再反转。
- 自增 `id` 保证时序，不依赖 `created_at` 精度。
- 建表用 `IF NOT EXISTS`，启动时执行（幂等）。

## 6. 数据保留

两层，均可配：

1. **每会话硬上限**：每次 `append` 后裁剪，仅保留该 `chat_id` 最近 `SESSION_STORE_MAX_MESSAGES`（默认 200）条：
   `DELETE FROM session_messages WHERE chat_id=? AND id NOT IN (SELECT id FROM session_messages WHERE chat_id=? ORDER BY id DESC LIMIT ?)`。
2. **TTL 扫除**：启动时 + 每日一次 `DELETE WHERE created_at < now - SESSION_RETENTION_DAYS*86400000`（默认 365 天；0=不按时间清理）。

内存上下文窗口（`SESSION_MAX_TURNS`）与库内归档边界（上限/TTL）解耦：内存只喂最近 N 轮给 LLM，库里保留更长历史。

## 7. 配置

| 变量 | 默认 | 说明 |
|------|------|------|
| `SESSION_PERSIST` | `false` | 是否启用持久化（false=纯内存） |
| `SESSION_DB_FILE` | `session.db` | SQLite 文件路径（git 忽略） |
| `SESSION_STORE_MAX_MESSAGES` | `200` | 每会话(chatId)归档消息硬上限 |
| `SESSION_RETENTION_DAYS` | `365` | 超期清理天数（0=不清理） |
| `SESSION_MAX_TURNS` | `10` | 内存上下文保留轮数（已有） |

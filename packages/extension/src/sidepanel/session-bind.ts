/**
 * 会话绑定与事件路由的精确配对。
 *
 * 背景：侧栏发出的 `session.new` / `session.use` / `session.fork` / `prompt` 都是
 * 异步请求，Host 回一条 `session` 消息。早期实现按「到达顺序」把回执配给请求
 * （FIFO），任何一次请求没有回执（连接错误、`session/load` 失败上报 status、agent
 * 未就绪……）都会让之后所有绑定永久错位一格：某条 ACP 会话被绑到错误的本地会话，
 * 于是旧任务的内容会串进新会话。这里改为每个请求带一个 `requestId`，回执按 id
 * 一一配对；配不上的回执（SW 重连回放、Host 自发消息）不改动任何绑定。
 */

export type BindKind = "new" | "use" | "fork" | "prompt";

export type BindTicket = { localId: string; kind: BindKind };

export class BindRegistry {
  private items = new Map<string, BindTicket>();

  /** 登记一个待回执的请求。同一会话的新 prompt 会顶掉旧的 prompt 悬挂项。 */
  add(requestId: string, localId: string, kind: BindKind): void {
    if (kind === "prompt") this.dropPrompts(localId);
    this.items.set(requestId, { localId, kind });
  }

  /** 按 requestId 取回执的归属；取不到（不存在 / 已清理）返回 undefined。 */
  take(requestId: string | undefined): BindTicket | undefined {
    if (!requestId) return undefined;
    const item = this.items.get(requestId);
    if (!item) return undefined;
    this.items.delete(requestId);
    return item;
  }

  /** 是否还有「会话绑定类」请求在等回执（prompt 等待不计入）。 */
  hasPendingBinds(): boolean {
    for (const item of this.items.values()) {
      if (item.kind !== "prompt") return true;
    }
    return false;
  }

  /** 该会话名下是否已有等待回执的请求（任意 kind）。 */
  hasLocal(localId: string): boolean {
    for (const item of this.items.values()) {
      if (item.localId === localId) return true;
    }
    return false;
  }

  /** 丢弃某个会话的全部悬挂项（会话被删 / 连接重置）。 */
  dropLocal(localId: string): void {
    for (const [requestId, item] of [...this.items]) {
      if (item.localId === localId) this.items.delete(requestId);
    }
  }

  /** 只丢弃 prompt 悬挂项（回合结束后这些不可能再有修正回执）。 */
  dropPrompts(localId: string): void {
    for (const [requestId, item] of [...this.items]) {
      if (item.localId === localId && item.kind === "prompt") this.items.delete(requestId);
    }
  }

  clear(): void {
    this.items.clear();
  }
}

type SessionLike = {
  id: string;
  acpSessionId?: string;
  acpByProvider?: Record<string, string>;
};

/** 一个会话名下出现过的全部 ACP id（与 persist.ts 的 sessionAcpIds 同语义）。 */
function sessionAcpIds(session: SessionLike): string[] {
  const ids = new Set<string>();
  if (session.acpSessionId) ids.add(session.acpSessionId);
  for (const id of Object.values(session.acpByProvider ?? {})) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * ACP 会话 id → 本地会话 id 的精确映射。找不到就返回 undefined：调用方必须
 * 「找不到就丢弃」，绝不能退回当前选中会话——那是内容串戏的直接通道。
 */
export function findSessionIdByAcpId(sessions: SessionLike[], acpId?: string): string | undefined {
  if (!acpId) return undefined;
  const found = sessions.find((item) => sessionAcpIds(item).includes(acpId));
  return found?.id;
}

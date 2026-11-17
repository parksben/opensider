/**
 * 「本地那份」和「Host 手里那份」状态，该听谁。
 *
 * 只用到 `sessions` 与 `savedAt` 两个字段，所以这里用结构类型而不是 `LoadedState`——
 * 这个模块不能反向依赖 persist（那会把 i18n 之类的浏览器依赖一起拖进来，纯逻辑就没法
 * 单测了）。
 */
export type StateSnapshot = {
  savedAt?: string;
  sessions: Array<{ messages?: unknown[]; acpSessionId?: string; acpByProvider?: Record<string, string> }>;
};

export function hasSessionHistory(sessions: StateSnapshot["sessions"]): boolean {
  return sessions.some(
    (session) =>
      (session.messages?.length ?? 0) > 0 ||
      Boolean(session.acpSessionId) ||
      Boolean(session.acpByProvider && Object.keys(session.acpByProvider).length),
  );
}

/**
 * hydration 那一刻：本地缓存和 Host 镜像谁上。
 *
 * 「镜像有历史、本地空」是重装 / 换机器之后的恢复路径，无条件听镜像；否则谁新听谁的。
 */
export function preferHostState(local: StateSnapshot, host: StateSnapshot): boolean {
  const hostHas = hasSessionHistory(host.sessions);
  const localHas = hasSessionHistory(local.sessions);
  if (hostHas && !localHas) return true;
  if (!hostHas) return false;
  const hostAt = Date.parse(host.savedAt ?? "");
  const localAt = Date.parse(local.savedAt ?? "");
  if (Number.isFinite(hostAt) && Number.isFinite(localAt)) return hostAt > localAt;
  return false;
}

/**
 * 面板已经起来了，Host 又推来一份镜像（每次 `hello` 都会推一次）：这份要不要灌回内存？
 *
 * 镜像是**异步写**的，通常比内存旧：一轮在跑时正文故意不落盘（见 App 的持久化 effect），
 * 状态大到一个 60MB 的写要几秒（`ui.state.set chunks=227`）。而 `preferHostState` 比的是
 * 「镜像的 savedAt」和「**hydration 那一刻**的本地快照」，所以只要镜像在 hydration 之后写过
 * 一次，它就永远显得「更新」——于是每次 SW / Host 重连都会把内存整份倒回旧镜像：刚切好的
 * Agent 变回上一家、正在跑的正文连同刚发出去的消息一起消失（用户报过「切到 OpenCode 发完
 * 消息又变回 Hermes，而且点不动」）。
 *
 * 所以回灌只在这些情形发生：
 *   - 面板自己什么都还没有（重装 / 换机器）：把历史捡回来，这是镜像唯一的用途；
 *   - 镜像有历史、而内存里没有（同上，只是走 hydration 之后才到）。
 * 其余情况一律以内存为准；内存里有还没写出去的改动、或有一轮在跑，更是不接受。
 */
export function acceptHostMirror(input: {
  host: StateSnapshot;
  /** hydration 时定下来的那份快照（不是内存里现在的）。 */
  local: StateSnapshot | null;
  /** 内存里现在的会话：判断「我们手里到底有没有东西」。 */
  memorySessions: StateSnapshot["sessions"];
  /** 正在跑的轮次数。 */
  running: number;
  /** 面板最近一次自己写出去的 savedAt（ms；0 = 还没写过）。 */
  wroteAt: number;
  /** 有改动等着写出去（防抖窗口里）。 */
  dirty: boolean;
}): boolean {
  if (!input.local) return true;
  const hostHas = hasSessionHistory(input.host.sessions);
  const memoryHas = hasSessionHistory(input.memorySessions);
  // 镜像有历史、内存没有：这是「重装 / 换机器」的恢复路径。
  if (hostHas && !memoryHas) return true;
  if (!hostHas) return false;
  // 一轮在跑：正文故意没落盘，回灌等于把用户正在看的东西抹掉。
  if (input.running > 0) return false;
  // 内存里还有没写出去的改动：等它写完再说，别拿旧的换掉新的。
  if (input.dirty) return false;
  // 镜像不比我们自己写出去的那份新：它只可能更旧。
  const mirrorAt = Date.parse(input.host.savedAt ?? "");
  if (input.wroteAt > 0 && Number.isFinite(mirrorAt) && mirrorAt <= input.wroteAt) return false;
  return preferHostState(input.local, input.host);
}

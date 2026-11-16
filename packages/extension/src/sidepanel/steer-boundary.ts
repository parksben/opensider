/**
 * 引导消息「什么时候才算被 Agent 读到」。
 *
 * Hermes 的 `/steer` 只是把文本**缓冲**起来（源码：deliver "after the current tool batch
 * finishes (no interrupt)"）；ACP 没有任何「已注入」事件。它的注入点是工具批次边界：
 * 一批工具调用跑完、下一次模型请求之前。所以面板这样近似：
 *
 *   1. `prompt.steerAccepted` → armed（消息已排队，输出继续留在它上面）
 *   2. armed 之后第一次「工具调用结束」→ boundary（这批工具之后 Agent 就会读到）
 *   3. boundary 之后的第一段正文，就是「读着这条消息」产出的 → consumed，另起一段
 *
 * 没有工具调用的轮次永远走不到 2，由 `turn.end` 兜底收尾（Hermes 会把没被消费的引导
 * 留成下一轮，输出自然落在消息下面）。
 */
export type SteerBoundaryState = {
  /** Agent 已确认收到这条引导（但目前只是缓冲）。 */
  armed: boolean;
  /** 已经跨过一次工具批次边界。 */
  boundary: boolean;
};

export const IDLE_STEER_BOUNDARY: SteerBoundaryState = { armed: false, boundary: false };

function sessionUpdate(update: Record<string, unknown>): string {
  return String(update.sessionUpdate ?? "");
}

function toolFinished(update: Record<string, unknown>): boolean {
  const kind = sessionUpdate(update);
  if (kind !== "tool_call" && kind !== "tool_call_update") return false;
  const status = String(update.status ?? "");
  return status === "completed" || status === "failed";
}

export function steerBoundaryStep(
  state: SteerBoundaryState,
  update: Record<string, unknown>,
): { state: SteerBoundaryState; consumed: boolean } {
  if (!state.armed) return { state, consumed: false };
  if (toolFinished(update)) {
    return state.boundary ? { state, consumed: false } : { state: { ...state, boundary: true }, consumed: false };
  }
  if (state.boundary && sessionUpdate(update) === "agent_message_chunk") {
    return { state: IDLE_STEER_BOUNDARY, consumed: true };
  }
  return { state, consumed: false };
}

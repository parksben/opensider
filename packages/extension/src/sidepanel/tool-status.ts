import type { ToolPart } from "./chat-types";

/**
 * Whether a tool call has finished.
 *
 * The ACP `status` field cannot be trusted on its own: plenty of agents (Cursor, Copilot,
 * OpenCode in particular) emit `tool_call` and then `tool_call_update` carrying only the
 * result, leaving `status` at the default `"pending"` — or omit it on the initial event so
 * the default kicks in and is never revised. Relying on it leaves every tool in the
 * transcript spinning forever, with no way to read "this one is done" off the screen, and
 * makes a whole run look like it is still going.
 *
 * A result is the reliable signal: an agent does not produce one before the tool returns.
 * `status` only upgrades the answer — `"failed"` is a completed tool that failed, not a
 * tool still in flight, so anything explicitly completed/failed counts as done regardless.
 */
export function toolFinished(part: ToolPart): boolean {
  if (part.result != null && part.result !== "") return true;
  const status = part.status;
  if (status === "completed" || status === "failed") return true;
  // ACP also streams progress as `content` blocks (diffs, terminal text) before the final
  // result, so those do not count — they mean "still going", not "done".
  return false;
}

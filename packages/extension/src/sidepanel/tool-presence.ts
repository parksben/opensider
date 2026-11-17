/**
 * 对话里「这条工具调用在不在」的小工具。
 *
 * 只依赖结构类型（`messages[].content[].toolCallId`），不碰 React / i18n / 浏览器 API——这样
 * 「迟到的浏览器命令该不该写进对话」这条判断能被单测覆盖（acp-messages 会连带拖进 i18n，
 * Node 下跑不起来）。
 */
type ToolBearing = { content: ReadonlyArray<{ type: string; toolCallId?: string }> };

/** The transcript id a browser tool call uses, for both the command and its result. */
export function browserToolId(commandId: string): string {
  return `browser:${commandId}`;
}

/** Whether this tool call is already in the transcript (any message). */
export function hasToolPart(messages: ToolBearing[], toolCallId: string): boolean {
  return messages.some((message) =>
    message.content.some((part) => part.type === "tool-call" && part.toolCallId === toolCallId),
  );
}

/**
 * Whether a browser command / result may be written into the transcript.
 *
 * The browser side is asynchronous: a `navigate` / `runScript` fired at the end of a turn
 * gets its result after `turn.end`. Adding a step then only has one place to go — a fresh
 * assistant message (`lastAssistant` cannot grow a settled one) — which renders as an extra
 * 「已执行」 bubble with nothing but process and no answer (user reported it). A command that
 * is already on screen still updates: its result belongs to the card the user can see.
 */
export function browserUpdateAccepted(messages: ToolBearing[], toolCallId: string, live: boolean): boolean {
  return live || hasToolPart(messages, toolCallId);
}

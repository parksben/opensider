import type { Locale } from "./i18n";

export const BROWSER_REPO = "https://github.com/parksben/opensider";
export const EDITOR_REPO = "https://github.com/parksben/opensider-vscode";

export type HandoffTarget = "browser" | "vscode";

export type HandoffMessage = {
  id: string;
  role: "user" | "assistant";
};

/**
 * Where a "continue from here" click cuts the stored session.
 *
 * A round starts at each user message. `beforeRound` is the first round the
 * other agent must not read, so "只看第 N 轮之前" includes the clicked message
 * and everything before it.
 */
export function handoffCutoff(messages: HandoffMessage[], messageId: string): {
  beforeRound: number;
  throughMessageId: string;
  nextRoundMessageId?: string;
} | undefined {
  const end = messages.findIndex((message) => message.id === messageId);
  if (end < 0) return undefined;
  let round = 0;
  for (let index = 0; index <= end; index += 1) {
    if (messages[index].role === "user") round += 1;
  }
  let nextRoundMessageId: string | undefined;
  for (let index = end + 1; index < messages.length; index += 1) {
    if (messages[index].role === "user") {
      nextRoundMessageId = messages[index].id;
      break;
    }
  }
  return { beforeRound: round + 1, throughMessageId: messages[end].id, nextRoundMessageId };
}

/**
 * A short prompt for the other OpenSider app. The transcript stays in the
 * session file; the prompt only names that file and the round to stop before.
 */
export function buildHandoffPrompt(input: {
  locale: Locale;
  target: HandoffTarget;
  statePath: string;
  sessionId: string;
  beforeRound: number;
  throughMessageId: string;
  nextRoundMessageId?: string;
  workspace?: string;
  pageTitle?: string;
  pageUrl?: string;
}): string {
  return input.locale === "zh" ? promptZh(input) : promptEn(input);
}

function promptZh(input: {
  target: HandoffTarget;
  statePath: string;
  sessionId: string;
  beforeRound: number;
  throughMessageId: string;
  nextRoundMessageId?: string;
  workspace?: string;
  pageTitle?: string;
  pageUrl?: string;
}): string {
  const where = input.target === "browser" ? "浏览器端 OpenSider" : "VS Code 里的 OpenSider";
  const lines = [
    `请在${where}里接着这个会话继续。把已经发生过的对话当作上下文：不要复述已有回复，也不要重复已经做过的操作，除非我明确要求。准备好后等待我的下一条消息。`,
    "",
    "这条会话的消息不在 ui-state.json 里，那个文件只有会话列表。请直接读下面这个文件，不要让我把记录贴过来：",
    transcriptPath(input.statePath, input.sessionId, input.target, "zh"),
    "",
    `这个文件就是 id 为「${input.sessionId}」的会话。消息在 messages 数组里，按顺序排列。每条有 id、role（user 或 assistant）和 content。content 里 type 为 text 的 text 是对话正文；type 为 reasoning 的是思考；type 为 tool-call 的是已经执行过的操作，只当作上下文，不要再执行一遍。一轮从一条 role 为 user 的消息开始，按出现顺序从 1 计数。只看第 ${input.beforeRound} 轮之前的内容：读到消息 id「${input.throughMessageId}」为止（含这条），不要读它后面的消息。`,
  ];
  if (input.nextRoundMessageId) {
    lines.push(`第 ${input.beforeRound} 轮从消息 id「${input.nextRoundMessageId}」开始，这条以及之后都不要读。`);
  }
  if (input.workspace) lines.push(`工作区：${input.workspace}`);
  if (input.pageUrl) lines.push(`页面：${input.pageTitle ? `${input.pageTitle} ` : ""}${input.pageUrl}`);
  return lines.join("\n");
}

function promptEn(input: {
  target: HandoffTarget;
  statePath: string;
  sessionId: string;
  beforeRound: number;
  throughMessageId: string;
  nextRoundMessageId?: string;
  workspace?: string;
  pageTitle?: string;
  pageUrl?: string;
}): string {
  const where = input.target === "browser" ? "OpenSider in the browser" : "OpenSider in VS Code";
  const lines = [
    `Continue this conversation in ${where}. Treat what already happened as context: do not restate the existing replies or repeat work that was already done unless I explicitly ask. Then wait for my next message.`,
    "",
    "The messages are not in ui-state.json. That file is only the session list. Read this file yourself; do not ask me to paste it:",
    transcriptPath(input.statePath, input.sessionId, input.target, "en"),
    "",
    `This file is the session whose id is "${input.sessionId}". Messages are in the messages array, in order. Each one has id, role ("user" or "assistant"), and content. In content, an item with type "text" is the spoken text; type "reasoning" is private thinking; type "tool-call" is work that already ran — use it as context and do not run it again. A round starts at each message with role "user", numbered from 1 in order. Read only the content before round ${input.beforeRound}: stop at message id "${input.throughMessageId}" (inclusive). Do not read anything after it.`,
  ];
  if (input.nextRoundMessageId) {
    lines.push(`Round ${input.beforeRound} starts at message id "${input.nextRoundMessageId}". Skip that message and everything after it.`);
  }
  if (input.workspace) lines.push(`Workspace: ${input.workspace}`);
  if (input.pageUrl) lines.push(`Page: ${input.pageTitle ? `${input.pageTitle} ` : ""}${input.pageUrl}`);
  return lines.join("\n");
}

/** Transcript file next to ui-state.json. The index no longer holds messages. */
function transcriptPath(statePath: string, sessionId: string, target: HandoffTarget, locale: Locale): string {
  const name = `${sessionId}.json`;
  if (statePath) {
    const slash = statePath.replace(/\\/g, "/");
    const dir = slash.replace(/\/[^/]*$/, "");
    return `${dir}/sessions/${name}`;
  }
  if (target === "browser") {
    const bucket = locale === "zh" ? "<工作区>" : "<workspace>";
    return `~/.opensider-vscode/workspaces/${bucket}/sessions/${name}`;
  }
  return `~/.opensider/sessions/${name}`;
}

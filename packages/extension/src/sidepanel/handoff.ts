import type { Locale } from "./i18n";

const TRANSCRIPT_LIMIT = 12_000;

export const BROWSER_REPO = "https://github.com/parksben/opensider";
export const EDITOR_REPO = "https://github.com/parksben/opensider-vscode";

export type HandoffTarget = "browser" | "vscode";

export type HandoffTurn = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Prompt the other OpenSider app pastes into a fresh turn. It carries the
 * transcript through the message the user clicked, and tells that agent to
 * treat it as prior context instead of redoing the work.
 */
export function buildHandoffPrompt(input: {
  locale: Locale;
  target: HandoffTarget;
  turns: HandoffTurn[];
  workspace?: string;
  pageTitle?: string;
  pageUrl?: string;
}): string {
  const intro = input.locale === "zh" ? introZh(input) : introEn(input);
  const body = input.turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text.trim()}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n\n");
  const transcript = body.length > TRANSCRIPT_LIMIT ? `${body.slice(0, TRANSCRIPT_LIMIT)}…` : body;
  return transcript ? `${intro}\n\n${transcript}` : intro;
}

function introZh(input: { target: HandoffTarget; workspace?: string; pageTitle?: string; pageUrl?: string }): string {
  const where = input.target === "browser" ? "浏览器端 OpenSider" : "VS Code 里的 OpenSider";
  const lines = [
    `请在${where}里接着下面的对话继续。把这些内容当作已经发生过的上下文：不要复述已有回复，也不要重复已经做过的操作，除非我明确要求。准备好后等待我的下一条消息。`,
  ];
  if (input.workspace) lines.push(`工作区：${input.workspace}`);
  if (input.pageUrl) lines.push(`页面：${input.pageTitle ? `${input.pageTitle} ` : ""}${input.pageUrl}`);
  return lines.join("\n");
}

function introEn(input: { target: HandoffTarget; workspace?: string; pageTitle?: string; pageUrl?: string }): string {
  const where = input.target === "browser" ? "OpenSider in the browser" : "OpenSider in VS Code";
  const lines = [
    `Continue the conversation below in ${where}. Treat it as context that already happened: do not restate the existing replies or repeat work that was already done unless I explicitly ask. Then wait for my next message.`,
  ];
  if (input.workspace) lines.push(`Workspace: ${input.workspace}`);
  if (input.pageUrl) lines.push(`Page: ${input.pageTitle ? `${input.pageTitle} ` : ""}${input.pageUrl}`);
  return lines.join("\n");
}

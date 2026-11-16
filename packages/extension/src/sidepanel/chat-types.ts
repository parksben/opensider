import type { AttachmentItem } from "@shared";

export type { AttachmentItem };

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type TextPart = { type: "text"; text: string };
export type ReasoningPart = { type: "reasoning"; text: string };
export type ToolPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  status?: ToolStatus;
  kind?: string;
  primaryArg?: string;
};

export type ChatPart = TextPart | ReasoningPart | ToolPart;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: ChatPart[];
  createdAt: Date;
  attachments?: AttachmentItem[];
  modelId?: string;
  modelName?: string;
  durationMs?: number;
  /**
   * 引导模式下「已经上屏、但还没交给 Agent」的用户消息：当前这一轮结束前一直挂着这个
   * 标记（等待期间只展示、不参与轮次与舞台判定），轮次结束时自动作为新一轮发出。
   */
  pending?: boolean;
  /**
   * 引导模式下「已经注入当前轮、Agent 还没确认接手」的用户消息：在 Agent 读到它之前，
   * 后续输出仍属于上面那一轮（渲染在它之前），确认接手后才另起一段渲染在它之后。
   */
  awaitingSteer?: boolean;
};

export type PermissionRequest = {
  id: number;
  title: string;
  options: Array<{ optionId: string; name: string; kind?: string }>;
  workspaceWrite?: boolean;
};

export type QuestionPrompt = {
  id: number;
  title?: string;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    allowMultiple?: boolean;
  }>;
};

export type PlanPrompt = {
  id: number;
  name?: string;
  overview?: string;
  plan: string;
};

export type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

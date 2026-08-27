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

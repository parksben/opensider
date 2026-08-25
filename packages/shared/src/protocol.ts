export const HOST_NAME = "com.cursor.sidebar.host";
export const EXTENSION_ID = "gcblddgaifebccglndkaccmibhechimj";
export const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnTBeaC6um/MhTF3PUApwaTJ58DCRUu7bzf8OziNAQTxwrN5MtQNjEdzyJrpTOLdmkIZ57ssbWqGbBpXUSpvNmIFLsp5rENOv8hVvYX8j2vALs5eJbhiKggPuUyYZ+pO7ibQjreLeGzW380iDZjB9pDSjvYERFBoNf+COJTMNd4vQZ3BhBPrYhnct0qEIqTk/050xrqRn/knPnLCOP20FSVMhrvs9u5dSwGJ2mE6g34tfeAof6AL4LCrKgnd8qEtwmeWfRfFWYr6W5UJQficulEHlcUCZUfjN/aro2M2mJXdwaALGPhaYy+q1sqHM3yEEsjI84DStXoGJPpBoqx6u7wIDAQAB";

export const PAGE_METHODS = [
  "getMeta",
  "getReadable",
  "getSelection",
  "getLinks",
  "getOutline",
  "queryText",
] as const;

export type PageMethod = (typeof PAGE_METHODS)[number];

export type CurrentPage = {
  tabId: number;
  url: string;
  title: string;
  updatedAt: string;
  readable?: string;
};

export type BrowserCommand = {
  id: string;
  method: PageMethod;
  args?: { selector?: string };
};

export type BrowserResult = {
  id: string;
  ok: boolean;
  method: PageMethod;
  data?: unknown;
  error?: string;
};

export type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

export type PermissionOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type ExtToHost =
  | { type: "hello" }
  | { type: "prompt"; text: string; currentPage?: { title: string; url: string } }
  | { type: "cancel" }
  | { type: "page.update"; page: CurrentPage }
  | { type: "browser.result"; result: BrowserResult }
  | {
      type: "permission.reply";
      id: number;
      outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
    }
  | { type: "cursor.reply"; id: number; result: unknown };

export type HostToExt =
  | { type: "hello"; workspace: string; agentPath: string }
  | { type: "status"; state: "starting" | "ready" | "error"; error?: string }
  | { type: "session"; sessionId: string; replay?: boolean }
  | { type: "update"; update: Record<string, unknown> }
  | { type: "permission"; id: number; params: Record<string, unknown> }
  | { type: "cursor"; id?: number; method: string; params: Record<string, unknown> }
  | { type: "turn.end"; stopReason: string }
  | { type: "page"; page: CurrentPage }
  | { type: "browser.command"; command: BrowserCommand };

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
  "queryAll",
  "getAttribute",
  "getValue",
  "exists",
  "click",
  "dblclick",
  "hover",
  "focus",
  "fill",
  "type",
  "clear",
  "select",
  "check",
  "press",
  "scroll",
  "scrollIntoView",
  "waitFor",
  "navigate",
  "goBack",
  "goForward",
  "reload",
  "screenshot",
  "screenshotElement",
] as const;

export const TAB_METHODS = ["navigate", "goBack", "goForward", "reload"] as const;
export const CAPTURE_METHODS = ["screenshot", "screenshotElement"] as const;

export const ACTION_METHODS = [
  "click",
  "dblclick",
  "hover",
  "focus",
  "fill",
  "type",
  "clear",
  "select",
  "check",
  "press",
  "scroll",
  "scrollIntoView",
  "navigate",
  "goBack",
  "goForward",
  "reload",
] as const;

export type PageMethod = (typeof PAGE_METHODS)[number];
export type TabMethod = (typeof TAB_METHODS)[number];

export function isTabMethod(method: PageMethod): method is TabMethod {
  return (TAB_METHODS as readonly string[]).includes(method);
}

export function isActionMethod(method: PageMethod): boolean {
  return (ACTION_METHODS as readonly string[]).includes(method);
}

export function isCaptureMethod(method: PageMethod): boolean {
  return (CAPTURE_METHODS as readonly string[]).includes(method);
}

export type BrowserCommandArgs = {
  selector?: string;
  text?: string;
  value?: string;
  url?: string;
  key?: string;
  attribute?: string;
  timeoutMs?: number;
  x?: number;
  y?: number;
  nth?: number;
  checked?: boolean;
  width?: number;
  height?: number;
};

export type ClipRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type ScreenshotPayload = {
  imageBase64: string;
  mime: "image/jpeg";
  width: number;
  height: number;
};

export const TOOL_CATALOG: Array<{
  name: PageMethod;
  kind: "read" | "act" | "vision";
  args: string;
  summary: string;
}> = [
  { name: "getMeta", kind: "read", args: "", summary: "url, title, description" },
  { name: "getReadable", kind: "read", args: "", summary: "main text extract" },
  { name: "getSelection", kind: "read", args: "", summary: "highlighted text" },
  { name: "getLinks", kind: "read", args: "", summary: "same-origin links" },
  { name: "getOutline", kind: "read", args: "", summary: "h1–h3 headings" },
  { name: "queryText", kind: "read", args: "selector|text, nth?", summary: "one node's text" },
  { name: "queryAll", kind: "read", args: "selector|text", summary: "matching node summaries" },
  { name: "getAttribute", kind: "read", args: "selector|text, attribute", summary: "element attribute" },
  { name: "getValue", kind: "read", args: "selector|text", summary: "input/textarea/select value" },
  { name: "exists", kind: "read", args: "selector|text", summary: "whether a match exists" },
  { name: "click", kind: "act", args: "selector|text, nth?", summary: "click an element" },
  { name: "dblclick", kind: "act", args: "selector|text, nth?", summary: "double-click" },
  { name: "hover", kind: "act", args: "selector|text, nth?", summary: "hover" },
  { name: "focus", kind: "act", args: "selector|text, nth?", summary: "focus" },
  { name: "fill", kind: "act", args: "selector|text, value", summary: "set field value" },
  { name: "type", kind: "act", args: "selector|text, text", summary: "append text" },
  { name: "clear", kind: "act", args: "selector|text", summary: "clear a field" },
  { name: "select", kind: "act", args: "selector|text, value", summary: "choose a <select> option" },
  { name: "check", kind: "act", args: "selector|text, checked?", summary: "checkbox/radio" },
  { name: "press", kind: "act", args: "key, selector?", summary: "keydown/keyup, e.g. Enter" },
  { name: "scroll", kind: "act", args: "selector|text or x,y", summary: "scroll window or element" },
  { name: "scrollIntoView", kind: "act", args: "selector|text", summary: "scroll element into view" },
  { name: "waitFor", kind: "act", args: "selector|text, timeoutMs?", summary: "wait until element exists" },
  { name: "navigate", kind: "act", args: "url", summary: "http(s) navigation" },
  { name: "goBack", kind: "act", args: "", summary: "history back" },
  { name: "goForward", kind: "act", args: "", summary: "history forward" },
  { name: "reload", kind: "act", args: "", summary: "reload tab" },
  { name: "screenshot", kind: "vision", args: "x?,y?,width?,height?", summary: "JPEG of the visible viewport or a region" },
  { name: "screenshotElement", kind: "vision", args: "selector|text, nth?", summary: "JPEG of one element; Read the file at data.path" },
];

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
  args?: BrowserCommandArgs;
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

export type AttachmentKind = "image" | "file" | "folder" | "element";

export type AttachmentItem = {
  path: string;
  name: string;
  kind: AttachmentKind;
};

export type AgentModel = {
  id: string;
  name: string;
};

export type ExtToHost =
  | { type: "hello" }
  | { type: "prompt"; text: string; sessionId?: string; currentPage?: { title: string; url: string } }
  | { type: "cancel" }
  | { type: "session.new" }
  | { type: "session.use"; sessionId: string }
  | { type: "session.fork"; sessionId: string }
  | { type: "fs.pick"; requestId: string }
  | { type: "fs.save"; requestId: string; name?: string; imageBase64: string; mime: "image/jpeg" }
  | { type: "page.pick"; requestId: string; hint?: string }
  | { type: "page.pick.cancel"; requestId?: string }
  | { type: "model.set"; modelId: string; sessionId?: string }
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
  | { type: "session"; sessionId: string; replay?: boolean; created?: boolean; forked?: boolean }
  | { type: "update"; update: Record<string, unknown> }
  | { type: "permission"; id: number; params: Record<string, unknown> }
  | { type: "cursor"; id?: number; method: string; params: Record<string, unknown> }
  | { type: "turn.end"; stopReason: string }
  | { type: "page"; page: CurrentPage }
  | { type: "browser.command"; command: BrowserCommand }
  | { type: "browser.result"; result: BrowserResult }
  | {
      type: "fs.picked";
      requestId: string;
      items: AttachmentItem[];
      cancelled?: boolean;
      error?: string;
    }
  | {
      type: "fs.saved";
      requestId: string;
      items: AttachmentItem[];
      error?: string;
    }
  | { type: "models"; models: AgentModel[]; currentId: string }
  | {
      type: "page.picked";
      requestId: string;
      items: AttachmentItem[];
      cancelled?: boolean;
      error?: string;
    };

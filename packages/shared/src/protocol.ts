export const HOST_NAME = "com.opensider.host";
export const EXTENSION_ID = "gcblddgaifebccglndkaccmibhechimj";
export const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnTBeaC6um/MhTF3PUApwaTJ58DCRUu7bzf8OziNAQTxwrN5MtQNjEdzyJrpTOLdmkIZ57ssbWqGbBpXUSpvNmIFLsp5rENOv8hVvYX8j2vALs5eJbhiKggPuUyYZ+pO7ibQjreLeGzW380iDZjB9pDSjvYERFBoNf+COJTMNd4vQZ3BhBPrYhnct0qEIqTk/050xrqRn/knPnLCOP20FSVMhrvs9u5dSwGJ2mE6g34tfeAof6AL4LCrKgnd8qEtwmeWfRfFWYr6W5UJQficulEHlcUCZUfjN/aro2M2mJXdwaALGPhaYy+q1sqHM3yEEsjI84DStXoGJPpBoqx6u7wIDAQAB";

export const PAGE_METHODS = [
  "getMeta",
  "getReadable",
  "getInteractive",
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
  "fillForm",
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
  "listTabs",
  "switchTab",
  "openTab",
  "moveTabsToWindow",
] as const;

export const TAB_METHODS = ["navigate", "goBack", "goForward", "reload"] as const;
export const WINDOW_METHODS = ["listTabs", "switchTab", "openTab", "moveTabsToWindow"] as const;
export const CAPTURE_METHODS = ["screenshot", "screenshotElement"] as const;

export const ACTION_METHODS = [
  "click",
  "dblclick",
  "hover",
  "focus",
  "fill",
  "type",
  "clear",
  "fillForm",
  "select",
  "check",
  "press",
  "scroll",
  "scrollIntoView",
  "navigate",
  "goBack",
  "goForward",
  "reload",
  "switchTab",
  "openTab",
  "moveTabsToWindow",
] as const;

export type PageMethod = (typeof PAGE_METHODS)[number];
export type TabMethod = (typeof TAB_METHODS)[number];
export type WindowMethod = (typeof WINDOW_METHODS)[number];

export function isTabMethod(method: PageMethod): method is TabMethod {
  return (TAB_METHODS as readonly string[]).includes(method);
}

export function isWindowMethod(method: PageMethod): method is WindowMethod {
  return (WINDOW_METHODS as readonly string[]).includes(method);
}

export function isActionMethod(method: PageMethod): boolean {
  return (ACTION_METHODS as readonly string[]).includes(method);
}

export function isCaptureMethod(method: PageMethod): boolean {
  return (CAPTURE_METHODS as readonly string[]).includes(method);
}

export type FormFieldArg = {
  index?: number;
  selector?: string;
  text?: string;
  label?: string;
  name?: string;
  value?: string;
  checked?: boolean;
};

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
  index?: number;
  label?: string;
  name?: string;
  checked?: boolean;
  width?: number;
  height?: number;
  tabId?: number;
  tabIds?: number[];
  windowId?: number;
  fields?: FormFieldArg[];
};

export type TabRecord = {
  tabId: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  restricted: boolean;
};

export type WindowRecord = {
  windowId: number;
  focused: boolean;
  state?: string;
  tabs: TabRecord[];
};

export type TabsSnapshot = {
  updatedAt: string;
  windows: WindowRecord[];
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
  { name: "getInteractive", kind: "read", args: "", summary: "numbered interactive controls; prefer args.index from this list" },
  { name: "getSelection", kind: "read", args: "", summary: "highlighted text" },
  { name: "getLinks", kind: "read", args: "", summary: "same-origin links" },
  { name: "getOutline", kind: "read", args: "", summary: "h1–h3 headings" },
  { name: "queryText", kind: "read", args: "index|selector|label|text, nth?", summary: "one node's text" },
  { name: "queryAll", kind: "read", args: "index|selector|label|text?", summary: "matching node summaries; empty args = interactive list" },
  { name: "getAttribute", kind: "read", args: "index|selector|label|text, attribute", summary: "element attribute" },
  { name: "getValue", kind: "read", args: "index|selector|label|text", summary: "input/textarea/select value" },
  { name: "exists", kind: "read", args: "index|selector|label|text", summary: "whether a match exists" },
  { name: "click", kind: "act", args: "index|selector|label|text, nth?", summary: "click an element" },
  { name: "dblclick", kind: "act", args: "index|selector|label|text, nth?", summary: "double-click" },
  { name: "hover", kind: "act", args: "index|selector|label|text, nth?", summary: "hover" },
  { name: "focus", kind: "act", args: "index|selector|label|text, nth?", summary: "focus" },
  { name: "fill", kind: "act", args: "index|label|selector, value", summary: "set field value (native, contenteditable, or combobox)" },
  { name: "type", kind: "act", args: "index|label|selector, text", summary: "append text" },
  { name: "clear", kind: "act", args: "index|label|selector", summary: "clear a field" },
  { name: "fillForm", kind: "act", args: "fields[{index|label|name, value}]", summary: "fill many fields in one call" },
  { name: "select", kind: "act", args: "index|label|selector, value", summary: "choose a select/combobox option by value or text" },
  { name: "check", kind: "act", args: "index|label|selector, checked?", summary: "checkbox/radio/switch" },
  { name: "press", kind: "act", args: "key, index|selector?", summary: "keydown/keyup, e.g. Enter" },
  { name: "scroll", kind: "act", args: "index|selector|text or x,y", summary: "scroll window or element" },
  { name: "scrollIntoView", kind: "act", args: "index|selector|label|text", summary: "scroll element into view" },
  { name: "waitFor", kind: "act", args: "index|selector|label|text, timeoutMs?", summary: "wait until element exists" },
  { name: "navigate", kind: "act", args: "url", summary: "http(s) navigation" },
  { name: "goBack", kind: "act", args: "", summary: "history back" },
  { name: "goForward", kind: "act", args: "", summary: "history forward" },
  { name: "reload", kind: "act", args: "", summary: "reload tab" },
  { name: "screenshot", kind: "vision", args: "x?,y?,width?,height?", summary: "JPEG of the visible viewport or a region" },
  { name: "screenshotElement", kind: "vision", args: "index|selector|label|text, nth?", summary: "JPEG of one element; Read the file at data.path" },
  { name: "listTabs", kind: "read", args: "", summary: "all normal windows and tabs; same shape as browser/tabs.json" },
  { name: "switchTab", kind: "act", args: "tabId", summary: "activate a tab and focus its window" },
  { name: "openTab", kind: "act", args: "url, windowId?", summary: "open http(s) in a new tab; optional windowId" },
  { name: "moveTabsToWindow", kind: "act", args: "tabIds, windowId?", summary: "pull tabs into a new window, or into windowId" },
];

export type CurrentPage = {
  tabId: number;
  url: string;
  title: string;
  updatedAt: string;
  readable?: string;
  interactive?: string;
  favIconUrl?: string;
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

export type AgentPolicy = "ask" | "workspace" | "auto";

export type AgentMark =
  | "cursor"
  | "opencode"
  | "copilot"
  | "codebuddy"
  | "claude"
  | "codex"
  | "gemini"
  | "qwen"
  | "kimi"
  | "iflow"
  | "trae"
  | "qoder"
  | "generic";

export type AgentCaps = {
  models: boolean;
  questions: boolean;
  plans: boolean;
  todos: boolean;
};

export type AgentInfo = {
  id: string;
  name: string;
  mark: AgentMark;
  command?: string;
  installed: boolean;
  hint?: string;
  caps: AgentCaps;
};

export type AgentProgress = {
  phase: string;
  index: number;
  total: number;
  label: string;
};

export type ExtToHost =
  | { type: "hello" }
  | { type: "agents.detect" }
  | { type: "agent.connect"; providerId: string; policy?: AgentPolicy }
  | { type: "agent.setPolicy"; policy: AgentPolicy }
  | { type: "prompt"; text: string; sessionId?: string; currentPage?: { title: string; url: string } }
  | { type: "cancel"; sessionId?: string }
  | { type: "session.new" }
  | { type: "session.use"; sessionId: string }
  | { type: "session.fork"; sessionId: string }
  | { type: "fs.pick"; requestId: string }
  | { type: "fs.save"; requestId: string; name?: string; imageBase64: string; mime: "image/jpeg" }
  | { type: "page.pick"; requestId: string; hint?: string }
  | { type: "page.pick.cancel"; requestId?: string }
  | { type: "model.set"; modelId: string; sessionId?: string }
  | { type: "page.update"; page: CurrentPage }
  | { type: "tabs.update"; snapshot: TabsSnapshot }
  | { type: "browser.result"; result: BrowserResult }
  | {
      type: "permission.reply";
      id: number;
      outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
    }
  | { type: "cursor.reply"; id: number; result: unknown };

export type HostToExt =
  | { type: "hello"; workspace: string; agentPath: string; providerId?: string }
  | { type: "status"; state: "starting" | "idle" | "connecting" | "ready" | "error"; error?: string }
  | { type: "agents"; agents: AgentInfo[]; selectedId?: string }
  | { type: "agent.progress"; progress: AgentProgress }
  | { type: "session"; sessionId: string; replay?: boolean; created?: boolean; forked?: boolean }
  | { type: "update"; update: Record<string, unknown>; sessionId?: string }
  | { type: "permission"; id: number; params: Record<string, unknown>; sessionId?: string }
  | { type: "cursor"; id?: number; method: string; params: Record<string, unknown>; sessionId?: string }
  | { type: "turn.end"; stopReason: string; sessionId?: string }
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

import type { NativeUiEvent } from "./native-ui";
import type { OverlayReport } from "./overlays";

export const HOST_NAME = "com.opensider.host";
// 未打包 ID（用户实际在用的那个）：由下面 EXTENSION_KEY 决定，改了会让用户丢侧栏数据；
// pack-extension.mjs 会用构建产物 manifest 的 key 校验它
export const EXTENSION_ID = "gcblddgaifebccglndkaccmibhechimj";
// 历史打包 ID：当初 CRX 签名用的 ID。只为兼容曾 sideload 过 CRX 的机器而留在
// allowed_origins 里；已无实际用途（不再出 CRX，仓库也不放密钥）
export const PACKED_EXTENSION_ID = "clnpnldmjaklambmaglpckjlgkicmcpb";
// 未打包 ID 的公钥（写进 manifest 的 key）。它是**公开**的：谁都能照抄拿到同一个 ID，
// 所以它只用于固定身份，不是秘密，也挡不住恶意扩展
export const EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnTBeaC6um/MhTF3PUApwaTJ58DCRUu7bzf8OziNAQTxwrN5MtQNjEdzyJrpTOLdmkIZ57ssbWqGbBpXUSpvNmIFLsp5rENOv8hVvYX8j2vALs5eJbhiKggPuUyYZ+pO7ibQjreLeGzW380iDZjB9pDSjvYERFBoNf+COJTMNd4vQZ3BhBPrYhnct0qEIqTk/050xrqRn/knPnLCOP20FSVMhrvs9u5dSwGJ2mE6g34tfeAof6AL4LCrKgnd8qEtwmeWfRfFWYr6W5UJQficulEHlcUCZUfjN/aro2M2mJXdwaALGPhaYy+q1sqHM3yEEsjI84DStXoGJPpBoqx6u7wIDAQAB";

export const PAGE_METHODS = [
  "getMeta",
  "getReadable",
  "getInteractive",
  "getOverlays",
  "getUnsavedChanges",
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
  "runScript",
  "screenshot",
  "screenshotElement",
  "listTabs",
  "switchTab",
  "openTab",
  "closeTab",
  "moveTabsToWindow",
  "getNativeUi",
  "setDialogPolicy",
] as const;

export const TAB_METHODS = ["navigate", "goBack", "goForward", "reload"] as const;
export const WINDOW_METHODS = ["listTabs", "switchTab", "openTab", "closeTab", "moveTabsToWindow"] as const;
export const CAPTURE_METHODS = ["screenshot", "screenshotElement"] as const;
export const SCRIPT_METHODS = ["runScript"] as const;

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
  "runScript",
  "switchTab",
  "openTab",
  "closeTab",
  "moveTabsToWindow",
  "getNativeUi",
  "setDialogPolicy",
] as const;

export type PageMethod = (typeof PAGE_METHODS)[number];
export type TabMethod = (typeof TAB_METHODS)[number];
export type WindowMethod = (typeof WINDOW_METHODS)[number];

/** Methods the service worker answers itself by talking to the main-world native UI shim. */
export const NATIVE_UI_METHODS = ["getNativeUi", "setDialogPolicy"] as const;

export function isNativeUiMethod(method: PageMethod): boolean {
  return (NATIVE_UI_METHODS as readonly string[]).includes(method);
}

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

export function isScriptMethod(method: PageMethod): boolean {
  return (SCRIPT_METHODS as readonly string[]).includes(method);
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
  force?: boolean;
  code?: string;
  world?: "ISOLATED" | "MAIN";
  fields?: FormFieldArg[];
  /** setDialogPolicy: `observe` (default) or `answer` with the per-kind answers. */
  policy?: unknown;
  /** setDialogPolicy / getNativeUi: how long an answer policy stays armed. */
  expiresAt?: number;
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
  /** Who may work in this tab right now: the user, or an OpenSider session. */
  control?: "user" | "agent";
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

export type CurrentPage = {
  tabId: number;
  url: string;
  title: string;
  updatedAt: string;
  readable?: string;
  interactive?: string;
  favIconUrl?: string;
  /**
   * The tab the Agent's browser commands route to right now (see tab-control in the SW).
   * May differ from the tab above, which is what the *user* is looking at.
   */
  target?: { tabId: number; url: string; title: string };
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
  /** Machine-readable cause for control gates: borrow_required / borrow_denied / borrow_held / needs_focus / needs_visible / revoked. */
  reason?: string;
  /** One line the Agent can act on (e.g. what to do after a borrow request). */
  hint?: string;
};

export type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

/** One tab a session may work in (borrowed anchor or self-created). */
export type ControlTab = {
  tabId: number;
  title: string;
  url: string;
  /** A command is executing in this tab right now. */
  acting: boolean;
};

/** Tab control state for one session, as shown in the side panel banner. */
export type TabControlState = {
  sessionId: string;
  tabs: ControlTab[];
};

export type PermissionOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type AttachmentKind = "image" | "file" | "folder" | "element";

/** Runtime list of the kinds above, for validation outside the type system. */
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ["image", "file", "folder", "element"];

export type AttachmentItem = {
  path: string;
  name: string;
  kind: AttachmentKind;
  missing?: boolean;
};

export type AgentModel = {
  id: string;
  name: string;
};

export type AgentPolicy = "ask" | "workspace" | "auto" | "unattended";

/**
 * Where a session's mode comes from: a config option (the spec-preferred shape) or the
 * legacy `modes` list. The panel renders both the same way; only the set path differs.
 */
export type AgentModeSource = "config" | "modes";

/**
 * Semantic class of a mode. Used **only** to pick an icon — never to decide behavior, so
 * a misclassification costs nothing but a wrong glyph.
 */
export type AgentModeKind =
  | "plan"
  | "build"
  | "ask"
  | "agent"
  | "edits"
  | "auto"
  | "full_access"
  | "unknown";

/**
 * One mode the agent advertises. `name` and `desc` are the agent's own words — passed
 * through verbatim, never translated, because every CLI names its modes differently.
 */
export type AgentModeOption = {
  id: string;
  name: string;
  desc?: string;
  kind: AgentModeKind;
};

/**
 * One value of a session config option. `name` is the agent's own wording (e.g. Cursor
 * sends `Off` / `Fast`) — passed through verbatim, never translated.
 */
export type AgentOptionValue = {
  id: string;
  name: string;
  desc?: string;
};

/**
 * A session config option the agent advertises beyond `mode` / `model` — spec categories
 * `thought_level` (the engine's own reasoning effort) and `model_config` (per-model
 * switches such as Claude's `Fast mode` or Cursor's `Fast`). The host pushes the whole
 * list verbatim; the panel renders only the categories it knows, so a category we have
 * never seen simply does not show up.
 *
 * Boolean options (`type: "boolean"`) have no `values` list; their `current` is the
 * string `"true"` / `"false"`.
 */
export type AgentOption = {
  id: string;
  category?: string;
  name: string;
  type?: string;
  current?: string;
  values?: AgentOptionValue[];
};

/**
 * The two things the selection toolbar can ask the agent for. The third action (quote) never
 * reaches the host: it only drops a chip into the composer.
 *
 * Both run on a hidden channel — a dedicated process with a fresh ACP session per request —
 * so they never enter the conversation the user is having (`internal/host/selection.go`).
 */
export type SelectionMode = "translate" | "search";

/** Host → extension, one way or another, for a single selection request. */
export type SelectionResult =
  | { type: "selection.delta"; requestId: string; tabId: number; text: string }
  | { type: "selection.done"; requestId: string; tabId: number; text: string }
  | { type: "selection.failed"; requestId: string; tabId: number; error: string };

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

/**
 * One globally installed skill: found by scanning the global skill directories and reading
 * the header of its `SKILL.md` (see internal/skills).
 *
 * `name` is the identifier the CLIs know, and the only thing we put in an outgoing prompt;
 * `alias` is what the probe menu lists (the skill's own `display_name` — e.g. `水产市场` —
 * falling back to `name`). `description` is the skill's own wording, kept verbatim for the
 * detail panel and for search.
 */
export type SkillItem = {
  name: string;
  alias: string;
  source: SkillSource;
  /** Absolute path of the skill's SKILL.md. */
  path: string;
  description: string;
};

/** Which global directory a skill came from: the small tag next to its name in the menu. */
export type SkillSource =
  | "claude"
  | "cursor"
  | "agents"
  | "codex"
  | "stepclaw"
  | "cursor_builtin";

export type ExtToHost =
  | { type: "hello" }
  | { type: "agents.detect" }
  | { type: "skills.refresh" }
  | {
      type: "agent.connect";
      providerId: string;
      policy?: AgentPolicy;
      modeId?: string;
      /** The panel's remembered config-option values for this agent (configId → value). */
      optionValues?: Record<string, string>;
    }
  | { type: "agent.cancelConnect" }
  | { type: "agent.setPolicy"; policy: AgentPolicy }
  | { type: "agent.setMode"; modeId: string; sessionId?: string }
  | { type: "agent.setOption"; configId: string; value: string; sessionId?: string }
  /**
   * 划词工具条：翻译 / 搜索。`tabId` 由 service worker 按发送方标签页填上（Host 只把它
   * 原样带回来，好让结果能回到发起请求的那一页）。
   *
   * `targetLang` 是**浏览器语言**（翻译的目标语言，与界面语言无关）；`uiLocale` 是**扩展
   * 界面语言**（搜索结果要用它输出，中文界面就不该还给用户一屏英文）。
   */
  | {
      type: "selection.run";
      requestId: string;
      mode: SelectionMode;
      text: string;
      targetLang?: string;
      uiLocale?: string;
      title?: string;
      url?: string;
      tabId?: number;
    }
  | { type: "selection.cancel"; requestId: string }
  | {
      type: "prompt";
      text: string;
      sessionId?: string;
      requestId?: string;
      /**
       * Leading `/skill-name` list the panel asks for. The host prepends it in front of
       * everything else (including the current-tab block): a slash invocation only counts
       * when it is the very first thing the CLI reads.
       */
      skillPrefix?: string;
      currentPage?: { title: string; url: string };
      /** 「立即发送」：该会话正在跑就先取消它，等它收尾再开始这一轮（顺序由 Host 定）。 */
      interrupt?: boolean;
    }
  | { type: "cancel"; sessionId?: string }
  | { type: "session.new"; requestId?: string }
  | { type: "session.use"; sessionId: string; requestId?: string }
  | { type: "session.fork"; sessionId: string; requestId?: string }
  | { type: "fs.pick"; requestId: string; mode?: FsPickMode }
  | { type: "fs.save"; requestId: string; name?: string; imageBase64: string; mime: "image/jpeg" }
  | {
      type: "fs.upload";
      requestId: string;
      /** File name, or the path inside the dropped folder when `dir` is set. */
      name: string;
      /** Set when the file came from a dropped folder: the dropped folder's own name. */
      dir?: string;
      base64: string;
    }
  | { type: "fs.reveal"; path: string }
  | { type: "fs.preview"; requestId: string; path: string }
  | { type: "page.pick"; requestId: string; hint?: string }
  | { type: "page.pick.cancel"; requestId?: string }
  | { type: "control.anchor"; sessionId?: string; tabId?: number }
  | { type: "control.release"; sessionId?: string }
  /** `auto` marks a grant that came from the permission mode, not from a click: it must not
   * be remembered as a user approval (`trusted`). */
  | { type: "control.grant"; requestId: string; allow: boolean; auto?: boolean }
  | { type: "release.check" }
  | { type: "model.set"; modelId: string; sessionId?: string }
  | { type: "page.update"; page: CurrentPage }
  | { type: "tabs.update"; snapshot: TabsSnapshot }
  | { type: "browser.result"; result: BrowserResult }
  | { type: "native.ui"; tabId: number; url: string; events: NativeUiEvent[] }
  | { type: "overlays"; tabId: number; url: string; overlays: OverlayReport[]; modal: boolean }
  | {
      type: "permission.reply";
      id: number;
      outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
    }
  | { type: "cursor.reply"; id: number; result: unknown }
  | { type: "ui.state.set"; state: Record<string, unknown> }
  | { type: "ui.state.set"; index: number; total: number; data: string };

export type HostStatusState = "starting" | "idle" | "connecting" | "ready" | "error" | "missing";

export type FsPickMode = "mixed" | "files" | "folders";

export type HostToExt =
  | { type: "hello"; workspace: string; agentPath: string; providerId?: string; version?: string }
  | { type: "ui.state"; state: Record<string, unknown> | null }
  // 镜像超过 Native Messaging 单帧上限时的切片形态（见 internal/host/uistate_wire.go）
  | { type: "ui.state"; index: number; total: number; data: string }
  | { type: "status"; state: HostStatusState; error?: string }
  | { type: "agents"; agents: AgentInfo[]; selectedId?: string }
  | { type: "agent.progress"; progress: AgentProgress }
  | { type: "session"; sessionId: string; replay?: boolean; created?: boolean; forked?: boolean; requestId?: string }
  | { type: "update"; update: Record<string, unknown>; sessionId?: string }
  | { type: "permission"; id: number; params: Record<string, unknown>; sessionId?: string }
  | { type: "cursor"; id?: number; method: string; params: Record<string, unknown>; sessionId?: string }
  | { type: "turn.end"; stopReason: string; sessionId?: string; error?: string; interrupted?: boolean }
  | { type: "page"; page: CurrentPage }
  | { type: "control"; sessions: TabControlState[] }
  | {
      type: "control.request";
      requestId: string;
      tabId: number;
      title: string;
      url: string;
      sessionId?: string;
    }
  | { type: "control.request.done"; requestId: string; allow?: boolean }
  | { type: "browser.command"; command: BrowserCommand; sessionId?: string }
  | { type: "browser.result"; result: BrowserResult; sessionId?: string }
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
  | {
      type: "fs.uploaded";
      requestId: string;
      items: AttachmentItem[];
      error?: string;
    }
  | { type: "models"; models: AgentModel[]; currentId: string }
  | {
      type: "agentModes";
      source: AgentModeSource;
      configId?: string;
      currentId: string;
      options: AgentModeOption[];
      pinned?: string;
      /** False when there is nothing to switch (fewer than two modes advertised). */
      available: boolean;
    }
  | { type: "agentOptions"; options: AgentOption[] }
  | SelectionResult
  /** SW → 侧栏：用户点了「引用」，把这段网页文字插进输入框（不走 Host）。 */
  | { type: "selection.quote"; text: string; title?: string; url?: string; tabId?: number }
  | { type: "skills"; items: SkillItem[] }
  | { type: "fs.revealed"; path: string; missing?: boolean; error?: string }
  // An older host replying to a command it does not implement: see internal/host/host.go.
  | { type: "host.unsupported"; requestId: string; command?: string; error?: string }
  | {
      type: "fs.previewed";
      requestId: string;
      mime?: string;
      size?: number;
      index?: number;
      total?: number;
      data?: string;
      error?: string;
    }
  | { type: "artifacts"; items: AttachmentItem[]; sessionId?: string }
  | { type: "release"; version: string; latest: string; checkedAt?: string; stale?: boolean }
  | {
      type: "page.picked";
      requestId: string;
      items: AttachmentItem[];
      cancelled?: boolean;
      error?: string;
    };

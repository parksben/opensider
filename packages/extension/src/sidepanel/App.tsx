import type {
  AgentInfo,
  AgentModeOption,
  AgentModel,
  AgentOption,
  AgentProgress,
  AttachmentItem,
  BrowserCommand,
  BrowserResult,
  ContextUsage,
  CurrentPage,
  ExtToHost,
  HostToExt,
  HostStatusState,
  FsPickMode,
  SkillItem,
  TabControlState,
} from "@shared";
import { MousePointer2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { encodeImageBlob } from "../image-encode";
import { fileToBase64, type DropPlan } from "./file-drop";
import { blobUrlFromBase64Chunks, isAttachedImagePath } from "./image-preview";
import { applyAcpUpdate, applyBrowserTool, createUserMessage, usageFromUpdate } from "./acp-messages";
import { connectSidebar } from "./bridge";
import type { ChatMessage, PermissionRequest, PlanPrompt, QuestionPrompt, TodoItem } from "./chat-types";
import { AgentSetup } from "./components/AgentSetup";
import { BridgeSetup } from "./components/BridgeSetup";
import { ChatPane } from "./components/ChatPane";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ControlBanner, type BorrowRequest } from "./components/ControlBanner";
import { Header } from "./components/Header";
import { COMPACT_MAIN_PX, COMPOSER_ACTION_FLAT_PX, ICON_ONLY_MAIN_PX, MODEL_NARROW_MAIN_PX } from "./layout";
import { PermissionBar } from "./components/PermissionBar";
import { SessionDrawer } from "./components/SessionDrawer";
import { UpdateDialog } from "./components/UpdateDialog";
import { UninstallDialog } from "./components/UninstallDialog";
import { applyLocale, detectBrowserLocale, readCachedLocale, t, type Locale } from "./i18n";
import { BindRegistry, findSessionIdByAcpId } from "./session-bind";
import { displayVersion, isNewer, type ReleaseCheckState } from "./version";
import {
  applyResolvedTheme,
  resolveTheme,
  watchSystemTheme,
  applyThemePreference,
  detectBrowserTheme,
  readCachedTheme,
  type ThemePreference,
} from "./theme";
import type { QueuedMessage } from "./queued-message";
import {
  buildForkContext,
  applyProviderBinding,
  autoPermissionOptionId,
  autoQuestionAnswers,
  bindAcpSession,
  boundAcpId,
  clampSessionDrawerWidth,
  emptySession,
  isWorkspaceWritePermission,
  loadState,
  parseHostState,
  preferHostState,
  saveState,
  SESSION_DRAWER_DEFAULT,
  settleFinishedContent,
  isPlaceholderTitle,
  nextSessionTitle,
  titleFromMessages,
  toPersistedState,
  wrapUserPrompt,
  wrapForkContext,
  textOf,
  type AgentMode,
  type LoadedState,
  type Session,
} from "./persist";

/** 扩展自己的版本（manifest version）。模块级取一次：侧栏多处要拿它和最新 release 比。 */
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
/** How long the bridge may take to answer a file upload before we call it silent. */
const HOST_FILE_TIMEOUT_MS = 20_000;
/** 「暂无新版本」/「检查失败」这类结果提示亮多久。 */
const CHECK_FEEDBACK_MS = 1500;
/** 手点检查后等 Host 回话的上限；超了就当没检查成（离线 / 桥接没起来）。 */
const CHECK_WATCHDOG_MS = 8000;

export function App() {
  const [hydrated, setHydrated] = useState(false);
  const [hostMirrorReady, setHostMirrorReady] = useState(false);
  const loadedRef = useRef<LoadedState | null>(null);
  // 本地热缓存读完之前收到的宿主镜像先存这里：等两边都到齐再按 preferHostState 定胜负，
  // 否则「本地是空、宿主有历史」的恢复场景会被晚到的本地空态盖掉（重装后第一帧就怕这个）。
  const pendingHostStateRef = useRef<Record<string, unknown> | null | undefined>(undefined);
  const hydratedRef = useRef(false);
  const [locale, setLocale] = useState<Locale>(() => readCachedLocale() ?? detectBrowserLocale());
  const [theme, setTheme] = useState<ThemePreference>(() => readCachedTheme() ?? detectBrowserTheme());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedModelByProvider, setSelectedModelByProvider] = useState<Record<string, string>>({});
  const [agentMode, setAgentMode] = useState<AgentMode>("ask");
  // Agent 自己广告的模式（plan / build / ask…）与用户选中的那个。它们是**另一个轴**：
  // agentMode 是我们的权限档位，这两个是引擎自己的工作流模式。
  const [agentModes, setAgentModes] = useState<AgentModeOption[]>([]);
  // 本机全局已装的 skill（与连哪个 Agent 无关），斜杠探测菜单列的就是它。
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const skillsRef = useRef<SkillItem[]>([]);
  const [agentModeId, setAgentModeId] = useState("");
  const [agentModeByProvider, setAgentModeByProvider] = useState<Record<string, string>>({});
  // 引擎广告的其它配置项（推理档位 / 模型开关…）与用户选中的值。值按 Agent 记
  // （configId → value），与模式记忆同一路子；没广告过就是这家不支持，控件不出现。
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  // 划词工具条的「引用」：把一段网页原文插进输入框。用 id 区分两次相同的引用（同一段文字
  // 连点两次也要各插一次），插完由 ChatPane 回调清掉。
  const [quoteInsert, setQuoteInsert] = useState<{ id: string; text: string }>();
  const [agentOptionByProvider, setAgentOptionByProvider] = useState<Record<string, Record<string, string>>>({});
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sawAgents, setSawAgents] = useState(false);
  const [progress, setProgress] = useState<AgentProgress>();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(SESSION_DRAWER_DEFAULT);
  const [compact, setCompact] = useState(false);
  // 两个下拉（模式 / 权限）是否已收成纯图标。与 compact 分开：下拉该早收，其余布局不必跟着早改版。
  const [iconOnly, setIconOnly] = useState(false);
  // ≤MODEL_NARROW_MAIN_PX：模型下拉的最大宽度收到 1/3。
  const [modelNarrow, setModelNarrow] = useState(false);
  // ≥COMPOSER_ACTION_FLAT_PX：四个功能钮（附件 / 拾取 / @ / 斜杠）平铺；不然收成一个加号钮。
  const [actionFlat, setActionFlat] = useState(true);
  const mainColumnRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<HostStatusState>("starting");
  const [error, setError] = useState<string>();
  // 与 status 无关的「刚才那一下没成功」：拖入 / 粘贴失败、桥接太旧或没响应。这些必须
  // 在对话区里看得见（status=ready 时 error 只当 tooltip，用户等于什么都没看到）。
  const [notice, setNotice] = useState<string>();
  const [release, setRelease] = useState<{ version: string; latest: string }>();
  // 桥接版本从 `hello` 拿：它每次连上必发，而 `release` 消息在版本检查失败时可能
  // 根本不来（之前就因此一直显示「未知」）。
  const [bridgeVersion, setBridgeVersion] = useState<string>();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [checkState, setCheckState] = useState<ReleaseCheckState>("idle");
  const checkPendingRef = useRef(false);
  const checkWatchdogRef = useRef(0);
  const checkResetRef = useRef(0);
  const [page, setPage] = useState<CurrentPage>();
  /** Agent 上报的上下文用量；不上报就一直是 undefined，控件不出现。 */
  const [contextUsage, setContextUsage] = useState<ContextUsage>();
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>({});
  const [permissions, setPermissions] = useState<Record<string, PermissionRequest>>({});
  const [questions, setQuestions] = useState<Record<string, QuestionPrompt>>({});
  const [plans, setPlans] = useState<Record<string, PlanPrompt>>({});
  const [pickingElement, setPickingElement] = useState(false);
  /** Tab-control state from the service worker: who holds which tabs, per session. */
  const [controlSessions, setControlSessions] = useState<TabControlState[]>([]);
  /** A pending borrow request (entering a user tab), shown as a card in the banner. */
  const [borrowRequest, setBorrowRequest] = useState<BorrowRequest>();

  const sendRef = useRef<(msg: ExtToHost) => void>(() => undefined);
  const reconnectRef = useRef<() => void>(() => undefined);
  const pageRef = useRef<CurrentPage | undefined>(undefined);
  const statusRef = useRef(status);
  const selectedIdRef = useRef(selectedId);
  const sessionsRef = useRef(sessions);
  /** 在飞的会话请求（new/use/fork/prompt）：requestId ↔ 本地会话，回执按 id 精确配对。 */
  const bindRegistry = useRef(new BindRegistry());
  /** 等绑定完成后要发的首条消息（按会话存，避免两个会话互相覆盖）。 */
  const pendingRegen = useRef(new Map<string, {
    text: string;
    attachments: AttachmentItem[];
    context?: string;
  }>());
  const localeRef = useRef(locale);
  const selectedModelRef = useRef(selectedModelId);
  const selectedModelByProviderRef = useRef(selectedModelByProvider);
  const agentModeRef = useRef(agentMode);
  const agentModesRef = useRef<AgentModeOption[]>([]);
  const agentModeByProviderRef = useRef<Record<string, string>>({});
  const agentOptionByProviderRef = useRef<Record<string, Record<string, string>>>({});
  // 已经发出去的「用户选中的配置项值」（configId=value），避免 Host 推回的旧值反复重发。
  const appliedAgentOptionRef = useRef<Set<string>>(new Set());
  const selectedProviderRef = useRef(selectedProviderId);
  const onboardingRef = useRef(onboardingCompleted);
  const pendingConnectRef = useRef("");
  const connectedProviderRef = useRef("");
  const rollbackRef = useRef<{ providerId: string; wasReady: boolean } | null>(null);
  const skipIdleConnectRef = useRef(false);
  /** 切换 Agent 前的高危确认：跑着的任务会被 Host 停掉旧 runtime 而中断，先问一句。 */
  const [agentSwitch, setAgentSwitch] = useState<{ providerId: string; running: number }>();
  // Host 是否已经扫完 Agent 列表（agents / idle 任一条到过）。自动连接的判断要等它。
  const hostScannedRef = useRef(false);
  const agentsRef = useRef<AgentInfo[]>([]);
  // 已经发出的那次 `agent.connect` 还在进行中。
  //
  // 非有不可：`agents` / `idle` 两条消息与 hydration 之后的判定可能落在同一拍里，各发一次
  // `agent.connect`；Host 每收到一次就 `beginConnect()` 一次并作废上一次，三次并发的结果是
  // 谁都没连完——面板一直停在 `connecting`，模型列表与配置项全空，用户得手动切一次 Agent
  // 才恢复（真实报过，沙箱里能稳定复现）。收到 `connecting` 之外的状态（`ready` / `error` /
  // `missing` / `starting`）就说明这次请求已经结束；`idle` 不算——它只会来自 Host 启动或
  // 我们自己的取消，不代表我们这次请求的结局（否则上面那两条重复的 `idle` 回放又会把门打开）。
  const connectInFlightRef = useRef(false);
  const awaitingCancelRef = useRef(false);
  const pickWaiters = useRef(new Map<string, (items: AttachmentItem[]) => void>());
  // A host older than the extension silently drops commands it does not know, so a stale
  // bridge is worth saying out loud - once, not on every `hello`.
  const hostSkewRef = useRef(false);
  const previewWaiters = useRef(
    new Map<
      string,
      {
        resolve: (url: string) => void;
        reject: (error: Error) => void;
        chunks: string[];
        received: number;
        mime: string;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const appliedModelRef = useRef("");
  // 已经发出去的「用户选中的模式」，避免 Host 推回的旧值把它反复重发。
  const appliedAgentModeRef = useRef("");
  const elementPickId = useRef("");
  const runningIdsRef = useRef<Set<string>>(new Set());
  const queuesRef = useRef<Record<string, QueuedMessage[]>>({});
  const editingQueueRef = useRef<{ sessionId: string; id: string } | null>(null);
  const flushQueueRef = useRef<(sessionId: string) => void>(() => undefined);

  const sendToSessionRef = useRef<(localId: string, text: string, attachments?: AttachmentItem[]) => void>(
    () => undefined,
  );
  const turnStartedAt = useRef(new Map<string, number>());
  pageRef.current = page;
  statusRef.current = status;
  selectedIdRef.current = selectedId;
  sessionsRef.current = sessions;
  localeRef.current = locale;
  selectedModelRef.current = selectedModelId;
  selectedModelByProviderRef.current = selectedModelByProvider;
  agentModeRef.current = agentMode;
  agentModesRef.current = agentModes;
  skillsRef.current = skills;
  agentsRef.current = agents;
  agentModeByProviderRef.current = agentModeByProvider;
  agentOptionByProviderRef.current = agentOptionByProvider;
  selectedProviderRef.current = selectedProviderId;
  onboardingRef.current = onboardingCompleted;

  const applyLoaded = (state: LoadedState) => {
    const nextSessions = state.sessions.length > 0 ? state.sessions : [emptySession()];
    const nextSelectedId = nextSessions.some((session) => session.id === state.selectedId)
      ? state.selectedId
      : nextSessions[0].id;
    applyLocale(state.locale);
    setLocale(state.locale);
    applyThemePreference(state.theme);
    setTheme(state.theme);
    setSessions(nextSessions);
    setSelectedId(nextSelectedId);
    setSelectedModelId(state.selectedModelId);
    setSelectedModelByProvider(state.selectedModelByProvider);
    setAgentMode(state.agentMode);
    setAgentModeByProvider(state.agentModeByProvider);
    setAgentOptionByProvider(state.agentOptionByProvider);
    setSelectedProviderId(state.selectedProviderId);
    setOnboardingCompleted(state.onboardingCompleted);
    setSessionsOpen(state.sessionsOpen);
    setDrawerWidth(state.sessionDrawerWidth);
    loadedRef.current = { ...state, sessions: nextSessions, selectedId: nextSelectedId };
    // 会话列表被整表替换（host 镜像灌回）：悬挂的请求可能指向已不存在的本地会话，清掉。
    bindRegistry.current.clear();
    pendingRegen.current.clear();
  };

  /**
   * 发一个会话绑定请求（new/use/fork），并登记 requestId ↔ 本地会话的配对。
   * 回执（`session` 消息）只认 requestId 精确命中——不再按到达顺序配对，
   * 一次请求没回也不会让后续绑定错位。
   */
  const requestSession = (kind: "new" | "use" | "fork", localId: string, acpId?: string) => {
    const requestId = crypto.randomUUID();
    bindRegistry.current.add(requestId, localId, kind);
    if (kind === "use") sendRef.current({ type: "session.use", sessionId: acpId ?? "", requestId });
    else if (kind === "fork") sendRef.current({ type: "session.fork", sessionId: acpId ?? "", requestId });
    else sendRef.current({ type: "session.new", requestId });
  };

  /**
   * 发 prompt 并登记 requestId：Host 若因 `session/load` 失败被迫换新会话，
   * 会带这个 id 回一条 `session` 回执，让本地绑定跟上新会话。
   */
  const sendPrompt = (
    localId: string,
    sessionId: string,
    text: string,
    interrupt = false,
    anchor = true,
    skillPrefix = "",
  ) => {
    const requestId = crypto.randomUUID();
    bindRegistry.current.add(requestId, localId, "prompt");
    // Anchor the turn to the tab the user is on: the Agent's first write takes that tab
    // over, and a later tab switch by the user will not drag the work somewhere else.
    // Bridge messages (see `sendNudge`) skip this: they are not a new user message.
    if (anchor) {
      sendRef.current({
        type: "control.anchor",
        sessionId: sessionId || undefined,
        tabId: pageRef.current?.tabId,
      });
    }
    sendRef.current({
      type: "prompt",
      text,
      sessionId,
      requestId,
      interrupt,
      ...(skillPrefix ? { skillPrefix } : {}),
      currentPage: pageRef.current
        ? { title: pageRef.current.title, url: pageRef.current.url }
        : undefined,
    });
  };

  const tryBindCurrent = () => {
    if (statusRef.current !== "ready") return;
    if (bindRegistry.current.hasPendingBinds()) return;
    const list = sessionsRef.current;
    const id = selectedIdRef.current || list[0]?.id;
    const session = list.find((item) => item.id === id);
    if (!session) return;
    if (runningIdsRef.current.has(session.id)) return;
    const providerId = selectedProviderRef.current;
    const acpId = boundAcpId(session, providerId);
    if (acpId) {
      requestSession("use", session.id, acpId);
      return;
    }
    if (session.messages.length > 0 && !session.pendingForkContext) {
      patchSession(session.id, (item) => ({
        ...item,
        pendingForkContext: item.pendingForkContext ?? buildForkContext(item.messages),
      }));
    }
    requestSession("new", session.id);
  };

  const requestConnect = (providerId: string, via: "user" | "auto" = "user") => {
    if (!providerId) return;
    // 用户自己发的（点 Agent、点连接）：取消标记到此为止，以后照常自动连。
    if (via === "user") skipIdleConnectRef.current = false;
    if (connectedProviderRef.current === providerId && statusRef.current === "ready") return;
    if (pendingConnectRef.current === providerId && statusRef.current === "connecting") return;
    // 同一次请求只发一次（见 connectInFlightRef）：同一家的重复请求直接当作已在飞行中。
    // 换成另一家则照常发，Host 会作废正在进行的那个。
    if (connectInFlightRef.current && pendingConnectRef.current === providerId) return;
    skipIdleConnectRef.current = false;
    awaitingCancelRef.current = false;
    if (statusRef.current !== "connecting") {
      rollbackRef.current = {
        providerId: connectedProviderRef.current || selectedProviderRef.current,
        wasReady: statusRef.current === "ready" && Boolean(connectedProviderRef.current),
      };
    }
    pendingConnectRef.current = providerId;
    setSelectedProviderId(providerId);
    setSessions((list) => applyProviderBinding(list, providerId));
    setSelectedModelId(selectedModelByProviderRef.current[providerId] || "");
    // 模式集合是上一家的，先清空；记住的选择留在 storage 里等新家广告回来再认。
    setAgentModes([]);
    setAgentModeId("");
    appliedAgentModeRef.current = "";
    appliedModelRef.current = "";
    // 配置项集合也是上一家的，先清空；记住的值留在 storage 里等新家广告回来再认。
    setAgentOptions([]);
    appliedAgentOptionRef.current.clear();
    setModels([]);
    setProgress(undefined);
    connectInFlightRef.current = true;
    sendRef.current({
      type: "agent.connect",
      providerId,
      policy: agentModeRef.current,
      modeId: agentModeByProviderRef.current[providerId] || undefined,
      optionValues: agentOptionByProviderRef.current[providerId] || undefined,
    });
  };

  /**
   * 自动连上「记得的那家」：只看当前状态快照，不看消息到达顺序。
   *
   * 这个判断原先只写在「收到 agents / idle 那一刻」的分支里，而本地缓存的读取（会话多、
   * 历史长时要慢上不少）与 Host 回放是赛跑的：回放先到的时候 refs 还全是空的（引导状态
   * 还没灌进来、selectedProvider 也空），判断直接跳过，之后就再没人重新判一次——面板看着
   * 正常，模型列表和推理档位却一片空白，得手动切一次 Agent 才醒过来（用户报过，用大
   * 状态的沙箱能稳定复现）。所以：两条消息分支与 hydration 完成之后都调它。
   */
  const autoConnectTarget = (list: AgentInfo[] = agentsRef.current): string => {
    if (!onboardingRef.current) return "";
    // 用户刚取消过：不要再自动连（这个标记由用户自己的动作解除，见 requestConnect）。
    if (skipIdleConnectRef.current) return "";
    // 已经有一次连接在飞：不要在同一拍里再发一次（见 connectInFlightRef）。
    if (connectInFlightRef.current) return "";
    // Host 还没扫完 Agent 列表（只报过 starting）：这会儿连上去会和它自己的扫描撞车。
    if (!hostScannedRef.current) return "";
    if (statusRef.current !== "idle" && statusRef.current !== "starting") return "";
    return selectedProviderRef.current || list[0]?.id || "";
  };

  /**
   * header 上点 Agent：有正在跑的任务就先弹窗确认，别默默把它们打断。
   *
   * 只拦这一条用户主动切 Agent 的路径。自动连接（重载 / 重装后恢复上次那家）不弹窗——
   * 那是恢复、不是切换；点子已经连着的那家也不弹（requestConnect 本来就会自己 return）。
   */
  const pickAgent = (providerId: string) => {
    if (!providerId) return;
    if (providerId === connectedProviderRef.current && statusRef.current === "ready") {
      requestConnect(providerId);
      return;
    }
    const running = runningIdsRef.current.size;
    if (running > 0) {
      setAgentSwitch({ providerId, running });
      return;
    }
    requestConnect(providerId);
  };

  /** 确认切换：先把这几轮按中断结算（旧 runtime 确实被 Host 停掉了），再发起连接。 */
  const confirmAgentSwitch = () => {
    const target = agentSwitch;
    setAgentSwitch(undefined);
    if (!target) return;
    finishAllTurns();
    requestConnect(target.providerId);
  };

  const cancelConnect = () => {
    if (statusRef.current !== "connecting") return;
    connectInFlightRef.current = false;
    const snap = rollbackRef.current;
    pendingConnectRef.current = "";
    awaitingCancelRef.current = true;
    setProgress(undefined);
    setError(undefined);
    if (snap?.wasReady && snap.providerId) {
      skipIdleConnectRef.current = false;
      selectedProviderRef.current = snap.providerId;
      setSelectedProviderId(snap.providerId);
      setSessions((list) => applyProviderBinding(list, snap.providerId));
      setSelectedModelId(selectedModelByProviderRef.current[snap.providerId] || "");
      connectedProviderRef.current = snap.providerId;
      statusRef.current = "ready";
      setStatus("ready");
    } else {
      skipIdleConnectRef.current = true;
      const restoreId = snap?.providerId ?? "";
      selectedProviderRef.current = restoreId;
      setSelectedProviderId(restoreId);
      if (restoreId) setSessions((list) => applyProviderBinding(list, restoreId));
      connectedProviderRef.current = "";
      statusRef.current = "idle";
      setStatus("idle");
    }
    sendRef.current({ type: "agent.cancelConnect" });
  };

  const syncRunning = (next: Set<string>) => {
    runningIdsRef.current = next;
    setRunningIds([...next]);
  };

  /**
   * ACP 会话 id → 本地会话 id。找不到就返回 undefined——调用方必须「找不到就
   * 丢弃」，绝不允许退回当前选中会话（那是旧任务内容串进新会话的通道）。
   */
  const localIdForAcp = (acpId?: string) => findSessionIdByAcpId(sessionsRef.current, acpId);

  const clearHitl = (id: string) => {
    setPermissions((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setQuestions((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPlans((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId],
  );

  const patchSession = (id: string, updater: (session: Session) => Session) => {
    setSessions((current) => current.map((session) => (session.id === id ? updater(session) : session)));
  };

  const beginTurn = (id: string) => {
    turnStartedAt.current.set(id, Date.now());
    const next = new Set(runningIdsRef.current);
    next.add(id);
    syncRunning(next);
    patchSession(id, (session) => (session.todos.length === 0 ? session : { ...session, todos: [] }));
  };

  const replyPermission = (id: number, options: PermissionRequest["options"]): boolean => {
    const optionId = autoPermissionOptionId(options);
    if (!optionId) return false;
    sendRef.current({
      type: "permission.reply",
      id,
      outcome: { outcome: "selected", optionId },
    });
    return true;
  };

  const replyQuestion = (id: number, questions: QuestionPrompt["questions"]) => {
    sendRef.current({
      type: "cursor.reply",
      id,
      result: { outcome: { outcome: "answered", answers: autoQuestionAnswers(questions) } },
    });
  };

  const replyPlan = (id: number) => {
    sendRef.current({
      type: "cursor.reply",
      id,
      result: { outcome: { outcome: "accepted" } },
    });
  };

  const recordBrowserTool = (command: BrowserCommand, result?: BrowserResult, sessionId?: string) => {
    let localId: string | undefined;
    if (sessionId) {
      // Host 标注了来源会话：只认精确路由，映射不到宁可丢掉（不落到选中会话）。
      localId = localIdForAcp(sessionId);
      if (!localId) return;
    } else {
      // 没有标注（多会话并行时 Host 无法判断）：退回「选中 / 唯一运行中」启发式。
      localId = runningIdsRef.current.has(selectedIdRef.current)
        ? selectedIdRef.current
        : ([...runningIdsRef.current][0] ?? selectedIdRef.current);
      if (!localId) return;
    }
    const modelId = selectedModelRef.current;
    const modelName =
      models.find((item) => item.id === modelId)?.name ||
      (!modelId || modelId === "auto" ? "Auto" : modelId);
    updateSessionMessages(localId, (current) => applyBrowserTool(current, command, result, { modelId, modelName }));
  };

  const updateSessionMessages = (id: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== id) return session;
        const messages = updater(session.messages);
        return {
          ...session,
          messages,
          title: nextSessionTitle(session, messages),
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  // 结算一轮的结果：补时长 + 把没收尾的内容收干净。
  const stampTurnEnd = (target: string, started: number) => {
    const durationMs = Math.max(0, Date.now() - started);
    updateSessionMessages(target, (messages) => {
      const last = messages[messages.length - 1];
      if (last?.role !== "assistant" || last.durationMs != null) return messages;
      if (last.createdAt.getTime() < started - 2000) return messages;
      return [...messages.slice(0, -1), { ...last, durationMs, content: settleFinishedContent(last.content) }];
    });
  };

  const finishTurn = (id?: string) => {
    const target = id ?? selectedIdRef.current;
    if (!target) return;
    const started = turnStartedAt.current.get(target);
    turnStartedAt.current.delete(target);
    if (!runningIdsRef.current.has(target) && started == null) return;
    const next = new Set(runningIdsRef.current);
    next.delete(target);
    syncRunning(next);
    if (started == null) return;
    stampTurnEnd(target, started);
  };

  // 被「立即发送」顶掉的那一轮：只结算它的时长 / 内容，running 留给接上来的新一轮
  // （新消息已经上屏，所以新一轮的流式内容会落到新消息上）。
  const settleSupersededTurn = (target: string) => {
    const started = turnStartedAt.current.get(target);
    if (started == null) return;
    turnStartedAt.current.delete(target);
    stampTurnEnd(target, started);
  };

  const finishAllTurns = () => {
    for (const id of [...runningIdsRef.current]) finishTurn(id);
  };

  const handleHost = (msg: HostToExt) => {
    if (msg.type === "skills") {
      setSkills(msg.items);
      return;
    }
    if (msg.type === "agents") {
      setSawAgents(true);
      setAgents(msg.agents);
      if (!selectedProviderRef.current && msg.agents[0]) {
        setSelectedProviderId(msg.agents[0].id);
      }
      // 扫完了（不管扫没扫到 CLI）：从现在起可以按状态快照自动连。
      hostScannedRef.current = true;
      const target = autoConnectTarget(msg.agents);
      if (target) requestConnect(target, "auto");
      return;
    }
    if (msg.type === "agent.progress") {
      if (awaitingCancelRef.current) return;
      setProgress(msg.progress);
      return;
    }
    if (msg.type === "hello") {
      if (msg.providerId) connectedProviderRef.current = msg.providerId;
      // 面板一挂上就把 skill 列表要一份（Host 侧有 5 分钟缓存，不会真去扫）。
      sendRef.current({ type: "skills.refresh" });
      setBridgeVersion(displayVersion(msg.version));
      const host = displayVersion(msg.version);
      const extension = displayVersion(EXTENSION_VERSION);
      // Only compare real versions: a dev build reports something unparseable, and nagging
      // about it would be noise.
      if (host && extension && isNewer(extension, host) && !hostSkewRef.current) {
        hostSkewRef.current = true;
        setNotice(t(localeRef.current, "hostOutdated"));
      }
      return;
    }
    if (msg.type === "ui.state") {
      if (!("state" in msg)) {
        // 分片形态由 SW 重组后才转发（background.ts）；真漏过来的碎片直接忽略。
        return;
      }
      if (!hydratedRef.current) {
        // 本地缓存还没读完：先把镜像存着，由加载完成统一裁决（见下面的加载 effect）。
        pendingHostStateRef.current = msg.state;
        setHostMirrorReady(true);
        return;
      }
      const host = parseHostState(msg.state);
      const local = loadedRef.current;
      if (host && (!local || preferHostState(local, host))) {
        applyLoaded(host);
      }
      setHostMirrorReady(true);
      return;
    }
    if (msg.type === "status") {
      if (awaitingCancelRef.current && msg.state === "connecting") return;
      if (msg.state === "idle" || msg.state === "ready" || msg.state === "error" || msg.state === "missing") {
        awaitingCancelRef.current = false;
      }
      // 处理器里必须先把新状态写进 ref：下面 tryBindCurrent 读的就是它，而渲染期的
      // `statusRef.current = status` 要等下一次渲染才生效。不写的话，这次「连接就绪」
      // 的会话绑定会被整条跳过——会话没建起来，依赖会话广告的 Agent 模式下拉就要等到
      // 用户发第一条消息才出现（见 docs/TECH_DESIGN.md「同步与记忆」）。
      statusRef.current = msg.state;
      setStatus(msg.state);
      setError(msg.error);
      if (msg.state !== "ready") {
        // 连接未就绪：在飞的绑定 / 首条消息请求都不会再有回执，清掉防残留错配。
        bindRegistry.current.clear();
        pendingRegen.current.clear();
      }
      if (msg.state === "error" || msg.state === "missing") {
        pendingConnectRef.current = "";
        connectedProviderRef.current = "";
        finishAllTurns();
      }
      if (msg.state !== "ready") appliedModelRef.current = "";
      // 连接请求有结果了（成功 / 报错 / SW 重连换了 Host）：解除在飞标记。**不**在
      // `connecting`（那正是「还在连」）与 `idle`（只会来自 Host 启动或我们自己的取消）
      // 上解除，见 connectInFlightRef 的注释。
      if (msg.state !== "connecting" && msg.state !== "idle") connectInFlightRef.current = false;
      if (msg.state === "ready") {
        connectedProviderRef.current = selectedProviderRef.current;
        pendingConnectRef.current = "";
        if (!onboardingRef.current) setOnboardingCompleted(true);
        setProgress(undefined);
        tryBindCurrent();
      }
      if (msg.state === "idle") {
        // idle 只在 Host 扫完 Agent 列表之后才会报出来。
        hostScannedRef.current = true;
        setProgress(undefined);
        const target = autoConnectTarget();
        if (target) requestConnect(target, "auto");
      }
      return;
    }
    if (msg.type === "session") {
      // 只认 requestId 精确配对的回执；SW 重连回放 / Host 自发消息不带 id，
      // 一律不改动本地绑定（错位配对会把旧任务的内容串进新会话）。
      const ticket = bindRegistry.current.take(msg.requestId);
      if (!ticket) return;
      patchSession(ticket.localId, (session) => ({
        ...bindAcpSession(session, selectedProviderRef.current, msg.sessionId),
        pendingForkContext:
          ticket.kind === "fork" && msg.forked === false
            ? (session.pendingForkContext ?? buildForkContext(session.messages))
            : session.pendingForkContext,
      }));
      const regen = pendingRegen.current.get(ticket.localId);
      if (regen && ticket.kind === "new") {
        pendingRegen.current.delete(ticket.localId);
        const { skillPrefix, body } = wrapUserPrompt(regen.text, regen.attachments, skillsRef.current);
        beginTurn(ticket.localId);
        setError(undefined);
        sendPrompt(
          ticket.localId,
          msg.sessionId,
          regen.context ? `${wrapForkContext(regen.context)}\n\n${body}` : body,
          false,
          true,
          skillPrefix,
        );
      }
      return;
    }
    if (msg.type === "page") {
      setPage(msg.page);
      return;
    }

    if (msg.type === "control") {
      setControlSessions(msg.sessions);
      return;
    }

    if (msg.type === "control.request") {
      setBorrowRequest({
        requestId: msg.requestId,
        tabId: msg.tabId,
        title: msg.title,
        url: msg.url,
        sessionId: msg.sessionId,
      });
      return;
    }

    if (msg.type === "control.request.done") {
      setBorrowRequest((current) => (current?.requestId === msg.requestId ? undefined : current));
      return;
    }

    if (msg.type === "release") {
      const next = {
        version: typeof msg.version === "string" ? msg.version : "",
        latest: typeof msg.latest === "string" ? msg.latest : "",
      };
      setRelease(next);
      // 用户手点的「检查更新」：这条回话就是结果——有新版本直接开提示词模态窗，
      // 没有就短暂亮一下「暂无新版本」，不要默默把按钮改回原样。
      if (checkPendingRef.current) {
        checkPendingRef.current = false;
        window.clearTimeout(checkWatchdogRef.current);
        if (msg.stale) {
          // 在线检查失败、这只是旧缓存：如实报失败，不要假装「已是最新」。
          flashCheckState("failed");
          return;
        }
        if (isNewer(next.latest, EXTENSION_VERSION) || isNewer(next.latest, next.version)) {
          setCheckState("idle");
          setUpdateOpen(true);
        } else {
          flashCheckState("current");
        }
      }
      return;
    }
    if (msg.type === "agentModes") {
      const options = msg.options ?? [];
      setAgentModes(options);
      const providerId = selectedProviderRef.current;
      const remembered = agentModeByProviderRef.current[providerId] ?? "";
      const advertised = remembered !== "" && options.some((option) => option.id === remembered);
      setAgentModeId(advertised ? remembered : msg.currentId || options[0]?.id || "");
      // 记住的选择还没落到会话上（刚连上、刚开会话、或 Agent 自己换了模式）：补一次。
      // appliedAgentModeRef 保证同一个值只重试一次，不会与服务端来回拉锯。
      if (advertised && remembered !== msg.currentId && appliedAgentModeRef.current !== remembered) {
        appliedAgentModeRef.current = remembered;
        const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
        sendRef.current({ type: "agent.setMode", modeId: remembered, sessionId: session?.acpSessionId });
      }
      return;
    }
    if (msg.type === "selection.quote") {
      const text = String(msg.text ?? "").trim();
      if (text) setQuoteInsert({ id: crypto.randomUUID(), text });
      return;
    }
    if (msg.type === "agentOptions") {
      const options = msg.options ?? [];
      setAgentOptions(options);
      const providerId = selectedProviderRef.current;
      const remembered = agentOptionByProviderRef.current[providerId] ?? {};
      const applied = appliedAgentOptionRef.current;
      // 记住的值还没落到会话上（刚连上、刚开会话、或引擎换模型后把档位重置了）：补一次。
      // applied 保证同一个值只重试一次，不会与服务端来回拉锯；引擎报回同一个值时把它
      // 撤掉，这样以后再次被重置还能补。
      for (const option of options) {
        const value = remembered[option.id];
        if (!value) continue;
        if (option.current === value) {
          applied.delete(`${option.id}=${value}`);
          continue;
        }
        const key = `${option.id}=${value}`;
        if (applied.has(key)) continue;
        applied.add(key);
        const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
        sendRef.current({ type: "agent.setOption", configId: option.id, value, sessionId: session?.acpSessionId });
      }
      return;
    }
    if (msg.type === "models") {
      const incoming = msg.models.filter((model, index, all) => all.findIndex((item) => item.id === model.id) === index);
      if (incoming.length === 0 && statusRef.current !== "ready") {
        return;
      }
      setModels(incoming);
      const desired = selectedModelRef.current;
      const autoId = incoming.find((model) => model.id === "auto")?.id;
      const known = incoming.some((model) => model.id === desired);
      if (desired && desired !== "auto" && known) {
        if (desired !== msg.currentId && desired !== appliedModelRef.current) {
          appliedModelRef.current = desired;
          sendRef.current({ type: "model.set", modelId: desired });
        }
      } else {
        setSelectedModelId(autoId || msg.currentId || incoming[0]?.id || "");
      }
      return;
    }
    if (
      msg.type === "fs.picked" ||
      msg.type === "fs.saved" ||
      msg.type === "fs.uploaded" ||
      msg.type === "page.picked"
    ) {
      const waiter = pickWaiters.current.get(msg.requestId);
      pickWaiters.current.delete(msg.requestId);
      if (msg.type === "page.picked") setPickingElement(false);
      if (msg.error === "restricted") setError(t(localeRef.current, "pickPageFailed"));
      else if (msg.error === "inject") setError(t(localeRef.current, "pickInjectFailed"));
      else if (msg.error) setError(msg.error);
      waiter?.(msg.items ?? []);
      return;
    }
    if (msg.type === "host.unsupported") {
      // The bridge is older than the extension: it does not have this command. Say so
      // instead of leaving the caller waiting for a reply that is never coming.
      const waiter = pickWaiters.current.get(msg.requestId);
      pickWaiters.current.delete(msg.requestId);
      setNotice(t(localeRef.current, "hostUnsupported"));
      waiter?.([]);
      return;
    }
    if (msg.type === "fs.previewed") {
      const waiter = previewWaiters.current.get(msg.requestId);
      if (!waiter) return;
      const fail = (error: Error) => {
        previewWaiters.current.delete(msg.requestId);
        window.clearTimeout(waiter.timer);
        waiter.reject(error);
      };
      if (msg.error) {
        fail(new Error(msg.error));
        return;
      }
      const index = msg.index ?? 0;
      const total = msg.total ?? 0;
      if (!msg.data || total <= 0 || index < 0 || index >= total) {
        fail(new Error("invalid preview chunk"));
        return;
      }
      if (waiter.chunks.length !== total) waiter.chunks = Array.from({ length: total }, () => "");
      if (!waiter.chunks[index]) {
        waiter.chunks[index] = msg.data;
        waiter.received += 1;
      }
      if (msg.mime) waiter.mime = msg.mime;
      if (waiter.received < total) return;
      previewWaiters.current.delete(msg.requestId);
      window.clearTimeout(waiter.timer);
      try {
        waiter.resolve(blobUrlFromBase64Chunks(waiter.chunks, waiter.mime));
      } catch (error) {
        waiter.reject(error instanceof Error ? error : new Error("preview decode failed"));
      }
      return;
    }
    if (msg.type === "artifacts") {
      let localId: string | undefined;
      if (msg.sessionId) {
        // 有标注：只认精确路由，映射不到宁可丢掉（不落到选中会话）。
        localId = localIdForAcp(msg.sessionId);
        if (!localId) return;
      } else {
        localId = selectedIdRef.current;
      }
      if (!localId) return;
      const items = Array.isArray(msg.items) ? msg.items : [];
      patchSession(localId, (session) => ({ ...session, artifacts: items }));
      return;
    }
    if (msg.type === "fs.revealed") {
      if (!msg.missing || !msg.path) return;
      const path = msg.path;
      for (const session of sessionsRef.current) {
        const items = session.artifacts ?? [];
        if (!items.some((item) => item.path === path && !item.missing)) continue;
        patchSession(session.id, (current) => ({
          ...current,
          artifacts: (current.artifacts ?? []).map((item) =>
            item.path === path ? { ...item, missing: true } : item,
          ),
        }));
      }
      return;
    }
    if (msg.type === "browser.command") {
      recordBrowserTool(msg.command, undefined, msg.sessionId);
      return;
    }
    if (msg.type === "browser.result") {
      recordBrowserTool({ id: msg.result.id, method: msg.result.method }, msg.result, msg.sessionId);
      return;
    }
    if (msg.type === "update") {
      const localId = localIdForAcp(msg.sessionId);
      if (!localId) return;
      if (!runningIdsRef.current.has(localId)) {
        const session = sessionsRef.current.find((item) => item.id === localId);
        const last = session?.messages[session.messages.length - 1];
        const live = last?.role === "assistant" && last.durationMs == null;
        if (!live) return;
      }
      const modelId = selectedModelRef.current;
      const modelName =
        models.find((item) => item.id === modelId)?.name ||
        (!modelId || modelId === "auto" ? "Auto" : modelId);
      // 上下文用量只更新那个环，不能落进消息列表（否则会多出一条空的 assistant 气泡）。
      const usage = usageFromUpdate(msg.update);
      if (usage) {
        setContextUsage(usage);
        return;
      }
      updateSessionMessages(localId, (current) => applyAcpUpdate(current, msg.update, { modelId, modelName }));
      return;
    }
    if (msg.type === "turn.end") {
      const localId = localIdForAcp(msg.sessionId);
      if (!localId) return;
      // 该回合已结束，不会再收到这轮 prompt 的绑定修正回执，清掉悬挂项。
      bindRegistry.current.dropPrompts(localId);
      if (msg.interrupted) {
        // 被「立即发送」顶掉的那一轮：只结算它自己，不清 running、也不 flush 队列 ——
        // 新消息已经带着 interrupt 交给 Host，新一轮正在接上来。
        settleSupersededTurn(localId);
      } else {
        finishTurn(localId);
        flushQueueRef.current(localId);
      }
      if (msg.stopReason === "error" && !msg.interrupted && localId === selectedIdRef.current) {
        setError(msg.error?.trim() || t(localeRef.current, "turnError"));
      }
      return;
    }
    if (msg.type === "permission") {
      const localId = localIdForAcp(msg.sessionId);
      if (!localId) return;
      const toolCall = msg.params.toolCall as { title?: string } | undefined;
      const options = (msg.params.options as PermissionRequest["options"]) ?? [];
      const workspaceWrite = isWorkspaceWritePermission(msg.params);
      const mode = agentModeRef.current;
      if (
        (mode === "auto" || mode === "unattended" || (mode === "workspace" && workspaceWrite)) &&
        replyPermission(msg.id, options)
      ) {
        setPermissions((current) => {
          if (!(localId in current)) return current;
          const next = { ...current };
          delete next[localId];
          return next;
        });
        return;
      }
      setPermissions((current) => ({
        ...current,
        [localId]: {
          id: msg.id,
          title: toolCall?.title ?? t(localeRef.current, "wantsTool"),
          options,
          workspaceWrite,
        },
      }));
      return;
    }
    if (msg.type === "cursor") {
      const localId = localIdForAcp(msg.sessionId);
      if (msg.method === "cursor/update_todos") {
        if (!localId) return;
        const incoming = (msg.params.todos as TodoItem[]) ?? [];
        const merge = Boolean(msg.params.merge);
        patchSession(localId, (session) => ({
          ...session,
          todos: applyTodos(session.todos, incoming, merge),
        }));
        return;
      }
      if (msg.method === "cursor/ask_question" && msg.id !== undefined && localId) {
        const requestId = msg.id;
        const incoming = (msg.params.questions as QuestionPrompt["questions"]) ?? [];
        if (agentModeRef.current === "unattended") {
          replyQuestion(requestId, incoming);
          setQuestions((current) => {
            if (!(localId in current)) return current;
            const next = { ...current };
            delete next[localId];
            return next;
          });
          return;
        }
        setQuestions((current) => ({
          ...current,
          [localId]: {
            id: requestId,
            title: msg.params.title as string | undefined,
            questions: incoming,
          },
        }));
        return;
      }
      if (msg.method === "cursor/create_plan" && msg.id !== undefined && localId) {
        const requestId = msg.id;
        if (agentModeRef.current === "unattended") {
          replyPlan(requestId);
          setPlans((current) => {
            if (!(localId in current)) return current;
            const next = { ...current };
            delete next[localId];
            return next;
          });
          return;
        }
        setPlans((current) => ({
          ...current,
          [localId]: {
            id: requestId,
            name: msg.params.name as string | undefined,
            overview: msg.params.overview as string | undefined,
            plan: String(msg.params.plan ?? ""),
          },
        }));
      }
    }
  };

  const handleHostRef = useRef(handleHost);
  handleHostRef.current = handleHost;

  useEffect(() => {
    void loadState().then((state) => {
      hydratedRef.current = true;
      const pendingHost = pendingHostStateRef.current;
      pendingHostStateRef.current = undefined;
      if (pendingHost !== undefined) {
        const host = parseHostState(pendingHost);
        applyLoaded(host && preferHostState(state, host) ? host : state);
      } else {
        applyLoaded(state);
      }
      setHydrated(true);
    });
  }, []);

  useLayoutEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (!hydrated) return;
    // 先把整份状态序列化成 payload：本地热缓存写失败（配额等）只打警告，
    // 绝不能连 Host 镜像一起停掉——重装后的恢复靠的就是它。
    const payload = toPersistedState({
      locale,
      theme,
      selectedId,
      selectedModelId,
      selectedModelByProvider,
      agentMode,
      agentModeByProvider,
      agentOptionByProvider,
      selectedProviderId,
      onboardingCompleted,
      sessionsOpen,
      sessionDrawerWidth: drawerWidth,
      sessions,
    });
    void saveState(payload).then(() => {
      if (!hostMirrorReady) return;
      sendRef.current({ type: "ui.state.set", state: payload as Record<string, unknown> });
    });
  }, [
    hydrated,
    hostMirrorReady,
    locale,
    theme,
    selectedId,
    selectedModelId,
    selectedModelByProvider,
    agentMode,
    agentModeByProvider,
    agentOptionByProvider,
    selectedProviderId,
    onboardingCompleted,
    sessionsOpen,
    drawerWidth,
    sessions,
  ]);

  useLayoutEffect(() => {
    applyThemePreference(theme);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyResolvedTheme(resolveTheme("system")));
  }, [theme]);

  useLayoutEffect(() => {
    const node = mainColumnRef.current;
    if (!node) return;
    const update = () => {
      setCompact(node.clientWidth < COMPACT_MAIN_PX);
      setIconOnly(node.clientWidth <= ICON_ONLY_MAIN_PX);
      setModelNarrow(node.clientWidth <= MODEL_NARROW_MAIN_PX);
      setActionFlat(node.clientWidth >= COMPOSER_ACTION_FLAT_PX);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hydrated, selectedId]);

  useEffect(() => {
    const { send, reconnect, disconnect } = connectSidebar((msg) => handleHostRef.current(msg));
    sendRef.current = send;
    reconnectRef.current = reconnect;
    return () => {
      sendRef.current = () => undefined;
      reconnectRef.current = () => undefined;
      disconnect();
    };
  }, []);

  // 检查更新的两个计时器：卸载时别留着它们在后台改 state。
  useEffect(
    () => () => {
      window.clearTimeout(checkWatchdogRef.current);
      window.clearTimeout(checkResetRef.current);
    },
    [],
  );

  useEffect(() => {
    if (hydrated) tryBindCurrent();
  }, [hydrated, selectedId]);

  // 自动连接：判定会因为「快照里的四种料」变化而重判——hydration 完成、引导状态与记得的
  // Agent 被 Host 镜像灌进来、Host 报出 agents / 状态变化，都在这些 state 上。
  //
  // 不能只在「消息到达那一刻」判一次：卸载重装后扩展本地缓存是空的（onboardingCompleted
  // false、没有 provider），引导状态只能靠 Host 镜像补，而镜像（1.1MB、分片）往往晚于
  // hydration 到——那一次判定已经跑完了，之后再没人补判，于是首次打开侧栏一直不连，模型
  // 列表就空着（用户报过：关掉侧栏再打开就好，因为那时本地缓存里已经有引导状态了）。
  // 重判是幂等的：在飞标记会挡住重复的 `agent.connect`（见 connectInFlightRef）。
  useEffect(() => {
    if (!hydrated) return;
    const target = autoConnectTarget();
    if (target) requestConnect(target, "auto");
  }, [hydrated, onboardingCompleted, selectedProviderId, sawAgents, status, agents]);

  const setSessionQueue = (sessionId: string, list: QueuedMessage[]) => {
    const next = { ...queuesRef.current };
    if (list.length) next[sessionId] = list;
    else delete next[sessionId];
    queuesRef.current = next;
    setQueues(next);
  };

  const sendToSession = (
    localId: string,
    text: string,
    attachments: AttachmentItem[] = [],
    options: { interrupt?: boolean } = {},
  ) => {
    if (!localId) return;
    const session = sessionsRef.current.find((item) => item.id === localId);
    const user = createUserMessage(text, attachments);
    updateSessionMessages(localId, (current) => [...current, user]);
    if (statusRef.current !== "ready") {
      setError(t(localeRef.current, "offlineSend"));
      setStatus("error");
      return;
    }
    const context = session?.pendingForkContext;
    if (context && session) {
      patchSession(session.id, (item) => ({ ...item, pendingForkContext: undefined }));
    }
    const { skillPrefix, body } = wrapUserPrompt(text, attachments, skillsRef.current);
    beginTurn(localId);
    setError(undefined);
    if (!session?.acpSessionId) {
      pendingRegen.current.set(localId, { text, attachments, context });
      if (!bindRegistry.current.hasLocal(localId)) requestSession("new", localId);
      return;
    }
    sendPrompt(
      localId,
      session.acpSessionId,
      context ? `${wrapForkContext(context)}\n\n${body}` : body,
      options.interrupt,
      true,
      skillPrefix,
    );
  };

  // 「立即发送」：Host 收到 interrupt 会先停掉正在跑的那一轮、等它收尾再跑这条，
  // 所以侧栏只需要立刻把消息上屏并发出去，不用自己等 turn.end 猜时机。
  const sendQueuedNow = (sessionId: string, item: QueuedMessage) => {
    sendToSession(sessionId, item.text, item.attachments, {
      interrupt: runningIdsRef.current.has(sessionId),
    });
  };
  sendToSessionRef.current = sendToSession;

  // 用户刚在接管卡片上点了「允许 / 拒绝」（或切到了自动档）：把 Agent 带回正轨。
  // 这是一条**通道消息**——只发给 Agent，不进本地消息记录（实时与历史都不显示，
  // 也不污染重新生成 / Fork 的「上一条用户消息」）、不重锚点；会话在跑就打断重来，
  // 不再排队（用户点了卡就是最高优先级）。
  const sendNudge = (localId: string, text: string) => {
    if (statusRef.current !== "ready") {
      setError(t(localeRef.current, "offlineSend"));
      setStatus("error");
      return;
    }
    const session = sessionsRef.current.find((item) => item.id === localId);
    if (!session?.acpSessionId) return;
    const interrupt = runningIdsRef.current.has(localId);
    beginTurn(localId);
    setError(undefined);
    sendPrompt(localId, session.acpSessionId, text, interrupt, false);
  };

  const continueAfterBorrow = (request: BorrowRequest, allow: boolean) => {
    const text = t(
      localeRef.current,
      allow ? "controlContinueAllowed" : "controlContinueDenied",
    ).replace("{title}", request.title || request.url);
    const session = request.sessionId
      ? sessionsRef.current.find(
          (item) =>
            item.acpSessionId === request.sessionId ||
            Object.values(item.acpByProvider ?? {}).includes(request.sessionId as string),
        )
      : sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!session) return;
    sendNudge(session.id, text);
  };

  const flushQueue = (sessionId: string) => {
    if (!sessionId || runningIdsRef.current.has(sessionId)) return;
    const list = queuesRef.current[sessionId] ?? [];
    const first = list[0];
    if (!first) return;
    const editing = editingQueueRef.current;
    if (editing && editing.sessionId === sessionId && editing.id === first.id) return;
    setSessionQueue(sessionId, list.slice(1));
    sendToSession(sessionId, first.text, first.attachments);
  };
  flushQueueRef.current = flushQueue;

  const onSend = (text: string, attachments: AttachmentItem[] = []) => {
    const localId = selectedIdRef.current;
    if (localId) sendToSession(localId, text, attachments);
  };

  const onEnqueue = (text: string, attachments: AttachmentItem[] = []) => {
    const sessionId = selectedIdRef.current;
    if (!sessionId) return;
    const item: QueuedMessage = { id: crypto.randomUUID(), text, attachments };
    setSessionQueue(sessionId, [...(queuesRef.current[sessionId] ?? []), item]);
  };

  const onUpdateQueued = (id: string, text: string, attachments: AttachmentItem[]) => {
    const sessionId = selectedIdRef.current;
    if (!sessionId) return;
    const list = queuesRef.current[sessionId] ?? [];
    setSessionQueue(
      sessionId,
      list.map((item) => (item.id === id ? { ...item, text, attachments } : item)),
    );
    if (editingQueueRef.current?.sessionId === sessionId && editingQueueRef.current.id === id) {
      editingQueueRef.current = null;
    }
    flushQueue(sessionId);
  };

  const onDeleteQueued = (id: string) => {
    const sessionId = selectedIdRef.current;
    if (!sessionId) return;
    setSessionQueue(
      sessionId,
      (queuesRef.current[sessionId] ?? []).filter((item) => item.id !== id),
    );
    if (editingQueueRef.current?.sessionId === sessionId && editingQueueRef.current.id === id) {
      editingQueueRef.current = null;
    }
    flushQueue(sessionId);
  };

  const onSendQueuedNow = (id: string) => {
    const sessionId = selectedIdRef.current;
    if (!sessionId) return;
    const list = queuesRef.current[sessionId] ?? [];
    const item = list.find((entry) => entry.id === id);
    if (!item) return;
    setSessionQueue(
      sessionId,
      list.filter((entry) => entry.id !== id),
    );
    if (editingQueueRef.current?.sessionId === sessionId && editingQueueRef.current.id === id) {
      editingQueueRef.current = null;
    }
    sendQueuedNow(sessionId, item);
  };

  const onEditingQueued = (id?: string) => {
    const sessionId = selectedIdRef.current;
    if (id) {
      if (sessionId) {
        editingQueueRef.current = { sessionId, id };
        flushQueue(sessionId);
      }
      return;
    }
    const prev = editingQueueRef.current;
    editingQueueRef.current = null;
    if (prev) flushQueue(prev.sessionId);
  };

  const onPickAttachments = (mode: FsPickMode = "mixed") =>
    new Promise<AttachmentItem[]>((resolve) => {
      if (statusRef.current !== "ready") {
        setError(t(localeRef.current, "pickFailed"));
        resolve([]);
        return;
      }
      const requestId = crypto.randomUUID();
      pickWaiters.current.set(requestId, resolve);
      sendRef.current({ type: "fs.pick", requestId, mode });
    });

  const onPreviewImage = useCallback((path: string) => {
    return new Promise<string>((resolve, reject) => {
      if (!isAttachedImagePath(path)) {
        reject(new Error("invalid preview path"));
        return;
      }
      if (statusRef.current === "missing") {
        reject(new Error("native host missing"));
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        previewWaiters.current.delete(requestId);
        reject(new Error("preview timed out"));
      }, 20_000);
      previewWaiters.current.set(requestId, {
        resolve,
        reject,
        chunks: [],
        received: 0,
        mime: "",
        timer,
      });
      sendRef.current({ type: "fs.preview", requestId, path });
    });
  }, []);

  /**
   * A host reply, or `undefined` when the bridge stayed silent for too long. Without this a
   * request to a bridge that does not know the command (an older host) hangs forever with
   * the UI showing nothing at all.
   */
  const waitForHostReply = (requestId: string, timeoutMs: number) =>
    new Promise<AttachmentItem[] | undefined>((resolve) => {
      let timer: number | undefined;
      const settle = (items: AttachmentItem[]) => {
        if (timer !== undefined) window.clearTimeout(timer);
        resolve(items);
      };
      pickWaiters.current.set(requestId, settle);
      timer = window.setTimeout(() => {
        // The message handler deletes the waiter before calling it, so a missing entry means
        // the reply already landed (or something cancelled it) - do not resolve twice.
        if (pickWaiters.current.get(requestId) !== settle) return;
        pickWaiters.current.delete(requestId);
        resolve(undefined);
      }, timeoutMs);
    });

  const onPasteImages = async (files: File[]) => {
    if (statusRef.current !== "ready") {
      setError(t(localeRef.current, "pasteFailed"));
      return [] as AttachmentItem[];
    }
    const items: AttachmentItem[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const payload = await encodeImageBlob(file);
        const requestId = crypto.randomUUID();
        const pending = waitForHostReply(requestId, HOST_FILE_TIMEOUT_MS);
        sendRef.current({
          type: "fs.save",
          requestId,
          name: `paste-${Date.now()}-${index}.jpg`,
          imageBase64: payload.imageBase64,
          mime: "image/jpeg",
        });
        const saved = await pending;
        if (!saved) {
          setNotice(t(localeRef.current, "hostTimeout"));
          continue;
        }
        items.push(...saved);
        setNotice(undefined);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t(localeRef.current, "pasteFailed"));
      }
    }
    return items;
  };

  const onUploadFiles = async (plan: DropPlan) => {
    if (statusRef.current !== "ready") {
      setNotice(t(localeRef.current, "uploadFailed"));
      return [] as AttachmentItem[];
    }
    if (plan.files.length === 0) {
      // A drop that attached nothing has to say why - silence here is the bug users report
      // as "the hint appeared but nothing happened".
      if (plan.skipped.tooMany > 0) setNotice(t(localeRef.current, "uploadTooMany"));
      else if (plan.skipped.tooLarge > 0) setNotice(t(localeRef.current, "uploadTooLarge"));
      else if (plan.skipped.unreadable > 0) setNotice(t(localeRef.current, "uploadUnreadable"));
      else setNotice(t(localeRef.current, "uploadEmpty"));
      return [] as AttachmentItem[];
    }
    if (plan.skipped.tooMany > 0) setNotice(t(localeRef.current, "uploadTooMany"));
    else if (plan.skipped.tooLarge > 0) setNotice(t(localeRef.current, "uploadTooLarge"));
    const items: AttachmentItem[] = [];
    for (const dropped of plan.files) {
      try {
        const base64 = await fileToBase64(dropped.file);
        if (!base64) {
          setNotice(t(localeRef.current, "uploadTooLarge"));
          continue;
        }
        const requestId = crypto.randomUUID();
        const pending = waitForHostReply(requestId, HOST_FILE_TIMEOUT_MS);
        sendRef.current({
          type: "fs.upload",
          requestId,
          name: dropped.name,
          dir: dropped.dir,
          base64,
        });
        const saved = await pending;
        if (!saved) {
          setNotice(t(localeRef.current, "hostTimeout"));
          continue;
        }
        items.push(...saved);
        setNotice(undefined);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t(localeRef.current, "uploadFailed"));
      }
    }
    return items;
  };

  const onPickElement = () =>
    new Promise<AttachmentItem[]>((resolve) => {
      const requestId = crypto.randomUUID();
      elementPickId.current = requestId;
      setPickingElement(true);
      pickWaiters.current.set(requestId, resolve);
      sendRef.current({
        type: "page.pick",
        requestId,
        hint: `${t(localeRef.current, "pickHint")} · ${t(localeRef.current, "pickHintDetail")}`,
      });
    });

  const onCancelElementPick = () => {
    const requestId = elementPickId.current;
    sendRef.current({ type: "page.pick.cancel", requestId });
    const waiter = pickWaiters.current.get(requestId);
    pickWaiters.current.delete(requestId);
    setPickingElement(false);
    waiter?.([]);
  };

  useEffect(() => {
    if (!pickingElement) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancelElementPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingElement]);

  const onAgentModeId = (modeId: string) => {
    setAgentModeId(modeId);
    appliedAgentModeRef.current = modeId;
    const providerId = selectedProviderRef.current;
    if (providerId) {
      setAgentModeByProvider((current) => ({ ...current, [providerId]: modeId }));
    }
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    sendRef.current({ type: "agent.setMode", modeId, sessionId: session?.acpSessionId });
  };

  /**
   * 用户选了一个会话配置项的值（推理档位、模型开关…）：先就地更新，再把选择交给 Host。
   * 真正的权威是引擎推回来的状态（换模型可能把档位重置），所以这里只当「马上有反应」。
   */
  const onAgentOption = (configId: string, value: string) => {
    if (!configId || !value) return;
    const providerId = selectedProviderRef.current;
    appliedAgentOptionRef.current.add(`${configId}=${value}`);
    setAgentOptions((options) =>
      options.map((option) => (option.id === configId ? { ...option, current: value } : option)),
    );
    if (providerId) {
      setAgentOptionByProvider((current) => ({
        ...current,
        [providerId]: { ...(current[providerId] ?? {}), [configId]: value },
      }));
    }
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    sendRef.current({ type: "agent.setOption", configId, value, sessionId: session?.acpSessionId });
  };

  const onModel = (modelId: string) => {
    setSelectedModelId(modelId);
    appliedModelRef.current = modelId;
    const providerId = selectedProviderRef.current;
    if (providerId) {
      setSelectedModelByProvider((current) => ({ ...current, [providerId]: modelId }));
    }
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (statusRef.current === "ready" && modelId !== "auto") {
      sendRef.current({ type: "model.set", modelId, sessionId: session?.acpSessionId });
    }
  };

  const onCancel = () => {
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!session) return;
    if (session.acpSessionId) {
      sendRef.current({ type: "cancel", sessionId: session.acpSessionId });
    } else {
      // 还没发出去（在等绑定）：撤销待发消息与悬挂的 prompt 项，别等停止后又被发出去。
      pendingRegen.current.delete(session.id);
      bindRegistry.current.dropPrompts(session.id);
    }
    finishTurn(session.id);
  };

  const switchSession = (id: string) => {
    if (id === selectedIdRef.current) return;
    setSelectedId(id);
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;
    if (runningIdsRef.current.has(id)) return;
    const acpId = boundAcpId(session, selectedProviderRef.current);
    if (acpId) {
      requestSession("use", id, acpId);
    } else if (statusRef.current === "ready") {
      if (session.messages.length > 0 && !session.pendingForkContext) {
        patchSession(id, (item) => ({
          ...item,
          pendingForkContext: item.pendingForkContext ?? buildForkContext(item.messages),
        }));
      }
      requestSession("new", id);
    }
  };

  const renameSession = (id: string, title: string) => {
    const next = title.trim();
    const placeholder = isPlaceholderTitle(next);
    patchSession(id, (session) => ({
      ...session,
      title: placeholder ? "" : next,
      titleManual: !placeholder,
      updatedAt: new Date().toISOString(),
    }));
  };

  const deleteSession = (id: string) => {
    const doomed = sessionsRef.current.find((session) => session.id === id);
    if (doomed && runningIdsRef.current.has(id)) {
      if (doomed.acpSessionId) sendRef.current({ type: "cancel", sessionId: doomed.acpSessionId });
      finishTurn(id);
    }
    clearHitl(id);
    // Drop any tab the Agent was holding for this conversation.
    const releasedAcpId = doomed
      ? boundAcpId(doomed, selectedProviderRef.current) ?? doomed.acpSessionId
      : undefined;
    if (releasedAcpId) sendRef.current({ type: "control.release", sessionId: releasedAcpId });
    if (queuesRef.current[id]) setSessionQueue(id, []);
    if (editingQueueRef.current?.sessionId === id) editingQueueRef.current = null;
    bindRegistry.current.dropLocal(id);
    pendingRegen.current.delete(id);
    const remaining = sessionsRef.current.filter((session) => session.id !== id);
    if (remaining.length > 0) {
      setSessions(remaining);
      if (selectedIdRef.current === id) switchSession(remaining[0].id);
      return;
    }
    const created = emptySession();
    setSessions([created]);
    setSelectedId(created.id);
    if (statusRef.current === "ready") {
      requestSession("new", created.id);
    }
  };

  const newSession = () => {
    const created = emptySession();
    setSessions((current) => [created, ...current]);
    setSelectedId(created.id);
    if (statusRef.current === "ready") {
      requestSession("new", created.id);
    }
  };

  const pinSession = (id: string) => {
    patchSession(id, (session) => ({
      ...session,
      pinnedAt: session.pinnedAt ? undefined : new Date().toISOString(),
    }));
  };

  const sessionBusy = (id: string) => runningIdsRef.current.has(id);

  const forkFromMessage = (messageId: string) => {
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source || sessionBusy(source.id)) return;
    const index = source.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const sliced = source.messages.slice(0, index + 1).map((message) => ({
      ...message,
      content: message.content.map((part) => ({ ...part })),
    }));
    const atTip = index === source.messages.length - 1;
    const created = emptySession({
      parentId: source.id,
      forkedFromMessageId: messageId,
      messages: sliced,
      title: titleFromMessages(sliced),
      pendingForkContext: atTip ? undefined : buildForkContext(sliced),
    });
    setSessions((current) => [created, ...current]);
    setSelectedId(created.id);
    setSessionsOpen(true);
    if (statusRef.current !== "ready") return;
    if (atTip && source.acpSessionId) {
      requestSession("fork", created.id, source.acpSessionId);
    } else {
      requestSession("new", created.id);
    }
  };

  const startReplayTurn = (source: Session, userIndex: number, user: ChatMessage) => {
    const kept = [...source.messages.slice(0, userIndex), user];
    const prior = source.messages.slice(0, userIndex);
    pendingRegen.current.set(source.id, {
      text: textOf(user.content),
      attachments: user.attachments ?? [],
      context: prior.length > 0 ? buildForkContext(prior) : undefined,
    });
    patchSession(source.id, (session) => ({
      ...session,
      acpSessionId: undefined,
      pendingForkContext: undefined,
      messages: kept,
      todos: [],
      title: nextSessionTitle(session, kept),
      updatedAt: new Date().toISOString(),
    }));
    clearHitl(source.id);
    if (statusRef.current !== "ready") {
      pendingRegen.current.delete(source.id);
      setError(t(localeRef.current, "offlineSend"));
      setStatus("error");
      return;
    }
    appliedModelRef.current = "";
    beginTurn(source.id);
    setError(undefined);
    requestSession("new", source.id);
  };

  const regenerateFromMessage = (messageId: string) => {
    if (sessionBusy(selectedIdRef.current)) return;
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source) return;
    const assistantIndex = source.messages.findIndex((message) => message.id === messageId);
    if (assistantIndex < 0 || source.messages[assistantIndex]?.role !== "assistant") return;
    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (source.messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;
    startReplayTurn(source, userIndex, source.messages[userIndex]);
  };

  const reviseFromMessage = (messageId: string, text: string, attachments: AttachmentItem[]) => {
    if (sessionBusy(selectedIdRef.current)) return;
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source) return;
    const userIndex = source.messages.findIndex((message) => message.id === messageId);
    if (userIndex < 0 || source.messages[userIndex]?.role !== "user") return;
    const previous = source.messages[userIndex];
    startReplayTurn(source, userIndex, {
      ...previous,
      content: [{ type: "text", text }],
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  // 「检查更新」的可见结果：checking → 有新版本直接开模态窗；没有则短暂亮「暂无新版本」，
  // 等不到 Host 回话（离线 / 桥接没起来）亮「检查失败」。后两者 1.5s 后回原样。
  // 只用稳定的 setter 与 ref，所以消息处理那边拿旧闭包调用也不会读到过期值。
  const flashCheckState = (state: "current" | "failed") => {
    setCheckState(state);
    window.clearTimeout(checkResetRef.current);
    checkResetRef.current = window.setTimeout(() => setCheckState("idle"), CHECK_FEEDBACK_MS);
  };

  const runCheckUpdate = () => {
    if (checkPendingRef.current) return;
    checkPendingRef.current = true;
    setCheckState("checking");
    sendRef.current({ type: "release.check" });
    window.clearTimeout(checkWatchdogRef.current);
    checkWatchdogRef.current = window.setTimeout(() => {
      if (!checkPendingRef.current) return;
      checkPendingRef.current = false;
      flashCheckState("failed");
    }, CHECK_WATCHDOG_MS);
  };

  if (!hydrated || !selected) {
    return <div className="h-full bg-[var(--ink)]" />;
  }

  // 版本信息只算一次：顶栏更新图标、更新模态窗、抽屉设置 tab 都用它。
  // 三行同口径：不带 tag 的 v 前缀（version.ts 的 displayVersion）。
  // Tab control for the selected conversation: the SW keys holders by ACP session id.
  const selectedAcpId = selected ? boundAcpId(selected, selectedProviderId) : undefined;
  const myControlTabs = selectedAcpId
    ? controlSessions.find((item) => item.sessionId === selectedAcpId)?.tabs ?? []
    : [];
  // A borrow request is about a tab, not about a chat: show it whichever conversation
  // is on screen, so an ask from another session cannot sit unseen.
  const visibleBorrowRequest = borrowRequest;

  const versionInfo = {
    extension: displayVersion(EXTENSION_VERSION) ?? EXTENSION_VERSION,
    bridge: bridgeVersion ?? displayVersion(release?.version),
    latest: displayVersion(release?.latest),
  };
  const updateAvailable =
    isNewer(release?.latest, EXTENSION_VERSION) || isNewer(release?.latest, release?.version);

  return (
    <div className="flex h-full min-h-0">
      <div ref={mainColumnRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          locale={locale}
          status={status}
          error={error}
          progress={progress}
          agents={agents}
          selectedProviderId={selectedProviderId}
          showAgentSelect={onboardingCompleted && status !== "missing"}
          compact={compact}
          sessionTitle={selected.title}
          sessionsOpen={sessionsOpen}
          updateAvailable={updateAvailable}
          onShowUpdate={() => setUpdateOpen(true)}
          onSelectAgent={pickAgent}
          onCancelConnect={cancelConnect}
          onToggleSessions={() => setSessionsOpen((open) => !open)}
          onRetry={() => {
            bindRegistry.current.clear();
            pendingRegen.current.clear();
            pendingConnectRef.current = "";
            connectedProviderRef.current = "";
            setStatus("starting");
            setSawAgents(false);
            setAgents([]);
            setError(t(locale, "reconnecting"));
            reconnectRef.current();
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {status === "missing" ? (
              <BridgeSetup locale={locale} />
            ) : !onboardingCompleted ? (
              <AgentSetup
                locale={locale}
                agents={agents}
                selectedId={selectedProviderId}
                connecting={status === "connecting"}
                scanning={!sawAgents && status !== "idle" && status !== "ready" && status !== "connecting"}
                progress={progress}
                error={error}
                onSelect={requestConnect}
                onCancel={cancelConnect}
                onRetry={() => {
                  setSawAgents(false);
                  setAgents([]);
                  sendRef.current({ type: "agents.detect" });
                  reconnectRef.current();
                }}
              />
            ) : (
            <ChatPane
              locale={locale}
              hostReady={status === "ready"}
              sessionId={selected.id}
              messages={selected.messages}
              contextUsage={contextUsage}
              isRunning={runningIds.includes(selected.id)}
              pickingElement={pickingElement}
              models={models}
              modelId={selectedModelId}
              showModelPicker={status === "ready" && models.length > 0}
              onSend={onSend}
              onRevise={reviseFromMessage}
              onCancel={onCancel}
              onFork={forkFromMessage}
              onRegenerate={regenerateFromMessage}
              onPickAttachments={onPickAttachments}
              onPasteImages={onPasteImages}
              onUploadFiles={onUploadFiles}
              onPickElement={onPickElement}
              onCancelElementPick={onCancelElementPick}
              onPreviewImage={onPreviewImage}
              onModel={onModel}
              agentMode={agentMode}
              agentModes={agentModes}
              agentModeId={agentModeId}
              onAgentModeId={onAgentModeId}
              agentOptions={agentOptions}
              onAgentOption={onAgentOption}
              insertQuote={quoteInsert}
              onQuoteInserted={(id) => setQuoteInsert((current) => (current?.id === id ? undefined : current))}
              iconOnly={iconOnly}
              narrowModel={modelNarrow}
              flatActions={actionFlat}
              skills={skills}
              onRefreshSkills={() => sendRef.current({ type: "skills.refresh" })}
              onAgentMode={(mode) => {
                setAgentMode(mode);
                sendRef.current({ type: "agent.setPolicy", policy: mode });
                // 切到自动档：若还有未答的卡片，按「允许」处理（授权 + 通知 Agent 继续）。
                // `auto: true` 告诉 SW 这是策略放行，不写访问记忆（见 resolveBorrow）。
                if ((mode === "auto" || mode === "unattended") && borrowRequest) {
                  const pendingCard = borrowRequest;
                  sendRef.current({ type: "control.grant", requestId: pendingCard.requestId, allow: true, auto: true });
                  setBorrowRequest(undefined);
                  continueAfterBorrow(pendingCard, true);
                }
                if (mode === "ask") return;
                setPermissions((current) => {
                  const kept: Record<string, PermissionRequest> = {};
                  for (const [id, request] of Object.entries(current)) {
                    const allow = mode === "auto" || mode === "unattended" || request.workspaceWrite;
                    if (!allow || !replyPermission(request.id, request.options)) kept[id] = request;
                  }
                  return kept;
                });
                if (mode !== "unattended") return;
                setQuestions((current) => {
                  for (const prompt of Object.values(current)) {
                    replyQuestion(prompt.id, prompt.questions);
                  }
                  return {};
                });
                setPlans((current) => {
                  for (const plan of Object.values(current)) {
                    replyPlan(plan.id);
                  }
                  return {};
                });
              }}
              page={page}
              todos={selected.todos}
              artifacts={selected.artifacts ?? []}
              onRevealArtifact={(path) => sendRef.current({ type: "fs.reveal", path })}
              notice={notice}
              onDismissNotice={() => setNotice(undefined)}
              queue={queues[selected.id] ?? []}
              control={
                <ControlBanner
                  locale={locale}
                  tabs={myControlTabs}
                  request={visibleBorrowRequest}
                  onRelease={() => {
                    if (selectedAcpId) sendRef.current({ type: "control.release", sessionId: selectedAcpId });
                  }}
                  onGrant={(requestId, allow) => {
                    const request = visibleBorrowRequest;
                    sendRef.current({ type: "control.grant", requestId, allow });
                    setBorrowRequest(undefined);
                    if (request) continueAfterBorrow(request, allow);
                  }}
                />
              }
              onEnqueue={onEnqueue}
              onUpdateQueued={onUpdateQueued}
              onDeleteQueued={onDeleteQueued}
              onSendQueuedNow={onSendQueuedNow}
              onEditingQueued={onEditingQueued}
              hitl={
                <PermissionBar
                  locale={locale}
                  permission={permissions[selected.id]}
                  question={questions[selected.id]}
                  plan={plans[selected.id]}
                  onPermission={(optionId) => {
                    const current = permissions[selected.id];
                    if (!current) return;
                    sendRef.current({
                      type: "permission.reply",
                      id: current.id,
                      outcome: { outcome: "selected", optionId },
                    });
                    setPermissions((items) => {
                      const next = { ...items };
                      delete next[selected.id];
                      return next;
                    });
                  }}
                  onQuestion={(answers) => {
                    const current = questions[selected.id];
                    if (!current) return;
                    sendRef.current({
                      type: "cursor.reply",
                      id: current.id,
                      result: { outcome: { outcome: "answered", answers } },
                    });
                    setQuestions((items) => {
                      const next = { ...items };
                      delete next[selected.id];
                      return next;
                    });
                  }}
                  page={page}
                  onPlan={(accepted) => {
                    const current = plans[selected.id];
                    if (!current) return;
                    sendRef.current({
                      type: "cursor.reply",
                      id: current.id,
                      result: accepted
                        ? { outcome: { outcome: "accepted" } }
                        : { outcome: { outcome: "rejected", reason: "User rejected the plan" } },
                    });
                    setPlans((items) => {
                      const next = { ...items };
                      delete next[selected.id];
                      return next;
                    });
                  }}
                />
              }
            />
            )}
          </div>
        </div>
      </div>
      {sessionsOpen ? (
        <SessionDrawer
          locale={locale}
          theme={theme}
          width={drawerWidth}
          sessions={sessions}
          selectedId={selected.id}
          runningIds={runningIds}
          onWidth={(next) => setDrawerWidth(clampSessionDrawerWidth(next))}
          onSelect={switchSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onPin={pinSession}
          onNewSession={newSession}
          onClose={() => setSessionsOpen(false)}
          onLocale={(next) => {
            applyLocale(next);
            setLocale(next);
          }}
          versions={versionInfo}
          checkState={checkState}
          onCheckUpdate={runCheckUpdate}
          onShowUninstall={() => setUninstallOpen(true)}          onTheme={(next) => {
            applyThemePreference(next);
            setTheme(next);
          }}
        />
      ) : null}
      {pickingElement ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--overlay)] px-5 backdrop-blur-md">
          <div className="flex max-w-[17rem] flex-col items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/92 px-5 py-4 text-center shadow-2xl">
            <MousePointer2 size={26} className="text-[var(--brass)]" />
            <p className="text-[13px] leading-relaxed text-[var(--text)]">{t(locale, "pickHint")}</p>
            <p className="text-[11px] text-[var(--muted)]">{t(locale, "pickHintDetail")}</p>
          </div>
        </div>
      ) : null}
      {updateOpen ? (
        <UpdateDialog locale={locale} versions={versionInfo} onClose={() => setUpdateOpen(false)} />
      ) : null}
      {uninstallOpen ? (
        <UninstallDialog locale={locale} onClose={() => setUninstallOpen(false)} />
      ) : null}
      {/* 切换 Agent 前的高危确认：跑着的任务会被打断，先问一句（文案见 i18n）。 */}
      {agentSwitch ? (
        <ConfirmDialog
          locale={locale}
          title={t(locale, "switchAgentTitle")}
          message={t(
            locale,
            agentSwitch.running > 1 ? "switchAgentRunningMany" : "switchAgentRunningOne",
          ).replace("{n}", String(agentSwitch.running))}
          cancelLabel={t(locale, "switchAgentCancel")}
          confirmLabel={t(locale, "switchAgentConfirm")}
          onCancel={() => setAgentSwitch(undefined)}
          onConfirm={confirmAgentSwitch}
        />
      ) : null}
    </div>
  );
}

function todoPlanKey(item: TodoItem): string {
  return `${item.id}\0${item.content}`;
}

function applyTodos(current: TodoItem[], incoming: TodoItem[], merge: boolean): TodoItem[] {
  if (!merge || current.length === 0) return incoming;
  const currentKeys = new Set(current.map(todoPlanKey));
  if (incoming.some((item) => !currentKeys.has(todoPlanKey(item)))) return incoming;
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

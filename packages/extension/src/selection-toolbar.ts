import type { SelectionMode } from "@shared";
import { selectionCopy } from "./selection-copy";
import type { Locale } from "./sidepanel/i18n";

/**
 * 划词工具条：在网页上选中一段文字时，选区旁边浮出一条工具条（品牌标记 + 翻译 / 搜索 /
 * 引用）。它只在「侧栏开着 + Agent 已就绪」时存在（门控在 service worker 里算，这里只缓存），
 * 任何一条不成立就整条拆掉，页面上不留痕迹。
 *
 * 几条硬规矩：
 *  - **隔离世界 + shadow DOM**：页面看不见我们，也夺不走我们的样式；页面自己的 CSS 也进不来。
 *  - **只处理顶层文档**的选区（`all_frames` 没开，跨域 iframe 里的划词看不到）。
 *  - **超长选区直接不支持**：超过 MAX_CHARS 个字符（按码点算）就什么都不显示，不提示、不降级。
 *  - **选区移出视口就连工具条一起消失**；工具条四边永远留 SAFE_MARGIN，绝不越出视口。
 *  - 结果层是**侧栏那套渲染**（iframe 装的扩展页），不是自研 markdown 渲染器。
 */

const HOST_ID = "opensider-selection";
const MAX_CHARS = 200; // 与 internal/selection 的 MaxRunes 对齐
const SAFE_MARGIN = 8;
const GAP = 8;
const SHOW_DELAY_MS = 120;
// 结果层的高度按**文字行数**算，不按视口比例：正文至少 10 行、最多 20 行（行高对齐
// .cs-selection-body 的 12.5px × 1.55），再加上标题行与上下 padding。内容不足 10 行由内容
// 撑高（只有加载中用 10 行占位，免得先是一条小窄条、结果一到又跳成一大块），超过 20 行交给
// 结果层自己滚动——要的是「能多看几行」，不是「铺满视口」。
const RESULT_LINE_PX = 12.5 * 1.55;
const RESULT_CHROME_PX = 46;
const RESULT_MIN_LINES = 10;
const RESULT_MAX_LINES = 20;
const RESULT_LOADING_HEIGHT = Math.round(RESULT_MIN_LINES * RESULT_LINE_PX + RESULT_CHROME_PX);
const RESULT_MAX_HEIGHT = Math.round(RESULT_MAX_LINES * RESULT_LINE_PX + RESULT_CHROME_PX);

type Gate = { enabled: boolean };

type ResultState = "loading" | "ready" | "error";

let gate: Gate = { enabled: false };
let booted = false;
let locale: Locale = "en";

let host: HTMLDivElement | undefined;
let bar: HTMLDivElement | undefined;
let rootEl: HTMLDivElement | undefined;
let frameWrap: HTMLDivElement | undefined;
let frame: HTMLIFrameElement | undefined;
let brand: HTMLImageElement | undefined;
let buttons: Partial<Record<SelectionMode | "quote", HTMLButtonElement>> = {};

let selectedText = "";
let anchor: DOMRect | undefined;
let showTimer = 0;
let observer: MutationObserver | undefined;
let activeRequest = "";
let activeMode: SelectionMode | "quote" | "" = "";
let resultHeight = RESULT_LOADING_HEIGHT;
let copiedTimer = 0;

// ------------------------------------------------------------------ 选区的读取与判断

function isEditable(node: Node | null): boolean {
  let element = node instanceof Element ? node : node?.parentElement ?? null;
  while (element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if ((element as HTMLElement).isContentEditable) return true;
    element = element.parentElement;
  }
  return false;
}

/** 选区的并集矩形：多行选区不能只贴最后一行。 */
function selectionRect(range: Range): DOMRect | undefined {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return undefined;
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  return new DOMRect(left, top, right - left, bottom - top);
}

function intersectsViewport(rect: DOMRect): boolean {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  return rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth;
}

/** 读当前选区；不合适就返回空（调用方据此隐藏）。 */
function readSelection(): { text: string; rect: DOMRect } | undefined {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const text = selection.toString().replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  // 按码点算：中文按字数、emoji 不按两个 UTF-16 单元算，和 Host 那边的口径一致。
  if ([...text].length > MAX_CHARS) return undefined;
  const range = selection.getRangeAt(0);
  if (host && host.contains(range.commonAncestorContainer)) return undefined;
  if (isEditable(range.commonAncestorContainer)) return undefined;
  const rect = selectionRect(range);
  if (!rect || rect.width === 0 || rect.height === 0) return undefined;
  return { text, rect };
}

// ------------------------------------------------------------------ 定位

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function place(): void {
  if (!host || !bar || !anchor) return;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  // 用 host 的实测尺寸（它才是「必须留在视口里」的那个盒子），不是 bar 的：结果层可能比 bar
  // 宽，两者差几像素就会让工具条压线出界。
  const hostRect = host.getBoundingClientRect();
  const barWidth = hostRect.width || bar.offsetWidth;
  const barHeight = bar.offsetHeight;
  const panelHeight = frameWrap && frameWrap.style.display !== "none" ? resultHeight + GAP : 0;
  const totalHeight = barHeight + panelHeight;

  const roomBelow = viewportHeight - SAFE_MARGIN - (anchor.bottom + GAP);
  const roomAbove = anchor.top - GAP - SAFE_MARGIN;
  // 选区自己滚出视口之后就**不再往视口里夹**：用户要求工具条跟着一起滚出去（只要选区还在，
  // 滚回来就还得在），夹紧会把它硬拽回视口里、看着像没跟随。
  const anchorVisible = intersectsViewport(anchor);
  // 方向：优先选「整条都放得下」的那一边；两边都放不下就选空间更大的那边，**允许它超出视口**
  // ——结果层自己会滚、页面也能滚，不必为了塞进视口把工具条挤到看不见的地方。
  const below = roomBelow >= totalHeight ? true : roomAbove >= totalHeight ? false : roomBelow >= roomAbove;
  let top = below ? anchor.bottom + GAP : anchor.top - GAP - totalHeight;
  if (panelHeight === 0 && anchorVisible) {
    // 只有工具条时是「首次布局」：只要选区还在视口里，无论空间多紧都要让它完整可见。
    top = clamp(top, SAFE_MARGIN, Math.max(SAFE_MARGIN, viewportHeight - SAFE_MARGIN - totalHeight));
  }
  const centered = anchor.left + anchor.width / 2 - barWidth / 2;
  const left = anchorVisible
    ? clamp(centered, SAFE_MARGIN, Math.max(SAFE_MARGIN, viewportWidth - SAFE_MARGIN - barWidth))
    : Math.round(centered);
  // 在上方时把结果层摆到工具条**上面**（column-reverse）：工具条始终紧贴选区那一侧，
  // 结果层再高也不会把它顶出视口。
  if (rootEl) rootEl.style.flexDirection = below ? "column" : "column-reverse";
  if (host) {
    host.style.top = `${Math.round(top)}px`;
    host.style.left = `${Math.round(left)}px`;
  }
}

// ------------------------------------------------------------------ 组装 DOM

function styleText(): string {
  return `
    /*
     * 调色板挂在 **:host** 上，不挂在 .root 上。自定义属性会照常往 shadow 树里继承，
     * 所以放在最外层，整棵树里的节点都拿得到——包括以后可能被漏在 .root 外面的节点。
     * 这一条是有过事故的：按钮挂在 shadow root 上（不在 .root 里）时，color: var(--muted)
     * 解析失败，颜色回落到 initial，深色系统里那就是 canvastext 的白 → 白字白底看不见。
     * （自定义属性不受 all 简写影响，所以下面那条 all: initial 不会把它们清掉。）
     */
    :host {
      all: initial;
      --panel: #ffffff; --panel-2: #f6f6f4; --line: rgba(0,0,0,.14);
      --text: #1d1d1b; --muted: #6b6b66; --hover: rgba(0,0,0,.06); --brass: #b07d2b;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --panel: #1b1d18; --panel-2: #23261f; --line: rgba(255,255,255,.16);
        --text: #ece7d8; --muted: #a3a396; --hover: rgba(255,255,255,.08); --brass: #d4a054;
      }
    }
    .root {
      display: flex; flex-direction: column; align-items: flex-start; gap: ${GAP}px;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Microsoft YaHei", sans-serif; color: var(--text);
    }
    .bar {
      display: flex; align-items: center; gap: 2px; padding: 4px;
      background: var(--panel); border: 1px solid var(--line); border-radius: 999px;
      box-shadow: 0 8px 24px rgba(0,0,0,.28);
    }
    .brand { width: 16px; height: 16px; margin: 0 4px; opacity: .9; }
    .action {
      display: flex; align-items: center; gap: 6px; padding: 5px 10px;
      border: 0; background: transparent; color: var(--muted); cursor: pointer;
      border-radius: 999px; font: inherit; white-space: nowrap;
    }
    .action:hover { background: var(--hover); color: var(--text); }
    .action[data-active="1"] { background: var(--hover); color: var(--text); }
    .action svg { display: block; }
    .result {
      display: none; background: var(--panel); border: 1px solid var(--line);
      border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.3); overflow: hidden;
    }
    .result[data-open="1"] { display: block; }
    .result iframe { display: block; border: 0; width: 100%; background: transparent; }
  `;
}

function actionButton(
  parent: HTMLElement,
  key: SelectionMode | "quote",
  label: string,
  aria: string,
  icon: string,
  onClick: () => void,
): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action";
  button.title = aria;
  button.setAttribute("aria-label", aria);
  button.innerHTML = `${icon}<span></span>`;
  const span = button.querySelector("span");
  if (span) span.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  // 按下工具条不能把页面选区清掉：阻止默认的聚焦行为即可。
  button.addEventListener("mousedown", (event) => event.preventDefault());
  // 挂进 bar（那才是「一条」工具条），别挂到 shadow root 上：挂错地方按钮就跑到条外面
  // 去了，既没有条的内边距和圆角，也拿不到 .root 上的调色板。
  parent.append(button);
  buttons[key] = button;
}

const ICON_TRANSLATE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
const ICON_SEARCH =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const ICON_QUOTE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2h1a6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2h1a6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></svg>';

function mount(): void {
  if (host) return;
  host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-opensider-ignore", "true");
  // 定位与层级挂在 host 上（shadow 里的 .root 只负责排版）：place() 改的就是这两个坐标。
  // `all:initial` 会把 display 也复位成 inline（块级子元素在 inline 盒子里会量出 0 宽、坐标
  // 落在 0），所以紧接着显式给 block + max-content：host 收缩包裹内容，place() 才量得准。
  // 层级：先争取**顶层（top layer）**——`popover="manual"` + showPopover() 能压过页面上任何
  // z-index（Google 翻译那类气泡就是靠 z-index 抢位的，它们常用到 2147483647）。拿不到顶层
  // （旧内核 / 全屏）时退回最大 z-index。
  host.style.cssText =
    "all:initial; display:block; position:fixed; width:max-content; z-index:2147483647; pointer-events:auto;";
  host.setAttribute("popover", "manual");
  // **open** 而不是 closed：工具条要能被无障碍工具与自动化测试按名字点到（页面本来就能看见
  // 这个 host 元素，样式隔离靠 shadow 边界照样成立；「不给页面留痕」那条硬约束针对的是主世界
  // 注入，内容脚本的 DOM 不在其列）。
  const shadow = host.attachShadow({ mode: "open" });
  const root = document.createElement("div");
  root.className = "root";
  rootEl = root;

  bar = document.createElement("div");
  bar.className = "bar";
  brand = document.createElement("img");
  brand.className = "brand";
  brand.alt = "";
  brand.setAttribute("aria-hidden", "true");
  brand.src = chrome.runtime.getURL("icons/icon32.png");
  bar.append(brand);

  const words = selectionCopy(locale);
  actionButton(bar, "translate", words.translate, words.translateAria, ICON_TRANSLATE, () =>
    void startRequest("translate"),
  );
  actionButton(bar, "search", words.search, words.searchAria, ICON_SEARCH, () => void startRequest("search"));
  actionButton(bar, "quote", words.quote, words.quoteAria, ICON_QUOTE, () => quoteSelection());

  frameWrap = document.createElement("div");
  frameWrap.className = "result";
  frame = document.createElement("iframe");
  frame.setAttribute("allow", "clipboard-write");
  frame.src = chrome.runtime.getURL("src/selection/index.html");
  frameWrap.append(frame);

  root.append(bar, frameWrap);
  shadow.append(root);
  applyShadowStyles(shadow);
  // 工具条自身不该成为「点空白处」的判定目标。
  host.addEventListener("pointerdown", (event) => event.stopPropagation());
  (document.fullscreenElement ?? document.documentElement).append(host);
  raiseToTopLayer();
  watchMount();
}

/**
 * 把工具条的样式挂进 shadow。
 *
 * 用**构造式样式表**（`adoptedStyleSheets`）而不是 `<style>` 元素：页面的 CSP 会拦掉注入到
 * 它文档里的 `<style>`（YouTube 这类站点的 `style-src` 只放行自己的 nonce），而 CSSOM 构造出来
 * 的样式表不受 CSP 管——这正是「在有些站点上工具条变成一堆没样式的按钮」的根因。旧内核没有
 * `adoptedStyleSheets` 时退回 `<style>`。
 */
function applyShadowStyles(shadow: ShadowRoot): void {
  const css = styleText();
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      return;
    } catch {
      // 落到下面的 <style> 兜底
    }
  }
  const style = document.createElement("style");
  style.textContent = css;
  shadow.prepend(style);
}

function watchMount(): void {
  observer?.disconnect();
  const parent = host?.parentElement ?? document.documentElement;
  observer = new MutationObserver(() => {
    if (host && !host.isConnected) {
      mountParent();
    }
  });
  observer.observe(parent, { childList: true });
}

function mountParent(): void {
  if (!host) return;
  (document.fullscreenElement ?? document.documentElement).append(host);
  raiseToTopLayer();
}

/**
 * 把工具条抬到顶层。`showPopover()` 失败就退回 z-index（已经在 host 上写好了）。
 *
 * 顶层元素之间也有先后：后 showPopover 的在上。所以每次重新定位 / 重新打开结果层时会再抬一次
 * （先隐藏再显示），保证用户当前要看的那个结果还在 Google 翻译那类气泡之上。
 */
function raiseToTopLayer(): void {
  if (!host || typeof host.showPopover !== "function") {
    host?.removeAttribute("popover");
    return;
  }
  try {
    if (host.matches(":popover-open")) return;
    host.showPopover();
  } catch {
    // 已经在顶层、或这个元素不适合当 popover：退回 z-index 就行，不影响功能。
  }
}

/** 重新压到顶层最上面（结果层刚展开、或工具条重新定位时用）。 */
function restackTopLayer(): void {
  if (!host || typeof host.showPopover !== "function") return;
  try {
    if (host.matches(":popover-open")) host.hidePopover();
    host.showPopover();
  } catch {
    // 忽略：拿不到顶层也不影响可用性。
  }
}

// ------------------------------------------------------------------ 显示 / 隐藏

function show(): void {
  mount();
  if (!host) return;
  host.style.display = "block";
  place();
}

function hide(): void {
  window.clearTimeout(showTimer);
  showTimer = 0;
  if (activeRequest) {
    chrome.runtime.sendMessage({ type: "selection.cancel", requestId: activeRequest }).catch(() => undefined);
    activeRequest = "";
  }
  activeMode = "";
  for (const button of Object.values(buttons)) button?.removeAttribute("data-active");
  observer?.disconnect();
  observer = undefined;
  host?.remove();
  host = undefined;
  bar = undefined;
  rootEl = undefined;
  frameWrap = undefined;
  frame = undefined;
  brand = undefined;
  buttons = {};
  anchor = undefined;
  selectedText = "";
  resultHeight = RESULT_LOADING_HEIGHT;
}

function schedule(): void {
  window.clearTimeout(showTimer);
  showTimer = window.setTimeout(() => {
    showTimer = 0;
    const found = readSelection();
    // 选区被清空就收掉；选区还在但已经滚出视口时什么都不做——那种情况下不新开工具条，
    // 但已经在跟随滚动的那一条也不会被收掉（见 reposition）。
    if (!found) {
      hide();
      return;
    }
    if (!gate.enabled) {
      // 缓存说「不可用」，但推送可能根本没到（页面早于侧栏打开、service worker 刚被唤醒）。
      // 就地复核一次，免得工具条在最该出现的时候消失——复核结果仍由 SW 说了算。
      void chrome.runtime
        .sendMessage({ type: "selection.gate.get" })
        .then((reply: { enabled?: boolean } | undefined) => {
          if (reply?.enabled !== true) return;
          setSelectionGate(true);
          schedule();
        })
        .catch(() => undefined);
      return;
    }
    selectedText = found.text;
    anchor = found.rect;
    show();
  }, SHOW_DELAY_MS);
}

function reposition(): void {
  if (!host || !bar) return;
  const found = readSelection();
  // 选区内容变了（或被清空）就别留着一个对不上的工具条。**选区移出视口不再收掉**：
  // 工具条要跟着页面滚出去，用户滚回来时（选区还在）它照旧在那儿。
  if (!found || found.text !== selectedText) {
    hide();
    return;
  }
  anchor = found.rect;
  place();
}

// ------------------------------------------------------------------ 三个动作

function startRequest(mode: SelectionMode): void {
  if (!selectedText) return;
  activeMode = mode;
  for (const [key, button] of Object.entries(buttons)) {
    if (key === mode) button?.setAttribute("data-active", "1");
    else button?.removeAttribute("data-active");
  }
  activeRequest = `sel-${Math.random().toString(36).slice(2, 10)}`;
  pushResult({ kind: mode, state: "loading", text: "" });
  chrome.runtime
    .sendMessage({
      type: "selection.run",
      requestId: activeRequest,
      mode,
      text: selectedText,
      targetLang: navigator.language,
      title: document.title,
      url: location.href,
    })
    .catch(() => pushResult({ kind: mode, state: "error", text: "" }));
}

function quoteSelection(): void {
  if (!selectedText) return;
  void chrome.runtime.sendMessage({
    type: "selection.quote",
    text: selectedText,
    title: document.title,
    url: location.href,
  });
  hide();
}

/** 与结果层页面的通信契约（它只认这两个方向的 source 字段）。 */
function postToFrame(payload: Record<string, unknown>): void {
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ source: "opensider-selection", ...payload }, "*");
}

/** 把状态推给结果层页面（它是侧栏那套 React 渲染，文案与 markdown 都在那边）。 */
function pushResult(payload: { kind: SelectionMode; state: ResultState; text: string }): void {
  if (!frameWrap || !frame) return;
  frameWrap.setAttribute("data-open", "1");
  restackTopLayer();
  // 加载态先按 10 行占位：先给一条小窄条、结果一到再跳成一大块很难看。
  if (payload.state === "loading") resultHeight = RESULT_LOADING_HEIGHT;
  const frameWidth = Math.min(380, Math.max(240, window.innerWidth - 2 * SAFE_MARGIN));
  frame.style.width = `${frameWidth}px`;
  frame.style.height = `${resultHeight}px`;
  const send = () =>
    postToFrame({
      kind: payload.kind,
      state: payload.state,
      text: payload.text,
      locale,
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    });
  send();
  // iframe 可能还在加载：等它 load 再发一次（页面渲染时以最后一条状态为准）。
  frame.addEventListener("load", send, { once: true });
  place();
}

/**
 * 结果层的最大高度：正文 20 行 + 标题与 padding。再长由结果层自己滚（它是独立文档），
 * 不再按视口比例算——用户要的是「能多看几行」，放不下宁肯溢出视口、滚页面看。
 */
function maxResultHeight(): number {
  return RESULT_MAX_HEIGHT;
}

/** 结果层页面回信：高度同步、复制请求。 */
function onResultMessage(event: MessageEvent): void {
  if (!frame || event.source !== frame.contentWindow) return;
  const data = event.data as { source?: string; height?: number; action?: string; text?: string } | undefined;
  if (!data || data.source !== "opensider-selection-result") return;
  if (typeof data.height === "number" && Number.isFinite(data.height)) {
    // 内容撑高，封顶 20 行（超出内部滚动）。
    resultHeight = Math.min(Math.round(data.height), maxResultHeight());
    if (frame) frame.style.height = `${resultHeight}px`;
    place();
    return;
  }
  if (data.action === "copy") {
    void copyText(String(data.text ?? "")).then((ok) => {
      postToFrame({ copied: ok });
      if (!ok) return;
      copiedTimer = Date.now();
      window.setTimeout(() => {
        copiedTimer = 0;
        postToFrame({ copied: false });
      }, 1600);
    });
  }
}

/** 复制：优先 clipboard API，失败退回隐藏 textarea（与侧栏那套一致）。 */
async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.cssText = "position:fixed;left:-9999px;top:0;";
      document.body.append(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ------------------------------------------------------------------ 事件绑定

function onScrollOrResize(): void {
  reposition();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (host) hide();
}

function onDocumentClick(event: MouseEvent): void {
  if (!host) return;
  if (event.target instanceof Node && host.contains(event.target)) return;
  // 点空白处：等浏览器把选区清掉之后再看一眼，还在选中就不动。
  window.setTimeout(() => {
    if (!host) return;
    const found = readSelection();
    if (!found || found.text !== selectedText) hide();
  }, 0);
}

export function setSelectionGate(enabled: boolean): void {
  const wasEnabled = gate.enabled;
  gate = { enabled };
  if (!enabled) {
    hide();
    return;
  }
  // 刚变可用：用户可能正选着一段文字（甚至从侧栏还没连上时就选着了）。补一次判定，
  // 别让他白等下一次划词——service worker 被回收再唤醒、面板刚连上都会走到这里。
  if (!wasEnabled) schedule();
}

export function isSelectionToolbarMounted(): boolean {
  return Boolean(host);
}

/** 内容脚本启动时调一次：绑事件 + 问一次门控。 */
export function startSelectionToolbar(initialLocale: Locale): void {
  locale = initialLocale;
  if (booted) return;
  booted = true;
  document.addEventListener("selectionchange", schedule);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
  document.addEventListener("fullscreenchange", onScrollOrResize);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onDocumentClick, true);
  window.addEventListener("message", onResultMessage);
  chrome.storage.onChanged.addListener((changes) => {
    const next = changes["opensider/state"]?.newValue as { locale?: string } | undefined;
    if (next?.locale === "zh" || next?.locale === "en") locale = next.locale;
  });
}

/** 结果（增量 / 完成 / 失败）到达：只认当前这一条请求，其余一律丢掉。 */
export function acceptSelectionResult(message: {
  type: string;
  requestId?: string;
  text?: string;
  error?: string;
}): void {
  if (!activeRequest || message.requestId !== activeRequest) return;
  const kind: SelectionMode = activeMode === "search" ? "search" : "translate";
  if (message.type === "selection.delta") {
    pushResult({ kind, state: "ready", text: String(message.text ?? "") });
    return;
  }
  if (message.type === "selection.done") {
    activeRequest = "";
    pushResult({ kind, state: "ready", text: String(message.text ?? "") });
    return;
  }
  if (message.type === "selection.failed") {
    activeRequest = "";
    pushResult({ kind, state: "error", text: String(message.error ?? "") });
  }
}

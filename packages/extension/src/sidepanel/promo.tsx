/**
 * The README promo video, rendered as a pure function of time so every frame can be
 * captured deterministically (`scripts/promo.mjs`). Not part of the extension build.
 *
 *   cd packages/extension && npx vite --config vite.shots.config.ts
 *   # then open /promo.html?lang=en|zh&t=30   (t = seconds, for previewing one frame)
 */
import "./shots-shim";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coffee,
  Copy,
  Github,
  Headphones,
  Languages,
  Lock,
  MousePointer2,
  Quote,
  RotateCw,
  Search,
  ShieldCheck,
  Star,
  Terminal,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { AgentModeOption, AgentModel, AttachmentItem, CurrentPage, SkillItem } from "@shared";
import logoUrl from "../../assets/icon.svg?url";
import { ChatPane } from "./components/ChatPane";
import { ControlBanner } from "./components/ControlBanner";
import type { ChatMessage, ChatPart } from "./chat-types";
import { applyLocale, t as tr, type Locale } from "./i18n";
import { applyThemePreference } from "./theme";
import "./styles.css";

const params = new URLSearchParams(location.search);
const locale: Locale = params.get("lang") === "zh" ? "zh" : "en";
applyLocale(locale);
applyThemePreference("dark");

export const DURATION = 116;

// ---------------------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------------------

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const prog = (time: number, a: number, b: number) => clamp((time - a) / (b - a));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const typed = (text: string, time: number, start: number, cps = 26) =>
  text.slice(0, Math.max(0, Math.floor((time - start) * cps)));

type Key = { at: number; x: number; y: number };
function along(time: number, keys: Key[]): { x: number; y: number } {
  if (time <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1];
    const b = keys[i];
    if (time <= b.at) {
      const x = easeInOut(prog(time, a.at, b.at));
      return { x: lerp(a.x, b.x, x), y: lerp(a.y, b.y, x) };
    }
  }
  return keys[keys.length - 1];
}

// ---------------------------------------------------------------------------------------
// Copy (both languages)
// ---------------------------------------------------------------------------------------

const COPY = {
  en: {
    slogan: "Give your browser AI wings",
    agentsTitle: "Your local Agent CLI, right in the side panel",
    agentsMore: "and any other ACP agent",
    private: "Nothing is uploaded.",
    contextTitle: "The page is the context",
    contextSub: "Ask about the tab you're on — no copy, no paste.",
    contextAsk: "Rank the stories on this page by impact and save a digest as HTML.",
    contextAnswer:
      "Done — saved **ai-digest.html** and opened it in a new tab.\n\n1. Agents move into the browser\n2. Small models close the gap on reasoning\n3. Open weights, closed benchmarks",
    autoTitle: "Automation you can watch",
    autoSub: "It clicks, types and fills forms — with your logins intact.",
    autoAsk: "Order me a large oat latte for pickup at 9:30.",
    autoAnswer: "Your order **#2048** is confirmed — a large oat latte, ready at 9:30.",
    selTitle: "Select to translate, search or quote",
    selSub: "A toolbar follows your selection on any page.",
    selPara1: "Les agents locaux apprennent à piloter les onglets, les formulaires et les clics, ",
    selPick: "directement là où vous lisez",
    selPara2: ", et vous pouvez reprendre la main à tout moment.",
    selResult: "Right where you are reading",
    pickTitle: "Point at it, ask about it",
    pickSub: "Pick any element on the page.",
    pickAsk: "Is this one worth it compared with the other two?",
    pickAnswer:
      "**Aurora ANC** is the best value here: the strongest noise cancelling and 40h of battery for $40 less than Nimbus Pro. Pick Pulse Lite only if weight matters most.",
    installTitle: "Install with one prompt",
    installSub: "Paste it into the Agent you already use.",
    installPrompt:
      "Install the OpenSider browser extension for me.\nRead https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow its install flow.",
    steps: ["Detect the browser and Agent CLIs", "Install the bridge", "Load the extension", "Verify the connection"],
    agentLabel: "Your Agent CLI",
    newsTitle: "Today in AI",
    digestTitle: "AI Digest — ranked by impact",
    shopName: "Brew & Co.",
    shopHead: "Order ahead",
    drink: "Drink",
    milk: "Milk",
    size: "Size",
    pickup: "Pickup time",
    drinkVal: "Latte",
    milkVal: "Oat milk",
    place: "Place order",
    confirmed: "Order #2048 confirmed",
    shopHeadphones: "Headphones",
    battery: "battery",
  },
  zh: {
    slogan: "为你的浏览器插上AI的翅膀",
    agentsTitle: "把本机的 Agent CLI 装进浏览器侧边栏",
    agentsMore: "以及其他支持 ACP 的 Agent",
    private: "所有数据都不上传。",
    contextTitle: "当前页就是上下文",
    contextSub: "直接问你正在看的页面，不用复制粘贴。",
    contextAsk: "把这一页的新闻按影响力排个榜，存成一个 HTML 文件。",
    contextAnswer:
      "已完成，榜单存为 **ai-digest.html**，并在新标签页打开。\n\n1. Agent 走进浏览器\n2. 小模型在推理上追平大模型\n3. 开源权重，闭源榜单",
    autoTitle: "自动化，看得见",
    autoSub: "点击、输入、填表实时发生，登录态原封不动。",
    autoAsk: "帮我点一杯大杯燕麦拿铁，9:30 到店自取。",
    autoAnswer: "订单 **#2048** 已确认：大杯燕麦拿铁，9:30 可取。",
    selTitle: "划词翻译、搜索、引用",
    selSub: "在任意网页选中文字，工具条随手可用。",
    selPara1: "Local agents are learning to drive tabs, forms and clicks, ",
    selPick: "right where you are reading",
    selPara2: ", and you can take over at any time.",
    selResult: "就在你阅读的地方",
    pickTitle: "指哪问哪",
    pickSub: "拾取页面上的任意元素。",
    pickAsk: "这款和另外两款比，值得买吗？",
    pickAnswer:
      "**Aurora ANC** 性价比最高：降噪最强、续航 40 小时，比 Nimbus Pro 便宜 $40。只有特别在意重量时才选 Pulse Lite。",
    installTitle: "一句提示词完成安装",
    installSub: "发给你正在用的 Agent 即可。",
    installPrompt:
      "帮我安装 OpenSider 浏览器扩展。\n请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其安装流程执行。",
    steps: ["检测浏览器与 Agent CLI", "安装桥接程序", "加载浏览器扩展", "验证连接"],
    agentLabel: "你的 Agent CLI",
    newsTitle: "今日 AI 快讯",
    digestTitle: "AI 榜单：按影响力排序",
    shopName: "Brew & Co.",
    shopHead: "在线点单",
    drink: "饮品",
    milk: "奶",
    size: "杯型",
    pickup: "取餐时间",
    drinkVal: "拿铁",
    milkVal: "燕麦奶",
    place: "提交订单",
    confirmed: "订单 #2048 已确认",
    shopHeadphones: "耳机",
    battery: "续航",
  },
}[locale];

const NEWS = {
  en: [
    ["Small models close the gap on reasoning", "A new wave of 7B models trades breadth for depth."],
    ["Agents move into the browser", "Local CLIs are learning to drive tabs, forms and clicks."],
    ["Open weights, closed benchmarks", "Leaderboards are getting harder to trust."],
    ["Chips get cheaper, context gets longer", "Million-token windows reach laptops."],
  ],
  zh: [
    ["小模型在推理上追平大模型", "一批 7B 模型用广度换深度。"],
    ["Agent 走进浏览器", "本地 CLI 开始操作标签页、表单和点击。"],
    ["开源权重，闭源榜单", "排行榜越来越难被信任。"],
    ["芯片更便宜，上下文更长", "百万 token 窗口跑上了笔记本。"],
  ],
}[locale];

const PRODUCTS = [
  { name: "Pulse Lite", price: "$89", stars: 4, battery: "28h", hue: 200 },
  { name: "Aurora ANC", price: "$149", stars: 5, battery: "40h", hue: 32 },
  { name: "Nimbus Pro", price: "$189", stars: 4, battery: "30h", hue: 280 },
];

// ---------------------------------------------------------------------------------------
// Side panel (real ChatPane)
// ---------------------------------------------------------------------------------------

const MODELS: AgentModel[] = [
  { id: "auto", name: "Auto" },
  { id: "claude-opus", name: "Claude Opus" },
];
const AGENT_MODES: AgentModeOption[] = [
  { id: "agent", name: "Agent", kind: "agent" },
  { id: "plan", name: "Plan", kind: "plan" },
];
const SKILLS: SkillItem[] = [];
const noop = () => undefined;
const noopAsync = async () => [];

const D = new Date(0);
const user = (id: string, text: string, attachments?: AttachmentItem[]): ChatMessage => ({
  id,
  role: "user",
  createdAt: D,
  content: [{ type: "text", text }],
  attachments,
});
const assistant = (id: string, content: ChatPart[], durationMs?: number): ChatMessage => ({
  id,
  role: "assistant",
  createdAt: D,
  modelName: "Claude Opus",
  durationMs,
  content,
});
const tool = (id: string, name: string, kind: string, primaryArg: string, done: boolean): ChatPart => ({
  type: "tool-call",
  toolCallId: id,
  toolName: name,
  kind,
  status: done ? "completed" : "in_progress",
  args: { target: primaryArg },
  primaryArg,
});

/** Tool steps that appear one by one, each finishing when the next starts. */
function steps(time: number, list: Array<{ at: number; name: string; kind: string; arg: string }>, end: number): ChatPart[] {
  return list
    .filter((step) => time >= step.at)
    .map((step, index, shown) => {
      const next = list[index + 1];
      const done = next ? time >= next.at : time >= end;
      void shown;
      return tool(`s${index}`, step.name, step.kind, step.arg, done);
    });
}

function Panel({
  sessionId,
  page,
  messages,
  running,
  picking,
  control,
  artifacts,
  quote,
}: {
  sessionId: string;
  page: CurrentPage;
  messages: ChatMessage[];
  running: boolean;
  picking?: boolean;
  control?: ReactNode;
  artifacts?: AttachmentItem[];
  quote?: { id: string; text: string };
}) {
  return (
    <ChatPane
      locale={locale}
      hostReady
      sessionId={sessionId}
      messages={messages}
      isRunning={running}
      pickingElement={Boolean(picking)}
      models={MODELS}
      modelId="claude-opus"
      showModelPicker
      onSend={noop}
      onEnqueue={noop}
      onUpdateQueued={noop}
      onDeleteQueued={noop}
      onSendQueuedNow={noop}
      onEditingQueued={noop}
      onMoveQueued={noop}
      onRevise={noop}
      onCancel={noop}
      onFork={noop}
      onRegenerate={noop}
      onPickAttachments={noopAsync}
      onPasteImages={noopAsync}
      onUploadFiles={noopAsync}
      onPickElement={noopAsync}
      onCancelElementPick={noop}
      onPreviewImage={async () => ""}
      onModel={noop}
      agentMode="ask"
      onAgentMode={noop}
      agentModes={AGENT_MODES}
      agentModeId="agent"
      onAgentModeId={noop}
      iconOnly={false}
      narrowModel={false}
      flatActions={false}
      skills={SKILLS}
      onRefreshSkills={noop}
      page={page}
      queue={[]}
      control={control}
      artifacts={artifacts}
      insertQuote={quote}
      contextUsage={{ used: 38200, size: 200000 }}
    />
  );
}

// ---------------------------------------------------------------------------------------
// Shared visual pieces
// ---------------------------------------------------------------------------------------

function BrowserFrame({ url, page, panel }: { url: string; page: ReactNode; panel: ReactNode }) {
  return (
    <div className="pv-window">
      <div className="pv-chrome">
        <div className="pv-dots">
          <span /> <span /> <span />
        </div>
        <div className="pv-nav">
          <ArrowLeft size={14} />
          <ArrowRight size={14} />
          <RotateCw size={13} />
        </div>
        <div className="pv-address">
          <Lock size={11} />
          <span>{url}</span>
        </div>
        <img className="pv-ext" src={logoUrl} alt="" />
      </div>
      <div className="pv-body">
        <div className="pv-page">{page}</div>
        <div className="pv-panel">{panel}</div>
      </div>
    </div>
  );
}

function AgentCursor({ x, y, clickAt, time }: { x: number; y: number; clickAt: number[]; time: number }) {
  const ripple = clickAt.map((at) => time - at).find((d) => d >= 0 && d < 0.45);
  return (
    <div className="pv-cursor" style={{ left: x, top: y }}>
      {ripple != null ? (
        <span className="pv-ripple" style={{ transform: `scale(${0.3 + ripple * 5})`, opacity: 1 - ripple / 0.45 }} />
      ) : null}
      <svg viewBox="0 0 24 28" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="pv-cursor-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#39b6ff" />
            <stop offset="100%" stopColor="#bd45fb" />
          </linearGradient>
        </defs>
        <path
          d="M4.2 2.4 4.2 22.8 10.1 17.4 14.2 26.2 17.6 24.7 13.4 15.7 21.2 15.7Z"
          fill="#fff"
          stroke="url(#pv-cursor-grad)"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Caption({ title, sub, local }: { title: string; sub: string; local: number }) {
  const a = easeOut(prog(local, 0.3, 1.1));
  const b = easeOut(prog(local, 0.7, 1.5));
  return (
    <div className="pv-caption">
      <div className="pv-caption-title" style={{ opacity: a, transform: `translateY(${(1 - a) * 18}px)` }}>
        {title}
      </div>
      <div className="pv-caption-sub" style={{ opacity: b, transform: `translateY(${(1 - b) * 14}px)` }}>
        {sub}
      </div>
    </div>
  );
}

function Stage({ local, children }: { local: number; children: ReactNode }) {
  // Browser scenes float in with a gentle tilt that settles flat.
  const a = easeOut(prog(local, 0, 1.2));
  return (
    <div
      className="pv-stage"
      style={{
        transform: `perspective(1600px) rotateX(${(1 - a) * 10}deg) translateY(${(1 - a) * 40}px) scale(${0.94 + a * 0.06})`,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Scenes. Each gets `local` = seconds since the scene started.
// ---------------------------------------------------------------------------------------

function IntroScene({ local }: { local: number }) {
  const logo = easeOut(prog(local, 0.2, 1.6));
  const word = easeOut(prog(local, 1.2, 2.4));
  const slogan = easeOut(prog(local, 2.2, 3.4));
  return (
    <div className="pv-center">
      <div className="pv-orbit" style={{ transform: `rotate(${local * 24}deg)`, opacity: logo }} />
      <div className="pv-orbit pv-orbit-2" style={{ transform: `rotate(${-local * 16}deg)`, opacity: logo * 0.8 }} />
      <img
        className="pv-hero-logo"
        src={logoUrl}
        alt=""
        style={{ opacity: logo, transform: `scale(${0.6 + logo * 0.4}) rotate(${(1 - logo) * -40}deg)` }}
      />
      <div className="pv-wordmark" style={{ opacity: word, letterSpacing: `${(1 - word) * 18 - 1}px` }}>
        OpenSider
      </div>
      <div className="pv-slogan" style={{ opacity: slogan, transform: `translateY(${(1 - slogan) * 16}px)` }}>
        {COPY.slogan}
      </div>
    </div>
  );
}

const AGENTS = ["Claude Code", "Codex", "GitHub Copilot", "OpenCode", "Cursor"];

function AgentsScene({ local }: { local: number }) {
  const title = easeOut(prog(local, 0.2, 1.2));
  const shield = easeOut(prog(local, 5.2, 6.2));
  return (
    <div className="pv-center">
      <div className="pv-big" style={{ opacity: title, transform: `translateY(${(1 - title) * 20}px)` }}>
        {COPY.agentsTitle}
      </div>
      <div className="pv-agents">
        {AGENTS.map((name, i) => {
          const a = easeOut(prog(local, 1.2 + i * 0.35, 2.0 + i * 0.35));
          return (
            <div key={name} className="pv-agent" style={{ opacity: a, transform: `translateY(${(1 - a) * 30}px)` }}>
              <Terminal size={18} />
              <span>{name}</span>
            </div>
          );
        })}
      </div>
      <div className="pv-more" style={{ opacity: easeOut(prog(local, 3.4, 4.2)) }}>
        {COPY.agentsMore}
      </div>
      <div className="pv-private" style={{ opacity: shield, transform: `scale(${0.9 + shield * 0.1})` }}>
        <ShieldCheck size={22} />
        {COPY.private}
      </div>
    </div>
  );
}

const NEWS_PAGE: CurrentPage = {
  tabId: 1,
  url: "https://news.example.com/ai",
  title: locale === "zh" ? "今日 AI 快讯 — news.example.com" : "Today in AI — news.example.com",
  updatedAt: D.toISOString(),
};

function ContextScene({ local }: { local: number }) {
  const T = local;
  const ask = 2.2;
  const end = 15.5;
  const messages: ChatMessage[] = [];
  if (T >= ask) messages.push(user("u1", COPY.contextAsk));
  if (T >= ask + 0.8) {
    const parts = steps(
      T,
      [
        { at: ask + 0.8, name: "read_page", kind: "read", arg: NEWS_PAGE.title },
        { at: ask + 4.2, name: "Write", kind: "edit", arg: "outputs/ai-digest.html" },
        { at: ask + 8.4, name: "open_tab", kind: "other", arg: "ai-digest.html" },
      ],
      end,
    );
    if (T >= end) parts.push({ type: "text", text: COPY.contextAnswer });
    messages.push(assistant("a1", parts, T >= end ? 13800 : undefined));
  }
  const showDigest = T >= ask + 9.4;
  const digestIn = easeOut(prog(T, ask + 9.4, ask + 10.4));
  // The page "reads" itself: a scan line sweeps the headlines while read_page runs.
  const scan = prog(T, ask + 0.8, ask + 4.0);
  const order = [1, 0, 2];
  return (
    <>
      <Stage local={local}>
        <BrowserFrame
          url={showDigest ? "file:///~/.opensider/workspace/outputs/ai-digest.html" : NEWS_PAGE.url}
          page={
            <>
              <div className="pv-news">
                <div className="pv-news-head">
                  <Star size={14} /> news.example.com
                </div>
                <h1>{COPY.newsTitle}</h1>
                {NEWS.map(([title, blurb], i) => (
                  <div key={title} className="pv-article">
                    <div className="pv-thumb" style={{ filter: `hue-rotate(${i * 50}deg)` }} />
                    <div>
                      <h3>{title}</h3>
                      <p>{blurb}</p>
                    </div>
                  </div>
                ))}
                {scan > 0 && scan < 1 ? <div className="pv-scan" style={{ top: 70 + scan * 400 }} /> : null}
              </div>
              {showDigest ? (
                <div className="pv-digest" style={{ opacity: digestIn, transform: `translateY(${(1 - digestIn) * 24}px)` }}>
                  <h2>{COPY.digestTitle}</h2>
                  {order.map((index, rank) => {
                    const a = easeOut(prog(T, ask + 10 + rank * 0.4, ask + 10.8 + rank * 0.4));
                    return (
                      <div key={index} className="pv-rank" style={{ opacity: a, transform: `translateX(${(1 - a) * 30}px)` }}>
                        <span className="pv-rank-no">{rank + 1}</span>
                        <div>
                          <h3>{NEWS[index][0]}</h3>
                          <p>{NEWS[index][1]}</p>
                        </div>
                        <span className="pv-score">{[96, 88, 74][rank]}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          }
          panel={
            <Panel
              sessionId="ctx"
              page={NEWS_PAGE}
              messages={messages}
              running={T >= ask && T < end}
              artifacts={
                T >= ask + 8.4
                  ? [{ path: "~/.opensider/workspace/outputs/ai-digest.html", name: "ai-digest.html", kind: "file" }]
                  : []
              }
            />
          }
        />
      </Stage>
      <Caption title={COPY.contextTitle} sub={COPY.contextSub} local={local} />
    </>
  );
}

const SHOP_PAGE: CurrentPage = {
  tabId: 2,
  url: "https://brew.example.com/order",
  title: "Brew & Co. — Order ahead",
  updatedAt: D.toISOString(),
};

// Field centres inside the page area (page area origin = top-left of .pv-page).
const F = { drink: { x: 330, y: 168 }, milk: { x: 330, y: 238 }, sizeL: { x: 436, y: 306 }, time: { x: 330, y: 376 }, place: { x: 330, y: 452 } };

function AutomationScene({ local }: { local: number }) {
  const T = local;
  const ask = 1.6;
  const s = ask + 1.6; // first action
  const marks = { drink: s + 1.2, milk: s + 4.0, size: s + 7.0, time: s + 9.4, place: s + 13.0 };
  const end = marks.place + 2.4;
  const messages: ChatMessage[] = [];
  if (T >= ask) messages.push(user("u1", COPY.autoAsk));
  if (T >= ask + 0.8) {
    const parts = steps(
      T,
      [
        { at: ask + 0.8, name: "read_page", kind: "read", arg: SHOP_PAGE.title },
        { at: marks.drink - 0.6, name: "page_type", kind: "other", arg: `${COPY.drink} · ${COPY.drinkVal}` },
        { at: marks.milk - 0.6, name: "page_select", kind: "other", arg: `${COPY.milk} · ${COPY.milkVal}` },
        { at: marks.size - 0.6, name: "page_click", kind: "other", arg: `${COPY.size} · L` },
        { at: marks.time - 0.6, name: "page_type", kind: "other", arg: `${COPY.pickup} · 9:30` },
        { at: marks.place - 0.6, name: "page_click", kind: "other", arg: COPY.place },
      ],
      end,
    );
    if (T >= end) parts.push({ type: "text", text: COPY.autoAnswer });
    messages.push(assistant("a1", parts, T >= end ? 15600 : undefined));
  }
  const acting = T >= ask + 0.8 && T < end;
  const cursor = along(T, [
    { at: s - 0.4, x: 560, y: 520 },
    { at: marks.drink - 0.1, ...F.drink },
    { at: marks.milk - 0.6, ...F.drink },
    { at: marks.milk - 0.1, ...F.milk },
    { at: marks.size - 0.6, ...F.milk },
    { at: marks.size - 0.1, ...F.sizeL },
    { at: marks.time - 0.6, ...F.sizeL },
    { at: marks.time - 0.1, ...F.time },
    { at: marks.place - 0.6, ...F.time },
    { at: marks.place - 0.1, ...F.place },
  ]);
  const ring = (key: keyof typeof marks, w: number, h: number, c: { x: number; y: number }) => {
    const a = marks[key];
    const on = T >= a - 0.3 && T < a + 2.0;
    return on ? <div className="pv-ring" style={{ left: c.x - w / 2, top: c.y - h / 2, width: w, height: h }} /> : null;
  };
  const drink = T >= marks.drink ? typed(COPY.drinkVal, T, marks.drink, 10) : "";
  const milk = T >= marks.milk + 0.2 ? COPY.milkVal : "—";
  const size = T >= marks.size ? "L" : "M";
  const time = T >= marks.time ? typed("9:30", T, marks.time, 6) : "";
  const done = T >= marks.place + 0.6;
  const toast = easeOut(prog(T, marks.place + 0.6, marks.place + 1.3));
  return (
    <>
      <Stage local={local}>
        <BrowserFrame
          url={SHOP_PAGE.url}
          page={
            <div className="pv-shop">
              <div className="pv-shop-head">
                <Coffee size={16} /> {COPY.shopName}
                <span className="pv-shop-user">Alex ▾</span>
              </div>
              <h1>{COPY.shopHead}</h1>
              <div className="pv-form">
                <label>{COPY.drink}</label>
                <div className="pv-input">{drink}</div>
                <label>{COPY.milk}</label>
                <div className="pv-input pv-select">{milk}</div>
                <label>{COPY.size}</label>
                <div className="pv-sizes">
                  {["S", "M", "L"].map((v) => (
                    <span key={v} className={v === size ? "is-on" : ""}>
                      {v}
                    </span>
                  ))}
                </div>
                <label>{COPY.pickup}</label>
                <div className="pv-input">{time}</div>
                <div className={`pv-place ${done ? "is-done" : ""}`}>{COPY.place}</div>
              </div>
              {ring("drink", 340, 46, F.drink)}
              {ring("milk", 340, 46, F.milk)}
              {ring("size", 56, 46, F.sizeL)}
              {ring("time", 340, 46, F.time)}
              {ring("place", 340, 50, F.place)}
              {T >= s - 0.4 && T < end + 0.5 ? (
                <AgentCursor x={cursor.x} y={cursor.y} time={T} clickAt={Object.values(marks)} />
              ) : null}
              {done ? (
                <div className="pv-toast" style={{ opacity: toast, transform: `translate(-50%, ${(1 - toast) * 20}px)` }}>
                  <Check size={16} /> {COPY.confirmed}
                </div>
              ) : null}
            </div>
          }
          panel={
            <Panel
              sessionId="auto"
              page={SHOP_PAGE}
              messages={messages}
              running={T >= ask && T < end}
              control={
                T >= ask + 0.8 && T < end + 1 ? (
                  <ControlBanner
                    locale={locale}
                    tabs={[{ tabId: 2, title: SHOP_PAGE.title, url: SHOP_PAGE.url, acting }]}
                    onRelease={noop}
                    onReleaseTab={noop}
                    onFocusTab={noop}
                    onGrant={noop}
                  />
                ) : undefined
              }
            />
          }
        />
      </Stage>
      <Caption title={COPY.autoTitle} sub={COPY.autoSub} local={local} />
    </>
  );
}

const READ_PAGE: CurrentPage = {
  tabId: 3,
  url: "https://blog.example.com/agents",
  title: "Agents in the browser",
  updatedAt: D.toISOString(),
};

function SelectionScene({ local }: { local: number }) {
  const T = local;
  const selStart = 1.6;
  const selEnd = 3.0;
  const n = Math.round(COPY.selPick.length * easeInOut(prog(T, selStart, selEnd)));
  const bar = easeOut(prog(T, selEnd + 0.1, selEnd + 0.6));
  const clickTr = 5.0;
  const result = T >= clickTr + 0.2;
  const resultIn = easeOut(prog(T, clickTr + 0.2, clickTr + 0.8));
  const clickQuote = 10.0;
  const cursor = along(T, [
    { at: selStart - 0.6, x: 150, y: 250 },
    { at: selStart, x: 150, y: 224 },
    { at: selEnd, x: 420, y: 224 },
    { at: clickTr - 0.7, x: 420, y: 230 },
    { at: clickTr, x: 228, y: 278 },
    { at: clickQuote - 0.8, x: 228, y: 278 },
    { at: clickQuote, x: 404, y: 278 },
  ]);
  return (
    <>
      <Stage local={local}>
        <BrowserFrame
          url={READ_PAGE.url}
          page={
            <div className="pv-read">
              <div className="pv-news-head">
                <Star size={14} /> blog.example.com
              </div>
              <h1>{locale === "zh" ? "Agents in the browser" : "Les agents dans le navigateur"}</h1>
              <p className="pv-para">
                {COPY.selPara1}
                <mark className="pv-sel">{COPY.selPick.slice(0, n)}</mark>
                {COPY.selPick.slice(n)}
                {COPY.selPara2}
              </p>
              {bar > 0 ? (
                <div className="pv-toolbar" style={{ opacity: bar, transform: `translateY(${(1 - bar) * 8}px)` }}>
                  <img src={logoUrl} alt="" />
                  <span className={result ? "is-on" : ""}>
                    <Languages size={14} />
                    {locale === "zh" ? "翻译" : "Translate"}
                  </span>
                  <span>
                    <Search size={14} />
                    {locale === "zh" ? "搜索" : "Search"}
                  </span>
                  <span className={T >= clickQuote ? "is-on" : ""}>
                    <Quote size={14} />
                    {locale === "zh" ? "引用" : "Quote"}
                  </span>
                </div>
              ) : null}
              {result ? (
                <div className="pv-result" style={{ opacity: resultIn, transform: `translateY(${(1 - resultIn) * 10}px)` }}>
                  <div className="pv-result-title">{tr(locale, "selectionTranslateTitle")}</div>
                  <div className="pv-result-body">{typed(COPY.selResult, T, clickTr + 0.6, 18)}</div>
                </div>
              ) : null}
              {T >= selStart - 0.6 ? (
                <AgentCursor x={cursor.x} y={cursor.y} time={T} clickAt={[clickTr, clickQuote]} />
              ) : null}
            </div>
          }
          panel={
            <Panel
              sessionId="sel"
              page={READ_PAGE}
              messages={[]}
              running={false}
              quote={T >= clickQuote + 0.1 ? { id: "q1", text: COPY.selPick } : undefined}
            />
          }
        />
      </Stage>
      <Caption title={COPY.selTitle} sub={COPY.selSub} local={local} />
    </>
  );
}

const SHOP2_PAGE: CurrentPage = {
  tabId: 4,
  url: "https://shop.example.com/headphones",
  title: "Headphones — shop.example.com",
  updatedAt: D.toISOString(),
};

function PickScene({ local }: { local: number }) {
  const T = local;
  const pickStart = 1.4;
  const clickAt = 5.4;
  const ask = 6.4;
  const end = ask + 7.6;
  // Card centres inside the page area.
  const cards = [
    { x: 125, y: 270 },
    { x: 340, y: 270 },
    { x: 555, y: 270 },
  ];
  const cursor = along(T, [
    { at: pickStart, x: 300, y: 520 },
    { at: pickStart + 1.0, ...cards[0] },
    { at: pickStart + 1.8, ...cards[0] },
    { at: pickStart + 2.6, ...cards[2] },
    { at: pickStart + 3.2, ...cards[2] },
    { at: clickAt - 0.2, ...cards[1] },
  ]);
  const hover = T < clickAt + 0.6 ? cards.reduce((best, c, i) => (Math.abs(c.x - cursor.x) < Math.abs(cards[best].x - cursor.x) ? i : best), 0) : 1;
  const picking = T >= pickStart && T < clickAt + 0.1;
  const messages: ChatMessage[] = [];
  const attachment: AttachmentItem = { path: "div.product-card:nth-child(2)", name: "div.product-card:nth-child(2)", kind: "element" };
  if (T >= ask) messages.push(user("u1", COPY.pickAsk, [attachment]));
  if (T >= ask + 0.8) {
    const parts = steps(
      T,
      [
        { at: ask + 0.8, name: "read_element", kind: "read", arg: "div.product-card:nth-child(2)" },
        { at: ask + 3.2, name: "read_page", kind: "read", arg: SHOP2_PAGE.title },
      ],
      end,
    );
    if (T >= end) parts.push({ type: "text", text: COPY.pickAnswer });
    messages.push(assistant("a1", parts, T >= end ? 7200 : undefined));
  }
  return (
    <>
      <Stage local={local}>
        <BrowserFrame
          url={SHOP2_PAGE.url}
          page={
            <div className="pv-shop2">
              <div className="pv-news-head">
                <Headphones size={14} /> shop.example.com
              </div>
              <h1>{COPY.shopHeadphones}</h1>
              <div className="pv-cards">
                {PRODUCTS.map((p, i) => {
                  const hot = T >= pickStart && hover === i && (picking || T < clickAt + 0.6);
                  const chosen = T >= clickAt && i === 1;
                  return (
                    <div key={p.name} className={`pv-card ${hot ? "is-hot" : ""} ${chosen ? "is-chosen" : ""}`}>
                      <div className="pv-card-img" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 70% 62%), hsl(${p.hue + 40} 70% 40%))` }}>
                        <Headphones size={54} color="#fff" strokeWidth={1.4} />
                      </div>
                      <h3>{p.name}</h3>
                      <div className="pv-stars">{"★★★★★".slice(0, p.stars)}<span>{"★★★★★".slice(p.stars)}</span></div>
                      <p>
                        {COPY.battery} {p.battery}
                      </p>
                      <div className="pv-price">{p.price}</div>
                      {hot && picking ? <span className="pv-pick-tag">div.product-card</span> : null}
                    </div>
                  );
                })}
              </div>
              {picking ? (
                <div className="pv-pick-badge">
                  <MousePointer2 size={12} /> {locale === "zh" ? "点击页面元素提问" : "Pick an element to ask about"}
                </div>
              ) : null}
              {T >= pickStart && T < ask ? <AgentCursor x={cursor.x} y={cursor.y} time={T} clickAt={[clickAt]} /> : null}
            </div>
          }
          panel={<Panel sessionId="pick" page={SHOP2_PAGE} messages={messages} running={T >= ask && T < end} picking={picking} />}
        />
      </Stage>
      <Caption title={COPY.pickTitle} sub={COPY.pickSub} local={local} />
    </>
  );
}

function InstallScene({ local }: { local: number }) {
  const T = local;
  const card = easeOut(prog(T, 0.2, 1.0));
  const prompt = typed(COPY.installPrompt, T, 1.0, locale === "zh" ? 42 : 70);
  const title = easeOut(prog(T, 0.1, 0.9));
  return (
    <div className="pv-center">
      <div className="pv-big" style={{ opacity: title, transform: `translateY(${(1 - title) * 20}px)` }}>
        {COPY.installTitle}
      </div>
      <div className="pv-sub" style={{ opacity: easeOut(prog(T, 0.5, 1.3)) }}>
        {COPY.installSub}
      </div>
      <div className="pv-term" style={{ opacity: card, transform: `translateY(${(1 - card) * 30}px)` }}>
        <div className="pv-term-head">
          <Terminal size={14} /> {COPY.agentLabel}
          <Copy size={14} className="pv-term-copy" />
        </div>
        <div className="pv-term-body">
          <span className="pv-term-prompt">›</span>
          <span className="pv-term-text">{prompt}</span>
          {prompt.length < COPY.installPrompt.length || Math.floor(T * 2) % 2 === 0 ? <span className="pv-caret" /> : null}
        </div>
        <div className="pv-steps">
          {COPY.steps.map((step, i) => {
            const at = 4.8 + i * 1.0;
            const a = easeOut(prog(T, at, at + 0.5));
            return (
              <div key={step} className="pv-step" style={{ opacity: a, transform: `translateX(${(1 - a) * 20}px)` }}>
                <span className="pv-check">
                  <Check size={13} strokeWidth={3} />
                </span>
                {step}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OutroScene({ local }: { local: number }) {
  const a = easeOut(prog(local, 0.2, 1.4));
  const b = easeOut(prog(local, 1.2, 2.2));
  const fade = 1 - prog(local, 8.6, 10);
  return (
    <div className="pv-center" style={{ opacity: fade }}>
      <div className="pv-orbit" style={{ transform: `rotate(${local * 24}deg)`, opacity: a }} />
      <img className="pv-hero-logo" src={logoUrl} alt="" style={{ opacity: a, transform: `scale(${0.7 + a * 0.3})` }} />
      <div className="pv-wordmark" style={{ opacity: a }}>
        OpenSider
      </div>
      <div className="pv-slogan" style={{ opacity: b }}>
        {COPY.slogan}
      </div>
      <div className="pv-url" style={{ opacity: b }}>
        <Github size={18} /> github.com/parksben/opensider
      </div>
    </div>
  );
}

const SCENES: Array<{ start: number; end: number; render: (local: number) => ReactNode; key: string }> = [
  { key: "intro", start: 0, end: 8, render: (l) => <IntroScene local={l} /> },
  { key: "agents", start: 8, end: 18, render: (l) => <AgentsScene local={l} /> },
  { key: "context", start: 18, end: 42, render: (l) => <ContextScene local={l} /> },
  { key: "auto", start: 42, end: 64, render: (l) => <AutomationScene local={l} /> },
  { key: "sel", start: 64, end: 78, render: (l) => <SelectionScene local={l} /> },
  { key: "pick", start: 78, end: 96, render: (l) => <PickScene local={l} /> },
  { key: "install", start: 96, end: 106, render: (l) => <InstallScene local={l} /> },
  { key: "outro", start: 106, end: DURATION, render: (l) => <OutroScene local={l} /> },
];

const FADE = 0.5;

function Background({ time }: { time: number }) {
  const blob = (hue: string, x: number, y: number, s: number): CSSProperties => ({
    background: `radial-gradient(circle, ${hue} 0%, transparent 65%)`,
    left: x,
    top: y,
    width: s,
    height: s,
  });
  return (
    <div className="pv-bg">
      <div className="pv-blob" style={blob("rgba(212,160,84,0.30)", 120 + Math.sin(time * 0.31) * 140, -160 + Math.cos(time * 0.23) * 80, 760)} />
      <div className="pv-blob" style={blob("rgba(57,182,255,0.20)", 640 + Math.cos(time * 0.27) * 160, 220 + Math.sin(time * 0.19) * 100, 820)} />
      <div className="pv-blob" style={blob("rgba(189,69,251,0.18)", -200 + Math.sin(time * 0.21) * 120, 340 + Math.cos(time * 0.29) * 80, 700)} />
      <div className="pv-grid" style={{ backgroundPosition: `${(time * 6) % 40}px ${(time * 10) % 40}px` }} />
    </div>
  );
}

function Promo({ time }: { time: number }) {
  return (
    <div className="pv-root">
      <Background time={time} />
      {SCENES.filter((s) => time >= s.start && time < s.end + FADE).map((s) => {
        const local = time - s.start;
        const out = s.end === DURATION ? 1 : 1 - prog(time, s.end, s.end + FADE);
        const inn = s.start === 0 ? 1 : prog(time, s.start, s.start + FADE);
        return (
          <div key={s.key} className="pv-scene" style={{ opacity: Math.min(inn, out) }}>
            {s.render(local)}
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const [time, setTime] = useState(Number(params.get("t") ?? 0));
  useEffect(() => {
    const w = window as unknown as { __promoSeek: (t: number) => Promise<void>; __promoDuration: number };
    w.__promoDuration = DURATION;
    w.__promoSeek = (next: number) =>
      new Promise((resolve) => {
        flushSync(() => setTime(next));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    document.fonts.ready.then(() => {
      document.documentElement.dataset.shotReady = "1";
    });
  }, []);
  return (
    <>
      <Promo time={time} />
      <style>{PROMO_CSS}</style>
    </>
  );
}

const PROMO_CSS = `
.pv-root { position: relative; width: 1280px; height: 720px; overflow: hidden; background: #07080a; color: #ece6d4;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif; }
.pv-bg { position: absolute; inset: 0; overflow: hidden; }
.pv-blob { position: absolute; border-radius: 50%; filter: blur(30px); }
.pv-grid { position: absolute; inset: 0; opacity: .22;
  background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 40px 40px; mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%); }
.pv-scene { position: absolute; inset: 0; }
.pv-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.pv-hero-logo { width: 150px; height: 150px; filter: drop-shadow(0 0 40px rgba(212,160,84,.55)); position: relative; z-index: 1; }
.pv-orbit { position: absolute; width: 300px; height: 300px; top: calc(50% - 230px); border-radius: 50%;
  border: 1.5px solid transparent; border-top-color: rgba(212,160,84,.8); border-right-color: rgba(57,182,255,.5); }
.pv-orbit-2 { width: 360px; height: 360px; top: calc(50% - 260px); border-top-color: rgba(189,69,251,.6); border-right-color: transparent; border-bottom-color: rgba(212,160,84,.35); }
.pv-wordmark { margin-top: 36px; font-size: 76px; font-weight: 600; letter-spacing: -1px;
  background: linear-gradient(90deg, #f3e3bd, #d4a054 45%, #39b6ff 80%, #bd45fb); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pv-slogan { margin-top: 10px; font-size: 28px; color: #d8d0b8; letter-spacing: .5px; }
.pv-url { margin-top: 26px; display: inline-flex; align-items: center; gap: 10px; font-size: 22px; color: #a39b84;
  padding: 10px 20px; border: 1px solid rgba(212,160,84,.35); border-radius: 999px; background: rgba(20,22,15,.6); }
.pv-big { font-size: 46px; font-weight: 600; max-width: 1100px; line-height: 1.2;
  background: linear-gradient(90deg, #fff4d8, #d4a054); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pv-sub { margin-top: 12px; font-size: 22px; color: #a39b84; }
.pv-agents { margin-top: 48px; display: flex; gap: 16px; }
.pv-agent { display: inline-flex; align-items: center; gap: 10px; padding: 16px 22px; border-radius: 16px; font-size: 22px;
  background: linear-gradient(180deg, rgba(36,38,30,.9), rgba(20,22,15,.9)); border: 1px solid rgba(212,160,84,.3);
  box-shadow: 0 10px 40px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06); color: #ece6d4; }
.pv-agent svg { color: #d4a054; }
.pv-more { margin-top: 18px; font-size: 18px; color: #a39b84; }
.pv-private { margin-top: 46px; display: inline-flex; align-items: center; gap: 10px; font-size: 24px; color: #8fbf6a;
  padding: 12px 24px; border-radius: 999px; background: rgba(143,191,106,.10); border: 1px solid rgba(143,191,106,.4); }
.pv-stage { position: absolute; left: 80px; top: 22px; width: 1120px; height: 580px; transform-origin: 50% 100%; }
.pv-window { width: 100%; height: 100%; display: flex; flex-direction: column; border-radius: 14px; overflow: hidden;
  background: #1b1d17; box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08), 0 0 60px rgba(212,160,84,.12); }
.pv-chrome { height: 40px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 12px; background: #23251e; border-bottom: 1px solid #2c3124; color: #a39b84; }
.pv-dots { display: flex; gap: 6px; } .pv-dots span { width: 11px; height: 11px; border-radius: 99px; background: #4a4c44; }
.pv-dots span:nth-child(1) { background: #e0675c; } .pv-dots span:nth-child(2) { background: #e0b04c; } .pv-dots span:nth-child(3) { background: #6cbf5a; }
.pv-nav { display: flex; gap: 10px; }
.pv-address { flex: 0 1 520px; display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px; border-radius: 99px; background: #14160f; font-size: 12px; color: #c8c0a8; }
.pv-address span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pv-ext { margin-left: auto; width: 18px; height: 18px; filter: drop-shadow(0 0 6px rgba(212,160,84,.7)); }
.pv-body { flex: 1; min-height: 0; display: flex; }
.pv-page { position: relative; flex: 1; min-width: 0; overflow: hidden; background: #f7f8fa; color: #1a2330; font-size: 14px; }
.pv-panel { width: 420px; flex: none; background: var(--ink); border-left: 1px solid #2c3124; }
.pv-caption { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center; }
.pv-caption-title { font-size: 34px; font-weight: 600; line-height: 1.2;
  background: linear-gradient(90deg, #fff4d8, #d4a054 60%, #39b6ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pv-caption-sub { margin-top: 4px; font-size: 18px; color: #b7ae94; }
.pv-cursor { position: absolute; z-index: 20; margin-left: -4px; margin-top: -3px; filter: drop-shadow(0 3px 8px rgba(20,16,40,.45)); pointer-events: none; }
.pv-ripple { position: absolute; left: -8px; top: -8px; width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(57,182,255,.95); }
.pv-ring { position: absolute; z-index: 5; border-radius: 9px; border: 2px solid rgba(57,182,255,.95); background: rgba(189,69,251,.08);
  box-shadow: 0 0 0 1px rgba(255,255,255,.4), 0 8px 24px rgba(57,182,255,.3); }
.pv-news, .pv-read, .pv-shop, .pv-shop2 { position: absolute; inset: 0; padding: 20px 28px; }
.pv-news-head { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #1a2330; }
.pv-news h1, .pv-read h1, .pv-shop h1, .pv-shop2 h1 { margin: 16px 0 14px; font-size: 26px; color: #101722; }
.pv-article { display: flex; gap: 14px; align-items: center; padding: 12px; margin-bottom: 10px; background: #fff; border: 1px solid #e5e8ee; border-radius: 10px; }
.pv-thumb { width: 84px; height: 56px; flex: none; border-radius: 6px; background: linear-gradient(135deg, #f0c27a, #6a8ed8); }
.pv-article h3, .pv-rank h3 { margin: 0 0 4px; font-size: 15px; color: #101722; }
.pv-article p, .pv-rank p { margin: 0; font-size: 12.5px; color: #5a6876; }
.pv-scan { position: absolute; left: 20px; right: 20px; height: 3px; border-radius: 3px; background: linear-gradient(90deg, transparent, #39b6ff, #bd45fb, transparent);
  box-shadow: 0 0 18px rgba(57,182,255,.8); }
.pv-digest { position: absolute; inset: 0; padding: 26px 30px; background: linear-gradient(160deg, #101320, #1d1430); color: #fff; }
.pv-digest h2 { margin: 0 0 18px; font-size: 24px; background: linear-gradient(90deg, #fff, #d4a054); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pv-rank { display: flex; align-items: center; gap: 16px; padding: 14px 16px; margin-bottom: 12px; border-radius: 12px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); }
.pv-rank h3 { color: #fff; } .pv-rank p { color: #a8a4bd; }
.pv-rank-no { width: 38px; height: 38px; flex: none; display: grid; place-items: center; border-radius: 10px; font-size: 20px; font-weight: 700;
  background: linear-gradient(135deg, #d4a054, #bd45fb); color: #fff; }
.pv-score { margin-left: auto; font-size: 20px; font-weight: 700; color: #39b6ff; }
.pv-shop { background: linear-gradient(180deg, #fbf6ee, #f4ece0); }
.pv-shop-head { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #5a3a1c; }
.pv-shop-user { margin-left: auto; font-weight: 500; font-size: 13px; color: #7a5a3c; }
.pv-shop h1 { color: #3a2412; }
.pv-form { width: 340px; margin-left: 160px; }
.pv-form label { display: block; font-size: 12px; color: #7a5a3c; margin: 8px 0 4px; }
.pv-input { height: 40px; display: flex; align-items: center; padding: 0 12px; border-radius: 8px; border: 1px solid #e0cdb4; background: #fff; font-size: 15px; color: #2a1a0c; }
.pv-select::after { content: "▾"; margin-left: auto; color: #a08060; }
.pv-sizes { display: flex; gap: 10px; } .pv-sizes span { width: 46px; height: 40px; display: grid; place-items: center; border-radius: 8px; border: 1px solid #e0cdb4; background: #fff; font-weight: 600; color: #5a3a1c; }
.pv-sizes span.is-on { background: #6b3f1d; color: #fff; border-color: #6b3f1d; }
.pv-sizes span:nth-child(3) { margin-left: 0; }
.pv-place { margin-top: 18px; height: 44px; display: grid; place-items: center; border-radius: 10px; background: #6b3f1d; color: #fff; font-weight: 600; font-size: 15px; }
.pv-place.is-done { background: #3f7a4a; }
.pv-toast { position: absolute; left: 50%; bottom: 26px; display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 999px; background: #1f6b3a; color: #fff; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.pv-read { background: #fffdf8; }
.pv-para { margin: 40px 0 0; font-size: 19px; line-height: 1.75; color: #1d2430; max-width: 600px; }
.pv-sel { background: rgba(58,109,154,.28); color: inherit; border-radius: 3px; }
.pv-toolbar { position: absolute; left: 150px; top: 262px; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; background: #14160f; border: 1px solid #2c3124; box-shadow: 0 10px 30px rgba(0,0,0,.3); }
.pv-toolbar img { width: 18px; height: 18px; margin: 0 6px 0 4px; }
.pv-toolbar span { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 13px; color: #a39b84; }
.pv-toolbar span.is-on { background: rgba(255,255,255,.15); color: #ece6d4; }
.pv-result { position: absolute; left: 150px; top: 312px; width: 380px; border-radius: 12px; background: #14160f; border: 1px solid #2c3124; box-shadow: 0 14px 34px rgba(0,0,0,.35); padding: 12px 14px; color: #ece6d4; }
.pv-result-title { font-size: 12px; color: #a39b84; margin-bottom: 6px; }
.pv-result-body { font-size: 16px; line-height: 1.5; min-height: 24px; }
.pv-shop2 { background: #f6f7fb; }
.pv-cards { display: flex; gap: 16px; }
.pv-card { position: relative; width: 199px; padding: 12px; border-radius: 14px; background: #fff; border: 1px solid #e5e8ee; }
.pv-card.is-hot { outline: 2px solid #d4a054; background: rgba(212,160,84,.12); }
.pv-card.is-chosen { outline: 2px solid #d4a054; box-shadow: 0 0 0 6px rgba(212,160,84,.2); }
.pv-card-img { height: 120px; border-radius: 10px; display: grid; place-items: center; }
.pv-card h3 { margin: 10px 0 4px; font-size: 16px; color: #101722; }
.pv-card p { margin: 4px 0; font-size: 12.5px; color: #5a6876; }
.pv-stars { color: #e0a030; font-size: 13px; } .pv-stars span { color: #d6d9df; }
.pv-price { font-size: 18px; font-weight: 700; color: #101722; }
.pv-pick-tag { position: absolute; left: -2px; top: -24px; padding: 2px 8px; border-radius: 6px; background: #d4a054; color: #1a140b; font-size: 11px; font-family: ui-monospace, Menlo, monospace; }
.pv-pick-badge { position: absolute; left: 28px; bottom: 22px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: #d4a054; color: #1a140b; font-size: 12px; font-weight: 500; }
.pv-term { margin-top: 34px; width: 900px; text-align: left; border-radius: 16px; overflow: hidden; background: rgba(12,13,10,.92); border: 1px solid rgba(212,160,84,.35);
  box-shadow: 0 30px 80px rgba(0,0,0,.5), 0 0 60px rgba(212,160,84,.12); }
.pv-term-head { display: flex; align-items: center; gap: 8px; padding: 10px 16px; font-size: 13px; color: #a39b84; background: #17190f; border-bottom: 1px solid #2c3124; }
.pv-term-copy { margin-left: auto; }
.pv-term-body { padding: 18px 20px; font-family: ui-monospace, Menlo, "PingFang SC", monospace; font-size: 16px; line-height: 1.6; color: #ece6d4; min-height: 104px; white-space: pre-wrap; word-break: break-all; }
.pv-term-prompt { color: #d4a054; margin-right: 10px; }
.pv-caret { display: inline-block; width: 9px; height: 18px; margin-left: 2px; vertical-align: -3px; background: #d4a054; }
.pv-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; padding: 0 20px 20px; }
.pv-step { display: flex; align-items: center; gap: 10px; font-size: 16px; color: #d8d0b8; }
.pv-check { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #8fbf6a; color: #0c0d0a; }
`;

createRoot(document.getElementById("root")!).render(<App />);

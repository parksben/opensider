/**
 * Renders the real side panel inside a slim browser frame so README screenshots
 * match the product. Not part of the extension build (`vite.config.ts`).
 *
 *   cd packages/extension && npx vite --config vite.shots.config.ts
 *   # then open /shots.html?scene=automation|selection|pick&lang=en|zh
 */
import "./shots-shim";
import { ArrowLeft, ArrowRight, Languages, LoaderCircle, Lock, MousePointer2, Quote, RotateCw, Search, Star } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AgentModeOption, AgentModel, CurrentPage, SkillItem } from "@shared";
import { ChatPane } from "./components/ChatPane";
import type { ChatMessage } from "./chat-types";
import type { QueuedMessage } from "./queued-message";
import { applyLocale, type Locale } from "./i18n";
import { applyThemePreference } from "./theme";
import "./styles.css";

const params = new URLSearchParams(location.search);
const locale: Locale = params.get("lang") === "zh" ? "zh" : "en";
applyLocale(locale);
applyThemePreference("light");

const PAGE: CurrentPage = {
  tabId: 1,
  url: "https://news.example.com/ai",
  title: "Today in AI — news.example.com",
  updatedAt: new Date().toISOString(),
};

const MODELS: AgentModel[] = [
  { id: "auto", name: "Auto" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "claude-opus", name: "Claude Opus" },
];

const AGENT_MODES: AgentModeOption[] = [
  { id: "agent", name: "Agent", kind: "agent" },
  { id: "plan", name: "Plan", kind: "plan" },
];

const SKILLS: SkillItem[] = [
  {
    name: "canvas",
    alias: "canvas",
    source: "cursor_builtin",
    path: "~/.cursor/skills-cursor/canvas/SKILL.md",
    description: "Design with canvas: layout, colour and typography passes.",
  },
  {
    name: "coding-plan",
    alias: "coding-plan",
    source: "claude",
    path: "~/.claude/skills/coding-plan/SKILL.md",
    description: "Docs first, then code. The workflow to use for every feature.",
  },
];

const QUEUE: QueuedMessage[] = [];

const COPY = {
  en: {
    user: "Turn the headlines on this page into a ranked digest and save it as an HTML file.",
    answer: "Saved the digest to outputs/ai-digest.html and opened it in a new tab.",
  },
  zh: {
    user: "把这一页的标题整理成一份榜单，存成一个 HTML 文件。",
    answer: "榜单已写入 outputs/ai-digest.html，并在新标签里打开了。",
  },
} as const;

function messagesFor(lang: Locale): ChatMessage[] {
  const copy = COPY[lang];
  return [
    { id: "u1", role: "user", createdAt: new Date(), content: [{ type: "text", text: copy.user }] },
    {
      id: "a1",
      role: "assistant",
      createdAt: new Date(),
      modelName: "GPT-5.4",
      durationMs: 12000,
      content: [
        {
          type: "tool-call",
          toolCallId: "read-1",
          toolName: "read_page",
          kind: "read",
          status: "completed",
          args: { url: PAGE.url },
          primaryArg: PAGE.title,
        },
        { type: "text", text: copy.answer },
      ],
    },
  ];
}

const AUTO_COPY = {
  en: {
    user: "Search this site for open source AI news and open the first result.",
    answer: "Filled the search box, submitted it, and opened “Small models close the gap on reasoning”.",
    tool: "Search box",
  },
  zh: {
    user: "在这个站点搜索「本周开源 AI 新闻」，并打开第一条结果。",
    answer: "已把关键词填进搜索框并提交，然后打开了《小模型在推理上追平大模型》。",
    tool: "搜索框",
  },
} as const;

function automationMessagesFor(lang: Locale): ChatMessage[] {
  const copy = AUTO_COPY[lang];
  return [
    { id: "u1", role: "user", createdAt: new Date(), content: [{ type: "text", text: copy.user }] },
    {
      id: "a1",
      role: "assistant",
      createdAt: new Date(),
      modelName: "GPT-5.4",
      durationMs: 9000,
      content: [
        {
          type: "tool-call",
          toolCallId: "type-1",
          toolName: "page_type",
          kind: "execute",
          status: "completed",
          args: { selector: "input[name=q]", text: "open source AI news" },
          primaryArg: copy.tool,
        },
        { type: "text", text: copy.answer },
      ],
    },
  ];
}

const noop = () => undefined;
const noopAsync = async () => [];
const noopPick = async () => [];

function markReady() {
  document.documentElement.dataset.shotReady = "1";
}

const PAGE_ARTICLES = {
  en: [
    { title: "Small models close the gap on reasoning", blurb: "A new wave of 7B models trades breadth for depth." },
    { title: "Agents move into the browser", blurb: "Local CLIs are learning to drive tabs, forms and clicks." },
    { title: "Open weights, closed benchmarks", blurb: "Leaderboards are getting harder to trust." },
  ],
  zh: [
    { title: "小模型在推理上追平大模型", blurb: "一批 7B 模型用广度换深度。" },
    { title: "Agent 走进浏览器", blurb: "本地 CLI 开始操作标签页、表单和点击。" },
    { title: "开源权重，闭源榜单", blurb: "排行榜越来越难被信任。" },
  ],
} as const;

function PageArticle({ index }: { index: number }) {
  const item = PAGE_ARTICLES[locale][index];
  return (
    <div className="shot-article">
      <div className="shot-thumb" />
      <div className="shot-article-text">
        <h3>{item.title}</h3>
        <p>{item.blurb}</p>
      </div>
    </div>
  );
}

function PageBody() {
  return (
    <div className="shot-page">
      <header className="shot-page-head">
        <div className="shot-page-brand">
          <Star size={16} />
          <span>news.example.com</span>
        </div>
        <nav>
          <span>World</span>
          <span>Tech</span>
          <span>Science</span>
        </nav>
      </header>
      <h1 className="shot-page-title">{locale === "zh" ? "今日 AI 快讯" : "Today in AI"}</h1>
      {[0, 1, 2].map((index) => (
        <PageArticle key={index} index={index} />
      ))}
    </div>
  );
}

function BrowserFrame({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="shot-window">
      <div className="shot-chrome">
        <div className="shot-dots">
          <span /> <span /> <span />
        </div>
        <div className="shot-nav">
          <ArrowLeft size={15} />
          <ArrowRight size={15} />
          <RotateCw size={14} />
        </div>
        <div className="shot-address">
          <Lock size={11} />
          <span>{PAGE.url}</span>
        </div>
        <div className="shot-chrome-right">
          <Star size={15} />
        </div>
      </div>
      <div className="shot-body-row">
        <div className="shot-page-wrap">
          <PageBody />
          {overlay}
        </div>
        <div className="shot-panel">{children}</div>
      </div>
    </div>
  );
}

function PanelChat({ messages, pickingElement }: { messages: ChatMessage[]; pickingElement?: boolean }) {
  return (
    <ChatPane
      locale={locale}
      hostReady
      sessionId="s1"
      messages={messages}
      isRunning={false}
      pickingElement={Boolean(pickingElement)}
      models={MODELS}
      modelId="gpt-5.4"
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
      onPickElement={noopPick}
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
      page={PAGE}
      queue={QUEUE}
      contextUsage={{ used: 41200, size: 200000 }}
    />
  );
}

function AutomationScene() {
  return (
    <BrowserFrame
      overlay={
        <div className="shot-automation">
          <div className="shot-form">
            <div className="shot-field">
              <Search size={14} />
              <span className="shot-typed">
                {locale === "zh" ? "本周开源 AI 新闻" : "open source AI news this week"}
              </span>
              <span className="shot-caret" />
            </div>
            <button type="button" className="shot-submit is-clicking">
              {locale === "zh" ? "搜索" : "Search"}
              <span className="shot-ring" />
              <MousePointer2 className="shot-hand" size={18} />
            </button>
          </div>
          <div className="shot-auto-badge">
            <LoaderCircle className="shot-spin" size={13} />
            {locale === "zh" ? "Agent 正在操作此页面" : "The agent is driving this page"}
          </div>
        </div>
      }
    >
      <PanelChat messages={automationMessagesFor(locale)} />
    </BrowserFrame>
  );
}

function SelectionScene() {
  return (
    <BrowserFrame
      overlay={
        <div className="shot-selection">
          <p>
            {locale === "zh"
              ? "本地 CLI 正在学习驱动标签页、表单和点击，"
              : "Local CLIs are learning to drive tabs, forms and clicks, "}
            <mark className="shot-selected">
              {locale === "zh" ? "整个过程就发生在页面上" : "right where you are reading"}
            </mark>
            {locale === "zh" ? "，你可以随时接手。" : " and you can take over at any time."}
          </p>
          <div className="shot-toolbar">
            <button type="button">
              <Languages size={13} />
              {locale === "zh" ? "翻译" : "Translate"}
            </button>
            <button type="button">
              <Search size={13} />
              {locale === "zh" ? "搜索" : "Search"}
            </button>
            <button type="button">
              <Quote size={13} />
              {locale === "zh" ? "引用" : "Quote"}
            </button>
          </div>
        </div>
      }
    >
      <PanelChat messages={messagesFor(locale)} />
    </BrowserFrame>
  );
}

function PickScene() {
  return (
    <BrowserFrame
      overlay={
        <div className="shot-pick">
          <div className="shot-pick-card is-hot">
            <div className="shot-thumb" />
            <div className="shot-article-text">
              <h3>{PAGE_ARTICLES[locale][0].title}</h3>
              <p>{PAGE_ARTICLES[locale][0].blurb}</p>
            </div>
          </div>
          <div className="shot-pick-badge">
            <MousePointer2 size={12} />
            {locale === "zh" ? "点击页面元素提问" : "Pick an element to ask about"}
          </div>
        </div>
      }
    >
      <PanelChat messages={messagesFor(locale)} />
    </BrowserFrame>
  );
}

const SHOT_CSS = `
.shot-window {
  display: flex;
  flex-direction: column;
  width: 1120px;
  height: 700px;
  overflow: hidden;
  background: #f1f3f4;
  color: #1a2330;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.shot-chrome {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  flex: none;
  padding: 0 12px;
  background: #e8eaed;
  border-bottom: 1px solid #dadce0;
}
.shot-dots { display: flex; gap: 6px; }
.shot-dots span { width: 11px; height: 11px; border-radius: 999px; background: #c4c7cc; }
.shot-nav { display: flex; align-items: center; gap: 10px; color: #5f6368; }
.shot-address {
  display: flex; align-items: center; gap: 6px;
  min-width: 0; flex: 0 1 460px;
  height: 26px; padding: 0 10px;
  border-radius: 999px; background: #ffffff;
  color: #3c4043; font-size: 12px;
}
.shot-address span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot-chrome-right { margin-left: auto; display: flex; color: #5f6368; }
.shot-body-row { display: flex; min-height: 0; flex: 1; }
.shot-page-wrap { position: relative; min-width: 0; flex: 1 1 50%; overflow: hidden; background: #f7f8fa; color: #1a2330; }
.shot-panel {
  width: 560px; flex: none;
  background: var(--ink);
  border-left: 1px solid #dadce0;
  --vscode-gitDecoration-addedResourceForeground: #2d7a62;
  --vscode-gitDecoration-deletedResourceForeground: #b63d45;
}
.shot-page { padding: 22px 30px; }
.shot-page-head { display: flex; align-items: center; justify-content: space-between; color: #5a6876; }
.shot-page-brand { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #1a2330; }
.shot-page-head nav { display: flex; gap: 14px; font-size: 12px; }
.shot-page-title { margin: 18px 0 14px; font-size: 26px; color: #101722; }
.shot-article {
  display: flex; gap: 14px; align-items: center;
  padding: 14px; margin-bottom: 12px;
  background: #ffffff; border: 1px solid #e5e8ee; border-radius: 10px;
}
.shot-thumb { width: 84px; height: 56px; flex: none; border-radius: 6px; background: linear-gradient(135deg, #cfd6e2, #aeb8c8); }
.shot-article-text h3 { margin: 0 0 4px; font-size: 15px; color: #101722; }
.shot-article-text p { margin: 0; font-size: 12.5px; color: #5a6876; }
.shot-automation { position: absolute; inset: 0; padding: 80px 40px 0; background: #f7f8fa; }
.shot-form {
  display: flex; align-items: center; gap: 10px; width: 100%; max-width: 520px; margin: 0 auto;
  padding: 14px; background: #ffffff; border: 1px solid #e5e8ee; border-radius: 12px;
  box-shadow: 0 10px 30px rgba(16, 23, 34, 0.08);
}
.shot-field {
  display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
  height: 38px; padding: 0 12px; border: 1px solid #c9d2e0; border-radius: 8px;
  background: #f8fafc; color: #3c4043; font-size: 14px;
}
.shot-typed { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot-caret { width: 2px; height: 18px; flex: none; background: #3a6d9a; animation: shot-blink 1s steps(1) infinite; }
.shot-submit {
  position: relative; flex: none; height: 38px; padding: 0 18px;
  border: 0; border-radius: 8px; background: #3a6d9a; color: #ffffff; font-size: 14px; font-weight: 500;
}
.shot-submit.is-clicking { box-shadow: 0 0 0 4px rgba(58, 109, 154, 0.25); }
.shot-ring { position: absolute; inset: -5px; border: 2px solid #d4a054; border-radius: 11px; animation: shot-ping 1.3s ease-out infinite; }
.shot-hand { position: absolute; right: -9px; bottom: -13px; color: #1a2330; }
.shot-auto-badge {
  display: flex; align-items: center; gap: 6px; width: max-content;
  margin: 16px auto 0; padding: 5px 11px; border-radius: 999px;
  background: #d4a054; color: #1a140b; font-size: 12px; font-weight: 500;
}
.shot-spin { animation: shot-spin 0.9s linear infinite; }
@keyframes shot-spin { to { transform: rotate(360deg); } }
@keyframes shot-blink { 50% { opacity: 0; } }
@keyframes shot-ping { from { opacity: 0.9; transform: scale(0.96); } to { opacity: 0; transform: scale(1.12); } }
.shot-selection { position: absolute; inset: 0; padding: 90px 30px 0; background: #f7f8fa; }
.shot-selection p { max-width: 560px; margin: 0 auto; font-size: 17px; line-height: 1.7; color: #101722; }
.shot-selected { background: rgba(58, 109, 154, 0.22); color: inherit; border-radius: 3px; }
.shot-toolbar {
  display: flex; gap: 4px; width: max-content; margin: 12px auto 0;
  padding: 4px; border-radius: 10px;
  background: #ffffff; box-shadow: 0 8px 24px rgba(16, 23, 34, 0.16);
  border: 1px solid #e5e8ee;
}
.shot-toolbar button {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border: 0; border-radius: 7px;
  background: transparent; color: #1a2330; font-size: 12px; cursor: default;
}
.shot-toolbar button:first-child { background: rgba(58, 109, 154, 0.14); color: #3a6d9a; }
.shot-pick { position: absolute; inset: 0; padding: 90px 30px 0; background: #f7f8fa; }
.shot-pick-card {
  display: flex; gap: 14px; align-items: center;
  padding: 14px; background: #ffffff; border: 1px solid #e5e8ee; border-radius: 10px;
}
.shot-pick-card.is-hot { border-color: #d4a054; box-shadow: 0 0 0 2px rgba(212, 160, 84, 0.35); }
.shot-pick-badge {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 10px; padding: 5px 10px; border-radius: 999px;
  background: #d4a054; color: #1a140b; font-size: 12px; font-weight: 500; width: max-content;
}
`;

const scene = new URLSearchParams(location.search).get("scene");

function ReadyScene({ children }: { children: ReactNode }) {
  useEffect(() => {
    markReady();
  }, []);
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <ReadyScene>
    {scene === "selection" ? <SelectionScene /> : scene === "pick" ? <PickScene /> : <AutomationScene />}
    <style>{SHOT_CSS}</style>
  </ReadyScene>,
);

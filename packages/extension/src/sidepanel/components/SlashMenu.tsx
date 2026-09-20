import type { SkillItem, SkillSource } from "@shared";
import { Boxes, Puzzle, Sparkles, SquareMousePointer, Terminal, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  atMenuLock,
  armEnterSuppress,
  blockEnterEvent,
  closeAtMenuLock,
  isEnterKey,
  openAtMenuLock,
  releaseEnterSuppress,
} from "../at-menu-lock";
import { findMatchRanges } from "../at-menu-search";
import { SKILL_DETAIL_PX, SKILL_LIST_MIN_PX } from "../layout";
import { t, type Locale, type MessageKey } from "../i18n";
import { HighlightText } from "./HighlightText";
import { RippleButton } from "./RippleButton";

const SAFE = 16;
const GAP = 6;
/** 单列（详情折到列表下方）时整个弹层的宽度，与 @ 菜单保持一致。 */
const STACKED_WIDTH = 256;
/** 详情折到列表下方时详情区的最大高度。 */
const STACKED_DETAIL_MAX = 132;

/**
 * 两列并排需要的最小视口宽度：列表下限 + 详情 + 两侧安全距离。比这还窄就把详情折到
 * 列表下方（见 TECH_DESIGN「Skill 探测菜单」）。
 */
const TWO_COLUMN_MIN_VIEWPORT = SKILL_LIST_MIN_PX + SKILL_DETAIL_PX + SAFE * 2;

type Match = { skill: SkillItem; ranges: ReadonlyArray<readonly [number, number]> };

const SOURCE_ICON: Record<SkillSource, typeof Sparkles> = {
  claude: Sparkles,
  cursor: SquareMousePointer,
  agents: Users,
  codex: Terminal,
  stepclaw: Boxes,
  cursor_builtin: Puzzle,
};

const SOURCE_LABEL: Record<SkillSource, MessageKey> = {
  claude: "skillSourceClaude",
  cursor: "skillSourceCursor",
  agents: "skillSourceAgents",
  codex: "skillSourceCodex",
  stepclaw: "skillSourceStepClaw",
  cursor_builtin: "skillSourceCursorBuiltin",
};

/**
 * 搜索命中：名称 / 别名 / 说明都算，忽略大小写。命中字符的高亮只标在**别名**上（列表里
 * 显示的就是别名），说明命中时不标——说明那一栏本来就只用来让人认出这个 skill 干什么的。
 */
function matchSkill(skill: SkillItem, query: string): Match | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return { skill, ranges: [] };
  if (skill.name.toLowerCase().includes(needle)) return { skill, ranges: findMatchRanges(skill.alias, query) };
  if (skill.alias.toLowerCase().includes(needle)) return { skill, ranges: findMatchRanges(skill.alias, query) };
  if ((skill.description ?? "").toLowerCase().includes(needle)) return { skill, ranges: [] };
  return null;
}

function placeMenu(
  anchor: DOMRect,
  size: { width: number; height: number },
  vw: number,
  vh: number,
): { top: number; left: number; width: number; maxHeight: number } {
  const maxWidth = Math.max(120, vw - SAFE * 2);
  const width = Math.min(size.width, maxWidth);
  const spaceAbove = Math.max(0, anchor.top - SAFE - GAP);
  const maxHeight = spaceAbove > 0 ? Math.min(spaceAbove, vh - SAFE * 2) : Math.max(96, vh - SAFE * 2);
  const height = Math.min(size.height || 0, maxHeight);
  let top = spaceAbove > 0 ? anchor.top - GAP - height : SAFE;
  if (top < SAFE) top = SAFE;
  if (top + height > vh - SAFE) top = Math.max(SAFE, vh - SAFE - height);
  let left = anchor.left;
  if (left + width > vw - SAFE) left = vw - SAFE - width;
  if (left < SAFE) left = SAFE;
  return { top, left, width, maxHeight };
}

export function SlashMenu({
  open,
  locale,
  query,
  skills,
  ignoreRef,
  getAnchorRect,
  onQuery,
  onSelect,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  query: string;
  skills: SkillItem[];
  ignoreRef?: RefObject<HTMLElement | null>;
  getAnchorRect?: () => DOMRect | undefined;
  onQuery: (query: string) => void;
  onSelect: (skill: SkillItem) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(0);
  const [pointerIndex, setPointerIndex] = useState<number | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: STACKED_WIDTH, maxHeight: 224, ready: false });
  const [twoColumn, setTwoColumn] = useState(false);

  const matches = useMemo(
    () => skills.map((skill) => matchSkill(skill, query)).filter((item): item is Match => item != null),
    [query, skills],
  );
  // 「后发生的那一个覆盖」：鼠标刚划过去就听鼠标的，键盘一动就回到键盘那一项。
  const activeIndex = pointerIndex ?? keyboardIndex;
  const active = matches[activeIndex];

  const matchesRef = useRef(matches);
  const activeIndexRef = useRef(activeIndex);
  const onSelectRef = useRef(onSelect);
  const onCloseRef = useRef(onClose);
  const getAnchorRectRef = useRef(getAnchorRect);
  matchesRef.current = matches;
  activeIndexRef.current = activeIndex;
  onSelectRef.current = onSelect;
  onCloseRef.current = onClose;
  getAnchorRectRef.current = getAnchorRect;

  const pendingCloseRef = useRef(false);

  const pick = (skill: SkillItem, fromKeyboard = false) => {
    if (fromKeyboard) {
      pendingCloseRef.current = true;
      armEnterSuppress();
    } else {
      pendingCloseRef.current = false;
      releaseEnterSuppress();
      closeAtMenuLock();
      onCloseRef.current();
    }
    onSelectRef.current(skill);
  };

  const confirmHighlight = (event?: Event) => {
    if (pendingCloseRef.current) return;
    if (event && atMenuLock.lastEnter === event) return;
    if (event) atMenuLock.lastEnter = event;
    const chosen = matchesRef.current[activeIndexRef.current];
    if (!chosen) return;
    pick(chosen.skill, true);
  };

  if (open) atMenuLock.confirm = confirmHighlight;

  useEffect(() => {
    if (!open) return;
    setKeyboardIndex(0);
    setPointerIndex(null);
  }, [open]);

  // 每次关键词变化都把高亮落回第一项（与 @ 菜单同一套节奏）。
  useEffect(() => {
    setKeyboardIndex(0);
    setPointerIndex(null);
  }, [query]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-skill-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  useLayoutEffect(() => {
    if (!open) {
      setPos((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const update = () => {
      const menu = rootRef.current;
      if (!menu) return;
      const anchor = getAnchorRectRef.current?.();
      const fallback = new DOMRect(SAFE, window.innerHeight - 120, 0, 0);
      const vw = window.innerWidth;
      const columns = vw >= TWO_COLUMN_MIN_VIEWPORT;
      setTwoColumn(columns);
      const width = columns ? Math.min(SKILL_LIST_MIN_PX + SKILL_DETAIL_PX, vw - SAFE * 2) : STACKED_WIDTH;
      const next = placeMenu(
        anchor && (anchor.top || anchor.left) ? anchor : fallback,
        { width, height: menu.scrollHeight },
        vw,
        window.innerHeight,
      );
      setPos({ ...next, ready: true });
    };
    update();
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, query, skills]);

  useLayoutEffect(() => {
    if (!open) return;
    // 搜索框弹出即聚焦，和模型下拉的筛选框同一套手感。
    inputRef.current?.focus();
    inputRef.current?.select();
    openAtMenuLock();
    pendingCloseRef.current = false;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
      pendingCloseRef.current = false;
      releaseEnterSuppress();
      closeAtMenuLock();
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        pendingCloseRef.current = false;
        releaseEnterSuppress();
        closeAtMenuLock();
        onCloseRef.current();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const total = matchesRef.current.length;
        if (total === 0) return;
        setPointerIndex(null);
        setKeyboardIndex((index) => (event.key === "ArrowDown" ? (index + 1) % total : (index - 1 + total) % total));
        return;
      }
      if (isEnterKey(event)) {
        blockEnterEvent(event);
        confirmHighlight(event);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isEnterKey(event) || !pendingCloseRef.current) return;
      pendingCloseRef.current = false;
      releaseEnterSuppress();
      closeAtMenuLock();
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      if (!pendingCloseRef.current) {
        atMenuLock.confirm = null;
        if (!atMenuLock.suppressSubmit) closeAtMenuLock();
      }
    };
  }, [open, ignoreRef]);

  if (!open) return null;

  const list = (
    <div ref={listRef} data-skill-list="" className="min-h-0 flex-1 overflow-y-auto py-1">
      {matches.length === 0 ? (
        <p className="px-2.5 py-1.5 text-[12px] text-[var(--muted)]">{t(locale, "skillNoMatches")}</p>
      ) : (
        matches.map((match, index) => {
          const active = index === activeIndex;
          const Icon = SOURCE_ICON[match.skill.source] ?? Boxes;
          return (
            <RippleButton
              key={`${match.skill.source}-${match.skill.name}`}
              data-skill-index={index}
              title={match.skill.path}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => {
                setPointerIndex(index);
              }}
              onClick={() => pick(match.skill)}
              className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] ${
                active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)]"
              }`}
            >
              <Icon size={12} className="shrink-0 opacity-80" />
              <span data-skill-alias="" className="min-w-0 flex-1 truncate">
                <HighlightText text={match.skill.alias} ranges={match.ranges} />
              </span>
              <span
                data-skill-source=""
                className="shrink-0 rounded-[4px] bg-[var(--hover)] px-1 py-[1px] text-[10px] text-[var(--muted)]"
              >
                {t(locale, SOURCE_LABEL[match.skill.source] ?? "skillSourceAgents")}
              </span>
            </RippleButton>
          );
        })
      )}
    </div>
  );

  const detail = active ? (
    <div
      data-skill-detail=""
      className={twoColumn ? "min-h-0 overflow-y-auto" : "min-h-0 overflow-y-auto border-t border-[var(--line)]"}
      style={twoColumn ? undefined : { maxHeight: STACKED_DETAIL_MAX }}
    >
      <p className="text-[12px] text-[var(--text)]">{active.skill.alias}</p>
      {active.skill.alias !== active.skill.name ? (
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{`/${active.skill.name}`}</p>
      ) : null}
      <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">{t(locale, "skillPath")}</p>
      <p className="break-all text-[11px] text-[var(--muted)]">{active.skill.path}</p>
      {active.skill.description ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-[1.5] text-[var(--muted)]">
          {active.skill.description}
        </p>
      ) : null}
    </div>
  ) : null;

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      data-skill-menu=""
      className="fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-xl"
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, opacity: pos.ready ? 1 : 0 }}
    >
      {twoColumn ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{list}</div>
          {detail ? <div className="flex w-[240px] shrink-0 flex-col border-l border-[var(--line)] px-2.5 py-2">{detail}</div> : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {list}
          {detail ? <div className="shrink-0 px-2.5 py-2">{detail}</div> : null}
        </div>
      )}
      <div className="shrink-0 border-t border-[var(--line)] px-2 py-1.5">
        <input
          ref={inputRef}
          data-skill-search=""
          value={query}
          placeholder={t(locale, "skillFilter")}
          onChange={(event) => onQuery(event.target.value)}
          // 打字只筛列表：菜单里的搜索框不参与发送、也不换行。
          onKeyDown={(event) => {
            if (isEnterKey(event)) event.preventDefault();
          }}
          className="w-full bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
        />
      </div>
    </div>,
    document.body,
  );
}

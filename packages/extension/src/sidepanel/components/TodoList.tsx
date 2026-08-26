import { ChevronDown, ChevronRight, CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TodoItem } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { RippleButton } from "./RippleButton";

function planKey(todos: TodoItem[]): string {
  return todos.map((todo) => `${todo.id}\0${todo.content}`).join("|");
}

export function TodoList({ locale, todos }: { locale: Locale; todos: TodoItem[] }) {
  const [open, setOpen] = useState(true);
  const seen = useRef("");
  const key = planKey(todos);

  useEffect(() => {
    if (todos.length === 0) {
      seen.current = "";
      return;
    }
    if (key !== seen.current) {
      seen.current = key;
      setOpen(true);
    }
  }, [key, todos.length]);

  if (todos.length === 0) return null;

  const done = todos.filter((todo) => todo.status === "completed").length;
  const title = t(locale, "todoList").replace("{done}", String(done)).replace("{total}", String(todos.length));

  return (
    <section className="mb-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
      <RippleButton
        aria-expanded={open}
        aria-label={open ? t(locale, "collapseTodoList") : t(locale, "expandTodoList")}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0 truncate text-[12.5px] font-medium tracking-tight">{title}</span>
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-[var(--muted)]" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-[var(--muted)]" />
        )}
      </RippleButton>
      {open ? (
        <ol className="max-h-[9.5lh] space-y-1 overflow-y-auto border-t border-[var(--line)] px-3 py-2">
          {todos.map((todo) => {
            const completed = todo.status === "completed";
            const cancelled = todo.status === "cancelled";
            return (
              <li key={todo.id} className="flex items-start gap-2 text-[12px] leading-relaxed">
                <span
                  className={`min-w-0 flex-1 ${
                    completed || cancelled ? "text-[var(--muted)]" : "text-[var(--text)]"
                  } ${cancelled ? "line-through opacity-60" : ""}`}
                >
                  {todo.content}
                </span>
                {completed ? <CircleCheck size={14} className="mt-0.5 shrink-0 text-[var(--ok)]" /> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

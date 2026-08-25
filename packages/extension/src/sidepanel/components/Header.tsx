import { Globe, PlugZap, Unplug } from "lucide-react";
import type { CurrentPage } from "@shared";
import type { TodoItem } from "../chat-types";

export function Header({
  status,
  error,
  page,
  todos,
}: {
  status: "starting" | "ready" | "error";
  error?: string;
  page?: CurrentPage;
  todos: TodoItem[];
}) {
  const host = safeHost(page?.url);
  return (
    <header className="border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] px-3 py-2.5 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-[Fraunces,serif] text-[17px] leading-none tracking-tight">Cursor Sidebar</div>
          <div className="mt-1 text-[11px] tracking-wide text-[var(--muted)]">ONE SESSION · LOCAL AGENT</div>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-1 text-[11px]"
          title={error}
        >
          {status === "ready" ? (
            <PlugZap size={13} className="text-[var(--ok)]" />
          ) : (
            <Unplug size={13} className={status === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"} />
          )}
          <span className="text-[var(--muted)]">
            {status === "ready" ? "connected" : status === "starting" ? "starting" : "offline"}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5">
        <Globe size={13} className="shrink-0 text-[var(--brass)]" />
        <div className="min-w-0">
          <div className="truncate text-[12px]">{page?.title || "No page selected"}</div>
          <div className="truncate text-[11px] text-[var(--muted)]">{host || "Switch to a regular http(s) tab"}</div>
        </div>
      </div>

      {error && status === "error" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bad)]">{error}</p>
      ) : null}

      {todos.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 text-[11.5px] text-[var(--muted)]">
              <span className="mt-[2px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brass)]" />
              <span className={todo.status === "completed" ? "line-through opacity-60" : ""}>{todo.content}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </header>
  );
}

function safeHost(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

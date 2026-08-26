import { Paperclip, Pencil, Trash2 } from "lucide-react";
import type { QueuedMessage } from "../queued-message";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { displayMentionText } from "../mentions";
import { IconButton } from "./IconButton";

export function QueuedMessageList({
  locale,
  items,
  editingId,
  onEdit,
  onDelete,
}: {
  locale: Locale;
  items: QueuedMessage[];
  editingId?: string;
  onEdit: (item: QueuedMessage) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ol className="mb-2 max-h-[9.5lh] overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--panel-2)] py-0.5">
      {items.map((item) => {
        const preview =
          displayMentionText(item.text).replace(/\u200b/g, "").trim() || item.attachments[0]?.name || "";
        const editing = editingId === item.id;
        return (
          <li
            key={item.id}
            className={`flex items-center gap-1 px-2 py-1.5 ${
              editing ? "bg-[var(--hover-strong)]" : ""
            }`}
          >
            <p className="min-w-0 flex-1 truncate text-[12px] leading-snug text-[var(--text)]" title={preview}>
              {preview}
            </p>
            {item.attachments.length > 0 ? (
              <span className="flex shrink-0 items-center gap-0.5 text-[var(--muted)]" title={item.attachments.map((file) => file.name).join(", ")}>
                <Paperclip size={11} />
                {item.attachments.length > 1 ? (
                  <span className="text-[10px] tabular-nums">{item.attachments.length}</span>
                ) : null}
              </span>
            ) : null}
            <IconButton
              side="top"
              label={t(locale, "editQueuedMessage")}
              onClick={() => onEdit(item)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)]"
            >
              <Pencil size={12} />
            </IconButton>
            <IconButton
              side="top"
              label={t(locale, "removeQueuedMessage")}
              onClick={() => onDelete(item.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)]"
            >
              <Trash2 size={12} />
            </IconButton>
          </li>
        );
      })}
    </ol>
  );
}

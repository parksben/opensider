import type { FormField } from "@shared";
import { Eye, EyeOff, Hand, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { t, type Locale } from "../i18n";
import { RippleButton } from "./RippleButton";

/**
 * 两张「把活儿交回给人」的卡片，插在输入区上方（与 TodoList / ControlBanner 同一卡片族）：
 *
 *  - `TakeoverCard`：Agent 干不下去了（登录、验证码、必须本人确认），已经**先交还标签接管**
 *    再请用户接手；用户点「已完成，继续」才把它带回正轨。
 *  - `FormRequestCard`：账号 / 密码 / 验证码这类值不许经过 Agent——Agent 只给字段映射，
 *    用户在这里填，提交后由扩展直接写进页面。值只经过 `onSubmit` 一次，不落任何持久化。
 */

export type TakeoverCardData = {
  requestId: string;
  sessionId?: string;
  reason: string;
  resumeHint?: string;
};

const cardShell = "mb-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]";
const primaryButton =
  "flex shrink-0 items-center gap-1 rounded-md bg-[var(--brass)] px-2.5 py-1 text-[12px] text-[var(--on-brass)]";
const ghostButton =
  "shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[12px] hover:border-[var(--brass)]";
const disabledPrimary = "cursor-not-allowed opacity-50";

export function TakeoverCard({
  locale,
  data,
  onContinue,
  onLater,
}: {
  locale: Locale;
  data: TakeoverCardData;
  onContinue: () => void;
  onLater: () => void;
}) {
  return (
    <section className={cardShell} aria-live="polite">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <Hand size={14} className="mt-0.5 shrink-0 text-[var(--brass)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium tracking-tight">{t(locale, "takeoverTitle")}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
            {data.reason || t(locale, "takeoverReasonFallback")}
            {data.resumeHint ? <div className="mt-0.5 opacity-80">{data.resumeHint}</div> : null}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <RippleButton variant="primary" className={primaryButton} onClick={onContinue}>
              <ShieldCheck size={12} />
              {t(locale, "takeoverContinue")}
            </RippleButton>
            <RippleButton className={ghostButton} onClick={onLater}>
              {t(locale, "takeoverLater")}
            </RippleButton>
          </div>
        </div>
      </div>
    </section>
  );
}

export type FormRequestCardData = {
  requestId: string;
  sessionId?: string;
  title?: string;
  fields: FormField[];
};

export function FormRequestCard({
  locale,
  data,
  onCancel,
  onSubmit,
}: {
  locale: Locale;
  data: FormRequestCardData;
  onCancel: (requestId: string) => void;
  onSubmit: (requestId: string, values: Record<string, string>) => void;
}) {
  // 值只活在这个组件的 state 里：不写 storage、不进消息列表、不上报 Host。
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState<Record<string, boolean>>({});

  const submit = () => {
    const next: Record<string, string> = {};
    const touched: Record<string, boolean> = { ...seen };
    for (const field of data.fields) {
      const value = values[field.key] ?? "";
      if (value !== "") next[field.key] = value;
      if (value !== "" || seen[field.key]) touched[field.key] = true;
    }
    setSeen(touched);
    onSubmit(data.requestId, next);
  };

  const missingRequired = data.fields.some((field) => field.required && !(values[field.key] ?? "").trim());

  return (
    <section className={cardShell} aria-live="polite">
      <form
        className="flex flex-col gap-2 px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (missingRequired) return;
          submit();
        }}
      >
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--brass)]" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium tracking-tight">
              {data.title || t(locale, "formTitle")}
            </div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">
              {t(locale, "formHint")}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {data.fields.map((field) => {
            const secret = field.secret === true || field.type === "password";
            const shown = revealed[field.key] === true;
            return (
              <label key={field.key} className="flex flex-col gap-1 text-[11.5px] text-[var(--muted)]">
                <span className="flex items-center gap-1">
                  <span className="truncate text-[var(--text)]">{field.label}</span>
                  {field.required ? (
                    <span className="text-[10.5px] text-[var(--brass)]">{t(locale, "formRequired")}</span>
                  ) : null}
                </span>
                <span className="relative flex items-center">
                  <input
                    type={secret && !shown ? "password" : (field.type ?? "text")}
                    autoComplete="off"
                    placeholder={field.placeholder ?? ""}
                    value={values[field.key] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    className="h-8 w-full rounded-md border border-[var(--line)] bg-[var(--ink)] px-2.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--brass)]"
                  />
                  {secret ? (
                    <button
                      type="button"
                      className="absolute right-1 flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)]"
                      aria-label={shown ? "Hide" : "Show"}
                      onClick={() => setRevealed((current) => ({ ...current, [field.key]: !shown }))}
                    >
                      {shown ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  ) : null}
                </span>
                {field.note ? <span className="text-[11px] opacity-80">{field.note}</span> : null}
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <RippleButton
            variant="primary"
            type="submit"
            disabled={missingRequired}
            className={`${primaryButton} ${missingRequired ? disabledPrimary : ""}`}
          >
            {t(locale, "formSubmit")}
          </RippleButton>
          <RippleButton className={ghostButton} onClick={() => onCancel(data.requestId)}>
            {t(locale, "formCancel")}
          </RippleButton>
        </div>
      </form>
    </section>
  );
}

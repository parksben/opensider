import type { AgentInfo, AgentProgress } from "@shared";
import { LoaderCircle } from "lucide-react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { AgentMark } from "./AgentMark";
import { RippleButton } from "./RippleButton";

const PHASE_KEYS = {
  resolve: "progressResolve",
  spawn: "progressSpawn",
  handshake: "progressHandshake",
  auth: "progressAuth",
  session: "progressSession",
  models: "progressModels",
} as const;

export function AgentSetup({
  locale,
  agents,
  selectedId,
  connecting,
  progress,
  error,
  onSelect,
  onConfirm,
  onRetry,
}: {
  locale: Locale;
  agents: AgentInfo[];
  selectedId: string;
  connecting: boolean;
  progress?: AgentProgress;
  error?: string;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const selected = agents.find((item) => item.id === selectedId);
  const phaseKey = progress ? PHASE_KEYS[progress.phase as keyof typeof PHASE_KEYS] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto px-5 py-8">
      <div className="flex w-full max-w-[22rem] flex-col items-center gap-5">
        <div className="text-center">
          <h1 className="text-[16px] font-medium tracking-tight">{t(locale, "setupTitle")}</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{t(locale, "setupHint")}</p>
        </div>

        {connecting ? (
          <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-5">
            {selected ? <AgentMark mark={selected.mark} name={selected.name} size={40} /> : null}
            <p className="text-[13px] text-[var(--text)]">
              {t(locale, "setupConnecting").replace("{name}", selected?.name ?? selectedId)}
            </p>
            {progress ? (
              <div className="flex w-full flex-col gap-2">
                <div className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                  <div
                    className="h-full bg-[var(--brass)] transition-[width] duration-300"
                    style={{ width: `${Math.round((progress.index / progress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-center text-[11.5px] text-[var(--muted)]">
                  {progress.index}/{progress.total} · {phaseKey ? t(locale, phaseKey) : progress.label}
                </p>
              </div>
            ) : (
              <LoaderCircle size={16} className="animate-spin text-[var(--muted)]" />
            )}
          </div>
        ) : agents.length === 0 ? (
          <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-6 text-center">
            <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">{t(locale, "setupEmpty")}</p>
            <RippleButton
              onClick={onRetry}
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--hover)]"
            >
              {t(locale, "retry")}
            </RippleButton>
          </div>
        ) : (
          <div className="grid w-full grid-cols-3 gap-2">
            {agents.map((agent) => {
              const active = agent.id === selectedId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelect(agent.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center ${
                    active
                      ? "border-[var(--brass)] bg-[color-mix(in_oklab,var(--brass)_12%,var(--panel))]"
                      : "border-[var(--line)] bg-[var(--panel)] hover:bg-[var(--hover)]"
                  }`}
                >
                  <AgentMark mark={agent.mark} name={agent.name} size={36} />
                  <span className="w-full truncate text-[11.5px] font-medium">{agent.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {error ? <p className="w-full text-center text-[12px] leading-relaxed text-[var(--bad)]">{error}</p> : null}

        {!connecting && agents.length > 0 ? (
          <RippleButton
            disabled={!selectedId}
            onClick={onConfirm}
            className="w-full rounded-full bg-[var(--brass)] px-4 py-2 text-[13px] font-medium text-[var(--on-brass)] disabled:opacity-40"
          >
            {t(locale, "setupConfirm")}
          </RippleButton>
        ) : null}
      </div>
    </div>
  );
}

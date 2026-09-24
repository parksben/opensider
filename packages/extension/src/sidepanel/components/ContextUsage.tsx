import type { ContextUsage as Usage } from "@shared";
import { COMPOSER_ICON_PX } from "../layout";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { IconButton } from "./IconButton";

/** 1.2M / 514K / 900 — the shapes a token count actually takes. */
function short(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function money(cost: NonNullable<Usage["cost"]>): string {
  const amount = cost.amount < 1 ? cost.amount.toFixed(3) : cost.amount.toFixed(2);
  return cost.currency ? `${amount} ${cost.currency}` : `$${amount}`;
}

/**
 * How full the model's context window is, as a ring next to the model picker.
 *
 * The numbers come from the agent's own `usage_update`; nothing here is estimated. Agents
 * that never send it (Claude Code, Cursor) get no ring at all, the same rule the thought
 * level control follows — better absent than invented.
 *
 * Everything worth showing fits in the tooltip, so there is no click target.
 */
export function ContextUsage({ locale, usage }: { locale: Locale; usage?: Usage }) {
  if (!usage || usage.size <= 0) return null;

  const ratio = Math.min(1, Math.max(0, usage.used / usage.size));
  const percent = Math.round(ratio * 100);
  const size = COMPOSER_ICON_PX;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = ratio >= 0.9 ? "var(--bad)" : "var(--brass)";

  const tooltip = [
    t(locale, "contextUsed").replace("{percent}", String(percent)),
    t(locale, "contextTokens").replace("{used}", short(usage.used)).replace("{size}", short(usage.size)),
    usage.cost ? t(locale, "contextCost").replace("{cost}", money(usage.cost)) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <IconButton
      side="top"
      ripple={false}
      label={t(locale, "contextUsed").replace("{percent}", String(percent))}
      tooltip={tooltip}
      className="flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </IconButton>
  );
}

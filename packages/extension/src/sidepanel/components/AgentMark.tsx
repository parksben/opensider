import type { AgentMark as AgentMarkId } from "@shared";

const FILLS: Record<AgentMarkId, string> = {
  cursor: "#8b5cf6",
  opencode: "#f59e0b",
  copilot: "#24292f",
  codebuddy: "#07c160",
  claude: "#d97757",
  codex: "#10a37f",
  gemini: "#4285f4",
  qwen: "#615ced",
  kimi: "#1456f0",
  iflow: "#00b4d8",
  trae: "#111827",
  qoder: "#0ea5e9",
  generic: "#6b7280",
};

function glyph(mark: AgentMarkId, name: string): string {
  if (mark === "cursor") return "C";
  if (mark === "opencode") return "O";
  if (mark === "copilot") return "G";
  if (mark === "codebuddy") return "B";
  if (mark === "claude") return "A";
  if (mark === "codex") return "X";
  if (mark === "gemini") return "G";
  if (mark === "qwen") return "Q";
  if (mark === "kimi") return "K";
  if (mark === "iflow") return "i";
  if (mark === "trae") return "T";
  if (mark === "qoder") return "Q";
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

export function AgentMark({
  mark,
  name,
  size = 28,
}: {
  mark: AgentMarkId;
  name: string;
  size?: number;
}) {
  const fill = FILLS[mark] ?? FILLS.generic;
  const letter = glyph(mark, name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0 rounded-[8px]"
    >
      <rect width="32" height="32" rx="8" fill={fill} />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fill="#fff"
        fontSize="15"
        fontWeight="700"
        fontFamily="IBM Plex Sans, system-ui, sans-serif"
      >
        {letter}
      </text>
    </svg>
  );
}

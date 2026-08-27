import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentCaps, AgentMark, AgentPolicy } from "../../shared/src/protocol.ts";
import { defaultAgentPath } from "./paths.ts";

export type AuthKind = { type: "none" } | { type: "method"; methodId: string };

export type AgentProfile = {
  id: string;
  name: string;
  mark: AgentMark;
  launches: Array<{ command: string; args: string[] }>;
  env?: Record<string, string>;
  auth: AuthKind;
  modeMap: Record<AgentPolicy, string[]>;
  contextFiles: Array<"AGENTS.md" | "CLAUDE.md">;
  listModels?: "agent-models";
  vendorPrefixes: string[];
  caps: AgentCaps;
  loginHint: string;
};

const stdCaps = (over: Partial<AgentCaps> = {}): AgentCaps => ({
  models: true,
  questions: false,
  plans: false,
  todos: false,
  ...over,
});

export const PROFILES: AgentProfile[] = [
  {
    id: "cursor",
    name: "Cursor",
    mark: "cursor",
    launches: [
      { command: defaultAgentPath(), args: ["acp"] },
      { command: "agent", args: ["acp"] },
      { command: "cursor-agent", args: ["acp"] },
    ],
    auth: { type: "method", methodId: "cursor_login" },
    modeMap: { ask: ["agent"], workspace: ["agent"], auto: ["agent"] },
    contextFiles: ["AGENTS.md"],
    listModels: "agent-models",
    vendorPrefixes: ["cursor/"],
    caps: stdCaps({ questions: true, plans: true, todos: true }),
    loginHint: "Run `agent login` in a terminal, then retry.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    mark: "opencode",
    launches: [{ command: "opencode", args: ["acp"] }],
    auth: { type: "none" },
    modeMap: { ask: ["default", "ask"], workspace: ["acceptEdits"], auto: ["bypassPermissions", "auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Sign in with `opencode` or set OPENCODE_API_KEY, then retry.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    mark: "copilot",
    launches: [
      { command: "copilot", args: ["--acp", "--stdio"] },
      { command: "copilot", args: ["--acp"] },
    ],
    auth: { type: "none" },
    modeMap: {
      ask: ["https://agentclientprotocol.com/protocol/session-modes#agent", "default", "ask"],
      workspace: ["https://agentclientprotocol.com/protocol/session-modes#agent", "default"],
      auto: ["https://agentclientprotocol.com/protocol/session-modes#autopilot", "allow-all", "auto"],
    },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Run `copilot login` in a terminal, then retry.",
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    mark: "codebuddy",
    launches: [{ command: "codebuddy", args: ["--acp"] }],
    env: process.env.CODEBUDDY_INTERNET_ENVIRONMENT
      ? undefined
      : { CODEBUDDY_INTERNET_ENVIRONMENT: "internal" },
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: ["codebuddy.ai/", "_codebuddy.ai/"],
    caps: stdCaps(),
    loginHint: "Sign in with `codebuddy` or set CODEBUDDY_API_KEY, then retry.",
  },
  {
    id: "claude",
    name: "Claude Code",
    mark: "claude",
    launches: [
      { command: "claude-agent-acp", args: [] },
      { command: "claude-code-acp", args: [] },
      { command: join(homedir(), ".local", "bin", "claude-agent-acp"), args: [] },
    ],
    auth: { type: "none" },
    modeMap: {
      ask: ["default", "manual"],
      workspace: ["acceptEdits"],
      auto: ["bypassPermissions"],
    },
    contextFiles: ["AGENTS.md", "CLAUDE.md"],
    vendorPrefixes: ["_claude/"],
    caps: stdCaps({ todos: true }),
    loginHint: "Install Claude Code and `npm i -g @agentclientprotocol/claude-agent-acp`, then sign in.",
  },
  {
    id: "codex",
    name: "Codex",
    mark: "codex",
    launches: [
      { command: "codex-acp", args: [] },
      { command: join(homedir(), ".local", "bin", "codex-acp"), args: [] },
    ],
    auth: { type: "none" },
    modeMap: { ask: ["agent"], workspace: ["agent"], auto: ["agent-full-access"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps({ plans: true }),
    loginHint: "Install Codex CLI / `codex-acp` and sign in with ChatGPT or CODEX_API_KEY.",
  },
  {
    id: "gemini",
    name: "Gemini",
    mark: "gemini",
    launches: [
      { command: "gemini", args: ["--experimental-acp"] },
      { command: "gemini", args: ["--acp"] },
    ],
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Run `gemini` and complete login, then retry.",
  },
  {
    id: "qwen",
    name: "Qwen Code",
    mark: "qwen",
    launches: [{ command: "qwen", args: ["--acp"] }],
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Install Qwen Code (`qwen`) and sign in.",
  },
  {
    id: "kimi",
    name: "Kimi",
    mark: "kimi",
    launches: [{ command: "kimi", args: ["acp"] }],
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Install Kimi CLI (`kimi`) and sign in.",
  },
  {
    id: "iflow",
    name: "iFlow",
    mark: "iflow",
    launches: [{ command: "iflow", args: ["--experimental-acp"] }],
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Install iFlow CLI and sign in.",
  },
  {
    id: "trae",
    name: "Trae",
    mark: "trae",
    launches: [{ command: "traecli", args: ["acp", "serve"] }],
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Install Trae CLI (`traecli`) and sign in.",
  },
  {
    id: "qoder",
    name: "Qoder",
    mark: "qoder",
    launches: [{ command: "qodercli", args: ["--acp"] }],
    auth: { type: "none" },
    modeMap: { ask: ["default"], workspace: ["default"], auto: ["auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: "Install Qoder CLI (`qodercli`) and sign in.",
  },
];

export function profileById(id: string): AgentProfile | undefined {
  return PROFILES.find((item) => item.id === id);
}

export function genericProfile(id: string, name: string, command: string, args: string[]): AgentProfile {
  return {
    id,
    name,
    mark: "generic",
    launches: [{ command, args }],
    auth: { type: "none" },
    modeMap: { ask: ["default", "ask", "agent"], workspace: ["acceptEdits", "agent"], auto: ["bypassPermissions", "agent-full-access", "auto"] },
    contextFiles: ["AGENTS.md"],
    vendorPrefixes: [],
    caps: stdCaps(),
    loginHint: `Sign in with \`${command}\`, then retry.`,
  };
}

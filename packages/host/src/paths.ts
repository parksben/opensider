import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const nextHome = join(homedir(), ".opensider");
const previousHome = join(homedir(), ".cursor-sidebar");
if (!existsSync(nextHome) && existsSync(previousHome)) {
  try {
    renameSync(previousHome, nextHome);
  } catch {
    // keep going with the new path
  }
}

export const SIDEBAR_HOME = nextHome;
export const WORKSPACE_DIR = join(SIDEBAR_HOME, "workspace");
export const BROWSER_DIR = join(WORKSPACE_DIR, "browser");
export const COMMANDS_DIR = join(BROWSER_DIR, "commands");
export const RESULTS_DIR = join(BROWSER_DIR, "results");
export const SCREENSHOTS_DIR = join(BROWSER_DIR, "screenshots");
export const PASTED_DIR = join(BROWSER_DIR, "pasted");
export const TOOLS_PATH = join(BROWSER_DIR, "tools.json");
export const CURRENT_PAGE_PATH = join(BROWSER_DIR, "current.json");
export const TABS_PATH = join(BROWSER_DIR, "tabs.json");
export const SNAPSHOT_PATH = join(BROWSER_DIR, "snapshot.md");
export const AGENTS_MD_PATH = join(WORKSPACE_DIR, "AGENTS.md");
export const CLAUDE_MD_PATH = join(WORKSPACE_DIR, "CLAUDE.md");
export const SESSION_PATH = join(SIDEBAR_HOME, "session.json");
export const HOST_LOG_PATH = join(SIDEBAR_HOME, "host.log");

export function defaultAgentPath(): string {
  return process.env.CURSOR_AGENT_PATH || join(homedir(), ".local", "bin", "agent");
}

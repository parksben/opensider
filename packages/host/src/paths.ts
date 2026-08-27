import { existsSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

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

function considerDir(dirs: string[], dir: string): void {
  if (!dir || dirs.includes(dir) || !existsSync(dir)) return;
  dirs.push(dir);
}

function versionManagerBins(): string[] {
  const home = homedir();
  const dirs: string[] = [];
  considerDir(dirs, join(home, ".local", "bin"));
  considerDir(dirs, join(home, ".npm-global", "bin"));
  considerDir(dirs, join(home, ".bun", "bin"));
  considerDir(dirs, join(home, ".volta", "bin"));
  considerDir(dirs, join(home, ".asdf", "shims"));
  considerDir(dirs, join(home, ".cargo", "bin"));
  considerDir(dirs, join(home, "Library", "pnpm"));
  considerDir(dirs, join(home, ".opensider", "runtime", "bin"));
  considerDir(dirs, "/opt/homebrew/bin");
  considerDir(dirs, "/usr/local/bin");
  considerDir(dirs, "/usr/bin");

  const nvmRoot = process.env.NVM_DIR || join(home, ".nvm");
  considerDir(dirs, join(nvmRoot, "current", "bin"));
  const nvmVersions = join(nvmRoot, "versions", "node");
  if (existsSync(nvmVersions)) {
    try {
      for (const name of readdirSync(nvmVersions).sort().reverse()) {
        considerDir(dirs, join(nvmVersions, name, "bin"));
      }
    } catch {
      // ignore
    }
  }

  const fnmHome = process.env.FNM_DIR || join(home, ".fnm");
  considerDir(dirs, join(fnmHome, "current", "bin"));
  const fnmVersions = join(home, "Library", "Application Support", "fnm", "node-versions");
  if (existsSync(fnmVersions)) {
    try {
      for (const name of readdirSync(fnmVersions).sort().reverse()) {
        considerDir(dirs, join(fnmVersions, name, "installation", "bin"));
      }
    } catch {
      // ignore
    }
  }

  return dirs;
}

export function agentSearchDirs(): string[] {
  const fromEnv = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return [...new Set([...versionManagerBins(), ...fromEnv])];
}

export function agentPathEnv(command?: string): string {
  const dirs = agentSearchDirs();
  if (command) {
    const dir = dirname(command);
    if (dir && dir !== ".") dirs.unshift(dir);
  }
  return [...new Set(dirs)].join(delimiter);
}

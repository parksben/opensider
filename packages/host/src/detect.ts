import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { AgentInfo } from "../../shared/src/protocol.ts";
import { log } from "./log.ts";
import { genericProfile, PROFILES, type AgentProfile } from "./profiles.ts";

export type ResolvedAgent = {
  profile: AgentProfile;
  command: string;
  args: string[];
};

const SEARCH_DIRS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".opensider", "runtime", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];

function searchPath(): string[] {
  const fromEnv = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return [...new Set([...SEARCH_DIRS, ...fromEnv])];
}

export function resolveOnPath(command: string): string | undefined {
  if (!command) return undefined;
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return undefined;
    }
  }
  for (const dir of searchPath()) {
    const full = join(dir, command);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      // next
    }
  }
  return undefined;
}

function writeNdjson(child: { stdin: NodeJS.WritableStream }, msg: unknown): void {
  child.stdin.write(`${JSON.stringify(msg)}\n`);
}

export function probeAcp(command: string, args: string[], timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: process.env.HOME ?? homedir(),
        PATH: `${searchPath().join(delimiter)}:${process.env.PATH ?? ""}`,
      },
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      finish(false);
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      const line = buf.split("\n").find((item) => item.trim());
      if (!line) return;
      try {
        const msg = JSON.parse(line) as { result?: { protocolVersion?: unknown }; method?: string };
        if (msg.result && "protocolVersion" in (msg.result as object)) {
          clearTimeout(timer);
          finish(true);
        }
      } catch {
        // keep reading
      }
    });
    try {
      writeNdjson(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "opensider", version: "0.1.0" },
        },
      });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

async function resolveLaunch(profile: AgentProfile): Promise<ResolvedAgent | undefined> {
  for (const launch of profile.launches) {
    const command = resolveOnPath(launch.command);
    if (!command) continue;
    if (await probeAcp(command, launch.args)) {
      return { profile, command, args: launch.args };
    }
  }
  return undefined;
}

type RegistryAgent = {
  name?: string;
  title?: string;
  command?: string;
  args?: string[];
};

async function registryExtras(): Promise<AgentProfile[]> {
  try {
    const res = await fetch("https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json", {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { agents?: RegistryAgent[] } | RegistryAgent[];
    const list = Array.isArray(data) ? data : (data.agents ?? []);
    const known = new Set(PROFILES.flatMap((item) => item.launches.map((launch) => launch.command)));
    const extras: AgentProfile[] = [];
    for (const item of list) {
      const command = item.command?.trim();
      if (!command || known.has(command)) continue;
      const id = command.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      extras.push(genericProfile(id, item.title || item.name || command, command, item.args ?? ["acp"]));
      known.add(command);
    }
    return extras;
  } catch (error) {
    log(`acp registry skipped: ${String(error)}`);
    return [];
  }
}

export async function detectAgents(): Promise<{ infos: AgentInfo[]; resolved: ResolvedAgent[] }> {
  const extras = await registryExtras();
  const catalog = [...PROFILES, ...extras];
  const resolved: ResolvedAgent[] = [];
  for (const profile of catalog) {
    const hit = await resolveLaunch(profile);
    if (hit) resolved.push(hit);
  }
  const infos = resolved.map((item) => ({
    id: item.profile.id,
    name: item.profile.name,
    mark: item.profile.mark,
    command: [item.command, ...item.args].join(" "),
    installed: true,
    hint: item.profile.loginHint,
    caps: item.profile.caps,
  }));
  return { infos, resolved };
}

const resolvedCache = new Map<string, ResolvedAgent>();

export function rememberResolved(item: ResolvedAgent): void {
  resolvedCache.set(item.profile.id, item);
}

export function cachedResolved(id: string): ResolvedAgent | undefined {
  return resolvedCache.get(id);
}

export async function resolveProfile(id: string): Promise<ResolvedAgent | undefined> {
  const cached = resolvedCache.get(id);
  if (cached) return cached;
  const profile = PROFILES.find((item) => item.id === id) ?? genericProfile(id, id, id, ["acp"]);
  const hit = await resolveLaunch(profile);
  if (hit) rememberResolved(hit);
  return hit;
}

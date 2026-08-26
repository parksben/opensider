import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { log } from "./log.ts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type SessionOpen = {
  sessionId: string;
  replay: boolean;
  created: boolean;
  forked: boolean;
  configOptions?: unknown;
};

export type AcpHandlers = {
  onUpdate: (update: Record<string, unknown>, sessionId?: string) => void;
  onPermission: (id: number, params: Record<string, unknown>, sessionId?: string) => void;
  onCursor: (id: number | undefined, method: string, params: Record<string, unknown>, sessionId?: string) => void;
};

export class AcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private sessionId: string | undefined;
  private readonly agentPath: string;
  private readonly cwd: string;
  private readonly handlers: AcpHandlers;

  constructor(agentPath: string, cwd: string, handlers: AcpHandlers) {
    this.agentPath = agentPath;
    this.cwd = cwd;
    this.handlers = handlers;
  }

  start(): void {
    if (!existsSync(this.agentPath)) {
      throw new Error(`Cursor CLI not found at ${this.agentPath}. Install it and run \`agent login\`.`);
    }

    const path = `${homedir()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}`;
    this.child = spawn(this.agentPath, ["acp"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: process.env.HOME ?? homedir(),
        PATH: path,
      },
    });

    this.child.on("exit", (code, signal) => {
      log(`agent exited code=${code} signal=${signal}`);
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error("agent process exited"));
      }
      this.pending.clear();
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      log(`agent stderr: ${chunk.toString("utf8").trim()}`);
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        log(`unparsable agent line: ${line.slice(0, 200)}`);
        return;
      }
      this.handleMessage(msg);
    });
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        session: { configOptions: { boolean: {} } },
        _meta: { parameterizedModelPicker: true },
      },
      clientInfo: { name: "opensider", version: "0.1.0" },
    });
    await this.request("authenticate", { methodId: "cursor_login" });
  }

  async createSession(): Promise<SessionOpen> {
    const result = (await this.request("session/new", {
      cwd: this.cwd,
      mcpServers: [],
    })) as { sessionId: string; configOptions?: unknown };
    this.sessionId = result.sessionId;
    await this.trySetAgentMode(result.sessionId);
    return {
      sessionId: result.sessionId,
      replay: false,
      created: true,
      forked: false,
      configOptions: result.configOptions,
    };
  }

  async openSession(existingId?: string): Promise<SessionOpen> {
    if (existingId) {
      const loaded = await this.useSession(existingId);
      if (!loaded.created) return loaded;
    }
    return this.createSession();
  }

  async useSession(existingId: string): Promise<SessionOpen> {
    if (this.sessionId === existingId) {
      return { sessionId: existingId, replay: true, created: false, forked: false };
    }
    try {
      const result = (await this.request("session/load", {
        sessionId: existingId,
        cwd: this.cwd,
        mcpServers: [],
      })) as { sessionId?: string; configOptions?: unknown };
      this.sessionId = existingId;
      await this.trySetAgentMode(existingId);
      return {
        sessionId: existingId,
        replay: true,
        created: false,
        forked: false,
        configOptions: result.configOptions,
      };
    } catch (error) {
      log(`session/load failed, creating new: ${String(error)}`);
      return this.createSession();
    }
  }

  async forkSession(existingId: string): Promise<SessionOpen> {
    try {
      const result = (await this.request("session/fork", {
        sessionId: existingId,
        cwd: this.cwd,
        mcpServers: [],
      })) as { sessionId: string; configOptions?: unknown };
      this.sessionId = result.sessionId;
      await this.trySetAgentMode(result.sessionId);
      return {
        sessionId: result.sessionId,
        replay: false,
        created: true,
        forked: true,
        configOptions: result.configOptions,
      };
    } catch (error) {
      log(`session/fork failed, creating new: ${String(error)}`);
      return this.createSession();
    }
  }

  async setModel(modelId: string, configId = "model"): Promise<unknown> {
    if (!this.sessionId) throw new Error("no session");
    try {
      return await this.request("session/set_config_option", {
        sessionId: this.sessionId,
        configId,
        value: modelId,
      });
    } catch (error) {
      log(`session/set_config_option failed, trying session/set_model: ${String(error)}`);
      return this.request("session/set_model", {
        sessionId: this.sessionId,
        modelId,
      });
    }
  }

  async prompt(text: string): Promise<{ stopReason: string }> {
    if (!this.sessionId) throw new Error("no session");
    const result = (await this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    })) as { stopReason?: string };
    return { stopReason: result.stopReason ?? "end_turn" };
  }

  cancel(): void {
    if (!this.sessionId || !this.child) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  respond(id: number, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  stop(): void {
    this.child?.stdin.end();
    this.child?.kill();
  }

  private async trySetAgentMode(sessionId: string): Promise<void> {
    try {
      await this.request("session/set_mode", { sessionId, modeId: "agent" });
    } catch (error) {
      log(`session/set_mode skipped: ${String(error)}`);
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const id = msg.id;
    if (id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const waiter = this.pending.get(Number(id));
      if (!waiter) return;
      this.pending.delete(Number(id));
      if (msg.error) {
        waiter.reject(new Error(JSON.stringify(msg.error)));
      } else {
        waiter.resolve(msg.result);
      }
      return;
    }

    const method = String(msg.method ?? "");
    const params = (msg.params ?? {}) as Record<string, unknown>;
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : this.sessionId;

    if (method === "session/update") {
      const update = (params.update ?? params) as Record<string, unknown>;
      this.handlers.onUpdate(update, sessionId);
      return;
    }

    if (method === "session/request_permission" && id !== undefined) {
      this.handlers.onPermission(Number(id), params, sessionId);
      return;
    }

    if (method.startsWith("cursor/")) {
      this.handlers.onCursor(id === undefined ? undefined : Number(id), method, params, sessionId);
      return;
    }

    if (id !== undefined) {
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unsupported method ${method}` },
      });
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.write({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(msg: unknown): void {
    if (!this.child) throw new Error("agent is not running");
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }
}

import type { AgentPolicy, ExtToHost, HostToExt } from "../../shared/src/protocol.ts";
import { AcpClient, type SessionOpen } from "./acp.ts";
import { cachedResolved, detectAgents, rememberResolved, resolveProfile, type ResolvedAgent } from "./detect.ts";
import { log } from "./log.ts";
import {
  catalogFromConfigOptions,
  catalogFromSessionModels,
  copilotFallbackCatalog,
  isUnsetModel,
  listAgentModels,
  mergeCatalog,
  type ConfigOption,
  type ModelCatalog,
} from "./models.ts";
import { createNativeIo } from "./native.ts";
import { pickLocalPaths } from "./pick.ts";
import { savePastedJpeg } from "./save.ts";
import { watchCommands, writeCommandResult } from "./watch.ts";
import { ensureWorkspace, WORKSPACE_DIR, writeCurrentPage, writeSessionId, writeTabsSnapshot } from "./workspace.ts";

log("node host starting");
ensureWorkspace();

type AcpRuntime = {
  client: AcpClient;
  prompting: boolean;
  binding: boolean;
};

const runtimes: AcpRuntime[] = [];
const rpcClients = new Map<number, AcpClient>();
let bindTail = Promise.resolve();
let catalog: ModelCatalog = {
  models: [],
  currentId: "",
  modelConfigId: "model",
};
let pendingModelId: string | undefined;
let currentAgent: ResolvedAgent | undefined;
let currentPolicy: AgentPolicy = "ask";
let lastAgents: Awaited<ReturnType<typeof detectAgents>>["infos"] = [];
let hostState: "starting" | "idle" | "connecting" | "ready" | "error" = "starting";

const native = createNativeIo((raw) => {
  const msg = raw as ExtToHost;
  void handleExt(msg);
});

function send(msg: HostToExt): void {
  native.send(msg);
}

function sendModels(): void {
  send({ type: "models", models: catalog.models, currentId: catalog.currentId });
}

function setHostState(state: typeof hostState, error?: string): void {
  hostState = state;
  send({ type: "status", state, error });
}

function sendAgents(): void {
  send({ type: "agents", agents: lastAgents, selectedId: currentAgent?.profile.id });
}

function sendProgress(index: number, total: number, phase: string, label: string): void {
  send({ type: "agent.progress", progress: { phase, index, total, label } });
}

function sendHello(): void {
  send({
    type: "hello",
    workspace: WORKSPACE_DIR,
    agentPath: currentAgent?.command ?? "",
    providerId: currentAgent?.profile.id,
  });
}

async function scanAgents(): Promise<void> {
  const { infos, resolved } = await detectAgents();
  lastAgents = infos;
  for (const item of resolved) rememberResolved(item);
  sendAgents();
}

function stopRuntimes(): void {
  for (const runtime of runtimes) {
    try {
      runtime.client.stop();
    } catch {
      // ignore
    }
  }
  runtimes.length = 0;
  rpcClients.clear();
}

async function connectAgent(providerId: string, policy?: AgentPolicy): Promise<void> {
  setHostState("connecting");
  if (policy) currentPolicy = policy;
  sendProgress(1, 6, "resolve", "Resolving CLI");
  const resolved = cachedResolved(providerId) ?? (await resolveProfile(providerId));
  if (!resolved) {
    throw new Error(`Could not find an ACP CLI for ${providerId}.`);
  }
  currentAgent = resolved;
  rememberResolved(resolved);

  sendProgress(2, 6, "spawn", "Starting process");
  stopRuntimes();
  catalog = { models: [], currentId: "", modelConfigId: "model" };
  sendModels();
  const runtime: AcpRuntime = { client: undefined as unknown as AcpClient, prompting: false, binding: false };
  attachClient(runtime);
  runtime.client.start();

  sendProgress(3, 6, "handshake", "ACP handshake");
  sendProgress(4, 6, "auth", "Signing in");
  await runtime.client.initialize();
  runtimes.push(runtime);
  log(`acp runtime ready provider=${resolved.profile.id} count=${runtimes.length}`);

  sendProgress(5, 6, "session", "Ready for sessions");
  sendProgress(6, 6, "models", "Loading models");
  await refreshModels();
  applyFallbackModels();
  sendModels();
  sendAgents();
  sendHello();
  setHostState("ready");
}

async function refreshModels(): Promise<void> {
  if (currentAgent?.profile.listModels !== "agent-models") return;
  try {
    catalog = mergeCatalog(catalog, await listAgentModels(currentAgent.command));
  } catch (error) {
    log(`list models failed: ${String(error)}`);
  }
}

function absorbConfigUpdate(update: Record<string, unknown>): void {
  catalog = mergeCatalog(catalog, catalogFromConfigOptions(update.configOptions as ConfigOption[] | undefined));
  catalog = mergeCatalog(catalog, catalogFromSessionModels(update.models));
  sendModels();
}

function absorbSessionOptions(opened: SessionOpen): void {
  const options = opened.configOptions as ConfigOption[] | undefined;
  catalog = mergeCatalog(catalog, catalogFromConfigOptions(options));
  catalog = mergeCatalog(catalog, catalogFromSessionModels(opened.models));
  applyFallbackModels();
  if (catalog.models.length > 0) {
    log(`models ${catalog.models.length} current=${catalog.currentId}`);
  } else {
    const ids = (options ?? []).map((option) => option.id || (option as { configId?: string }).configId);
    log(`models empty options=${ids.join(",") || "none"}`);
  }
}

function applyFallbackModels(): void {
  if (catalog.models.length > 0) return;
  if (currentAgent?.profile.id !== "copilot") return;
  catalog = mergeCatalog(catalog, copilotFallbackCatalog());
  log(`models fallback copilot ${catalog.models.length}`);
}

function hostErrorText(error: unknown): string {
  const text = String(error);
  if (/EACCES:.*\/\.gemini\b/.test(text)) {
    return 'Gemini CLI cannot write ~/.gemini (directory is owned by root). Run: sudo chown -R "$(whoami)" ~/.gemini';
  }
  return text;
}

function enqueueSessionOp<T>(work: () => Promise<T>): Promise<T> {
  const run = bindTail.then(work, work);
  bindTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function attachClient(runtime: AcpRuntime): void {
  if (!currentAgent) throw new Error("no agent selected");
  const client = new AcpClient(
    {
      command: currentAgent.command,
      args: currentAgent.args,
      cwd: WORKSPACE_DIR,
      env: currentAgent.profile.env,
      auth: currentAgent.profile.auth,
      profile: currentAgent.profile,
    },
    {
    onUpdate: (update, sessionId) => {
      if (runtime.binding && !runtime.prompting) {
        if (update.sessionUpdate === "config_option_update") {
          absorbConfigUpdate(update);
        }
        return;
      }
      const sid = sessionId ?? client.getSessionId();
      if (update.sessionUpdate === "config_option_update") {
        absorbConfigUpdate(update);
      }
      send({ type: "update", update, sessionId: sid });
    },
    onPermission: (id, params, sessionId) => {
      if (runtime.binding && !runtime.prompting) return;
      rpcClients.set(id, client);
      send({ type: "permission", id, params, sessionId: sessionId ?? client.getSessionId() });
    },
    onCursor: (id, method, params, sessionId) => {
      if (runtime.binding && !runtime.prompting) return;
      if (id !== undefined) rpcClients.set(id, client);
      send({ type: "cursor", id, method, params, sessionId: sessionId ?? client.getSessionId() });
    },
    },
  );
  runtime.client = client;
  runtime.client.setPolicy(currentPolicy);
}

async function spawnRuntime(): Promise<AcpRuntime> {
  const runtime: AcpRuntime = { client: undefined as unknown as AcpClient, prompting: false, binding: false };
  attachClient(runtime);
  runtime.client.start();
  await runtime.client.initialize();
  runtimes.push(runtime);
  log(`acp runtime ready count=${runtimes.length}`);
  return runtime;
}

async function withBinding<T>(runtime: AcpRuntime, work: () => Promise<T>): Promise<T> {
  runtime.binding = true;
  try {
    return await work();
  } finally {
    runtime.binding = false;
  }
}

function runtimeBySession(sessionId: string | undefined): AcpRuntime | undefined {
  if (!sessionId) return undefined;
  return runtimes.find((runtime) => runtime.client.getSessionId() === sessionId);
}

async function acquireRuntime(preferSessionId?: string): Promise<AcpRuntime> {
  const owned = runtimeBySession(preferSessionId);
  if (owned && !owned.prompting) return owned;
  const idle = runtimes.find((runtime) => !runtime.prompting);
  if (idle) return idle;
  return spawnRuntime();
}

async function openAndAnnounce(runtime: AcpRuntime, open: () => Promise<SessionOpen>): Promise<SessionOpen> {
  const opened = await withBinding(runtime, open);
  writeSessionId(opened.sessionId);
  absorbSessionOptions(opened);
  if (catalog.models.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    applyFallbackModels();
  }
  await applyPendingModel(runtime);
  send({
    type: "session",
    sessionId: opened.sessionId,
    replay: opened.replay,
    created: opened.created,
    forked: opened.forked,
  });
  sendModels();
  return opened;
}

async function applyPendingModel(runtime: AcpRuntime): Promise<void> {
  if (!pendingModelId || isUnsetModel(pendingModelId) || !runtime.client.getSessionId()) return;
  if (runtime.prompting) return;
  try {
    await applyModel(runtime, pendingModelId);
  } catch (error) {
    log(`apply model skipped: ${String(error)}`);
  }
}

async function applyModel(runtime: AcpRuntime, modelId: string): Promise<void> {
  if (isUnsetModel(modelId)) {
    catalog = { ...catalog, currentId: modelId };
    return;
  }
  const result = await runtime.client.setModel(modelId, catalog.modelConfigId);
  const options = (result as { configOptions?: ConfigOption[] } | undefined)?.configOptions;
  catalog = mergeCatalog(catalog, {
    ...catalogFromConfigOptions(options),
    currentId: modelId,
  });
}

function replyClient(id: number): AcpClient | undefined {
  return rpcClients.get(id) ?? runtimes[0]?.client;
}

async function handleExt(msg: ExtToHost): Promise<void> {
  try {
    if (msg.type === "hello") {
      sendHello();
      if (lastAgents.length > 0) sendAgents();
      send({ type: "status", state: hostState === "starting" ? "idle" : hostState });
      return;
    }
    if (msg.type === "agents.detect") {
      await scanAgents();
      return;
    }
    if (msg.type === "agent.connect") {
      await connectAgent(msg.providerId, msg.policy);
      return;
    }
    if (msg.type === "agent.setPolicy") {
      currentPolicy = msg.policy;
      for (const runtime of runtimes) runtime.client.setPolicy(msg.policy);
      return;
    }
    if (msg.type === "page.pick" || msg.type === "page.pick.cancel") {
      return;
    }
    if (msg.type === "page.update") {
      writeCurrentPage(msg.page);
      send({ type: "page", page: msg.page });
      return;
    }
    if (msg.type === "tabs.update") {
      writeTabsSnapshot(msg.snapshot);
      return;
    }
    if (msg.type === "browser.result") {
      await writeCommandResult(msg.result);
      return;
    }
    if (msg.type === "session.new") {
      if (runtimes.length === 0) throw new Error("agent is not ready");
      await enqueueSessionOp(async () => {
        const runtime = await acquireRuntime();
        await openAndAnnounce(runtime, () => runtime.client.createSession());
      });
      return;
    }
    if (msg.type === "session.use") {
      if (runtimes.length === 0) throw new Error("agent is not ready");
      await enqueueSessionOp(async () => {
        const running = runtimeBySession(msg.sessionId);
        if (running?.prompting) {
          send({ type: "session", sessionId: msg.sessionId, replay: true });
          return;
        }
        const runtime = await acquireRuntime(msg.sessionId);
        await openAndAnnounce(runtime, () => runtime.client.useSession(msg.sessionId));
      });
      return;
    }
    if (msg.type === "session.fork") {
      if (runtimes.length === 0) throw new Error("agent is not ready");
      await enqueueSessionOp(async () => {
        const runtime = await acquireRuntime();
        await openAndAnnounce(runtime, () => runtime.client.forkSession(msg.sessionId));
      });
      return;
    }
    if (msg.type === "fs.pick") {
      try {
        log("opening file picker");
        const picked = await pickLocalPaths();
        send({
          type: "fs.picked",
          requestId: msg.requestId,
          items: picked.items,
          cancelled: picked.cancelled,
        });
      } catch (error) {
        send({
          type: "fs.picked",
          requestId: msg.requestId,
          items: [],
          error: String(error),
        });
      }
      return;
    }
    if (msg.type === "fs.save") {
      try {
        const item = savePastedJpeg(msg.imageBase64, msg.name);
        log(`saved paste ${item.path}`);
        send({ type: "fs.saved", requestId: msg.requestId, items: [item] });
      } catch (error) {
        send({
          type: "fs.saved",
          requestId: msg.requestId,
          items: [],
          error: String(error),
        });
      }
      return;
    }
    if (msg.type === "model.set") {
      pendingModelId = msg.modelId;
      catalog = { ...catalog, currentId: msg.modelId };
      const runtime = runtimeBySession(msg.sessionId) ?? runtimes.find((item) => !item.prompting && item.client.getSessionId());
      if (!runtime?.client.getSessionId() || isUnsetModel(msg.modelId)) {
        sendModels();
        return;
      }
      if (runtime.prompting) {
        sendModels();
        return;
      }
      if (msg.sessionId && runtime.client.getSessionId() !== msg.sessionId) {
        await withBinding(runtime, () => runtime.client.useSession(msg.sessionId));
      }
      try {
        await applyModel(runtime, msg.modelId);
      } catch (error) {
        log(`apply model skipped: ${String(error)}`);
      }
      sendModels();
      return;
    }
    if (msg.type === "prompt") {
      if (runtimes.length === 0) throw new Error("agent is not ready");
      const runtime = await enqueueSessionOp(async () => {
        if (msg.sessionId) {
          const owned = runtimeBySession(msg.sessionId);
          if (owned?.prompting) {
            log(`prompt ignored, session already running ${msg.sessionId}`);
            return undefined;
          }
          const next = owned ?? (await acquireRuntime(msg.sessionId));
          if (next.client.getSessionId() !== msg.sessionId) {
            const opened = await withBinding(next, () => next.client.useSession(msg.sessionId));
            writeSessionId(opened.sessionId);
            if (opened.created) {
              send({
                type: "session",
                sessionId: opened.sessionId,
                replay: opened.replay,
                created: opened.created,
                forked: opened.forked,
              });
            }
          }
          next.prompting = true;
          return next;
        }
        const next = await acquireRuntime();
        const opened = await withBinding(next, () => next.client.createSession());
        writeSessionId(opened.sessionId);
        absorbSessionOptions(opened);
        send({
          type: "session",
          sessionId: opened.sessionId,
          replay: opened.replay,
          created: opened.created,
          forked: opened.forked,
        });
        sendModels();
        next.prompting = true;
        return next;
      });
      if (!runtime) return;
      const prefix = msg.currentPage
        ? `[Current tab] ${msg.currentPage.title} — ${msg.currentPage.url}\n\n`
        : "";
      try {
        const result = await runtime.client.prompt(`${prefix}${msg.text}`);
        send({
          type: "turn.end",
          stopReason: result.stopReason,
          sessionId: runtime.client.getSessionId(),
        });
      } finally {
        runtime.prompting = false;
      }
      return;
    }
    if (msg.type === "cancel") {
      const runtime = runtimeBySession(msg.sessionId) ?? runtimes.find((item) => item.prompting);
      runtime?.client.cancel();
      return;
    }
    if (msg.type === "permission.reply") {
      replyClient(msg.id)?.respond(msg.id, { outcome: msg.outcome });
      rpcClients.delete(msg.id);
      return;
    }
    if (msg.type === "cursor.reply") {
      replyClient(msg.id)?.respond(msg.id, msg.result);
      rpcClients.delete(msg.id);
    }
  } catch (error) {
    log(`handle ext error: ${hostErrorText(error)}`);
    if (msg.type === "prompt") {
      send({ type: "turn.end", stopReason: "error", sessionId: msg.sessionId });
      return;
    }
    setHostState("error", hostErrorText(error));
  }
}

async function main(): Promise<void> {
  setHostState("starting");
  try {
    await scanAgents();
    setHostState("idle");
    log(`idle agents=${lastAgents.map((item) => item.id).join(",") || "none"}`);
  } catch (error) {
    log(`detect failed: ${String(error)}`);
    setHostState("error", String(error));
  }

  watchCommands((command) => {
    send({ type: "browser.command", command });
  });
}

process.stdin.on("end", () => {
  for (const runtime of runtimes) runtime.client.stop();
  process.exit(0);
});

void main();

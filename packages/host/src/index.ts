import type { ExtToHost, HostToExt } from "../../shared/src/protocol.ts";
import { AcpClient, type SessionOpen } from "./acp.ts";
import { log } from "./log.ts";
import {
  catalogFromConfigOptions,
  isUnsetModel,
  listAgentModels,
  mergeCatalog,
  type ConfigOption,
  type ModelCatalog,
} from "./models.ts";
import { createNativeIo } from "./native.ts";
import { defaultAgentPath } from "./paths.ts";
import { pickLocalPaths } from "./pick.ts";
import { savePastedJpeg } from "./save.ts";
import { watchCommands, writeCommandResult } from "./watch.ts";
import { ensureWorkspace, readSessionId, WORKSPACE_DIR, writeCurrentPage, writeSessionId, writeTabsSnapshot } from "./workspace.ts";

log("node host starting");
ensureWorkspace();

type AcpRuntime = {
  client: AcpClient;
  prompting: boolean;
  binding: boolean;
};

const agentPath = defaultAgentPath();
const runtimes: AcpRuntime[] = [];
const rpcClients = new Map<number, AcpClient>();
let bindTail = Promise.resolve();
let catalog: ModelCatalog = {
  models: [],
  currentId: "",
  modelConfigId: "model",
};
let pendingModelId: string | undefined;

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

async function refreshModels(): Promise<void> {
  try {
    catalog = mergeCatalog(catalog, await listAgentModels(agentPath));
  } catch (error) {
    log(`list models failed: ${String(error)}`);
  }
}

function absorbSessionOptions(opened: SessionOpen): void {
  const options = opened.configOptions as ConfigOption[] | undefined;
  catalog = mergeCatalog(catalog, catalogFromConfigOptions(options));
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
  const client = new AcpClient(agentPath, WORKSPACE_DIR, {
    onUpdate: (update, sessionId) => {
      if (runtime.binding && !runtime.prompting) {
        if (update.sessionUpdate === "config_option_update") {
          catalog = mergeCatalog(catalog, catalogFromConfigOptions(update.configOptions as ConfigOption[]));
          sendModels();
        }
        return;
      }
      const sid = sessionId ?? client.getSessionId();
      if (update.sessionUpdate === "config_option_update") {
        catalog = mergeCatalog(catalog, catalogFromConfigOptions(update.configOptions as ConfigOption[]));
        sendModels();
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
  });
  runtime.client = client;
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
      send({ type: "hello", workspace: WORKSPACE_DIR, agentPath });
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
    log(`handle ext error: ${String(error)}`);
    if (msg.type === "prompt") {
      send({ type: "turn.end", stopReason: "error", sessionId: msg.sessionId });
      return;
    }
    send({ type: "status", state: "error", error: String(error) });
  }
}

async function main(): Promise<void> {
  send({ type: "status", state: "starting" });
  try {
    const runtime = await spawnRuntime();
    await refreshModels();
    const opened = await withBinding(runtime, () => runtime.client.openSession(readSessionId()));
    writeSessionId(opened.sessionId);
    absorbSessionOptions(opened);
    await applyPendingModel(runtime);
    send({
      type: "session",
      sessionId: opened.sessionId,
      replay: opened.replay,
      created: opened.created,
      forked: opened.forked,
    });
    sendModels();
    send({ type: "status", state: "ready" });
    log(`ready session=${opened.sessionId} replay=${opened.replay}`);
  } catch (error) {
    log(`startup failed: ${String(error)}`);
    send({ type: "status", state: "error", error: String(error) });
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

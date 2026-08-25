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
import { ensureWorkspace, readSessionId, WORKSPACE_DIR, writeCurrentPage, writeSessionId } from "./workspace.ts";

log("node host starting");
ensureWorkspace();

const agentPath = defaultAgentPath();
let client: AcpClient | undefined;
let promptInFlight = false;
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

async function openAndAnnounce(open: () => Promise<SessionOpen>): Promise<void> {
  const opened = await open();
  writeSessionId(opened.sessionId);
  absorbSessionOptions(opened);
  await applyPendingModel();
  send({
    type: "session",
    sessionId: opened.sessionId,
    replay: opened.replay,
    created: opened.created,
    forked: opened.forked,
  });
  sendModels();
}

async function applyPendingModel(): Promise<void> {
  if (!pendingModelId || isUnsetModel(pendingModelId) || !client?.getSessionId()) return;
  try {
    await applyModel(pendingModelId);
  } catch (error) {
    log(`apply model skipped: ${String(error)}`);
  }
}

async function applyModel(modelId: string): Promise<void> {
  if (!client) throw new Error("agent is not ready");
  if (isUnsetModel(modelId)) {
    catalog = { ...catalog, currentId: modelId };
    return;
  }
  const result = await client.setModel(modelId, catalog.modelConfigId);
  const options = (result as { configOptions?: ConfigOption[] } | undefined)?.configOptions;
  catalog = mergeCatalog(catalog, {
    ...catalogFromConfigOptions(options),
    currentId: modelId,
  });
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
    if (msg.type === "browser.result") {
      await writeCommandResult(msg.result);
      return;
    }
    if (msg.type === "session.new") {
      if (!client) throw new Error("agent is not ready");
      if (promptInFlight) throw new Error("a turn is already running");
      await openAndAnnounce(() => client!.createSession());
      return;
    }
    if (msg.type === "session.use") {
      if (!client) throw new Error("agent is not ready");
      if (promptInFlight) throw new Error("a turn is already running");
      await openAndAnnounce(() => client!.useSession(msg.sessionId));
      return;
    }
    if (msg.type === "session.fork") {
      if (!client) throw new Error("agent is not ready");
      if (promptInFlight) throw new Error("a turn is already running");
      await openAndAnnounce(() => client!.forkSession(msg.sessionId));
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
      if (!client?.getSessionId() || isUnsetModel(msg.modelId)) {
        sendModels();
        return;
      }
      if (msg.sessionId) await client.useSession(msg.sessionId);
      try {
        await applyModel(msg.modelId);
      } catch (error) {
        log(`apply model skipped: ${String(error)}`);
      }
      sendModels();
      return;
    }
    if (msg.type === "prompt") {
      if (!client) throw new Error("agent is not ready");
      if (promptInFlight) throw new Error("a turn is already running");
      if (msg.sessionId) {
        const opened = await client.useSession(msg.sessionId);
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
      const prefix = msg.currentPage
        ? `[Current tab] ${msg.currentPage.title} — ${msg.currentPage.url}\n\n`
        : "";
      promptInFlight = true;
      try {
        const result = await client.prompt(`${prefix}${msg.text}`);
        send({ type: "turn.end", stopReason: result.stopReason });
      } finally {
        promptInFlight = false;
      }
      return;
    }
    if (msg.type === "cancel") {
      client?.cancel();
      return;
    }
    if (msg.type === "permission.reply") {
      client?.respond(msg.id, { outcome: msg.outcome });
      return;
    }
    if (msg.type === "cursor.reply") {
      client?.respond(msg.id, msg.result);
    }
  } catch (error) {
    log(`handle ext error: ${String(error)}`);
    send({ type: "status", state: "error", error: String(error) });
    if (msg.type === "prompt") {
      send({ type: "turn.end", stopReason: "error" });
    }
  }
}

async function main(): Promise<void> {
  send({ type: "status", state: "starting" });
  try {
    client = new AcpClient(agentPath, WORKSPACE_DIR, {
      onUpdate: (update) => {
        if (update.sessionUpdate === "config_option_update") {
          catalog = mergeCatalog(catalog, catalogFromConfigOptions(update.configOptions as ConfigOption[]));
          sendModels();
        }
        send({ type: "update", update });
      },
      onPermission: (id, params) => send({ type: "permission", id, params }),
      onCursor: (id, method, params) => send({ type: "cursor", id, method, params }),
    });
    client.start();
    await refreshModels();
    await client.initialize();
    const opened = await client.openSession(readSessionId());
    writeSessionId(opened.sessionId);
    absorbSessionOptions(opened);
    await applyPendingModel();
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
  client?.stop();
  process.exit(0);
});

void main();

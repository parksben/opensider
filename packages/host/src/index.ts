import type { ExtToHost, HostToExt } from "../../shared/src/protocol.ts";
import { AcpClient } from "./acp.ts";
import { log } from "./log.ts";
import { createNativeIo } from "./native.ts";
import { defaultAgentPath } from "./paths.ts";
import { watchCommands, writeCommandResult } from "./watch.ts";
import { ensureWorkspace, readSessionId, WORKSPACE_DIR, writeCurrentPage, writeSessionId } from "./workspace.ts";

ensureWorkspace();

const agentPath = defaultAgentPath();
let client: AcpClient | undefined;
let promptInFlight = false;

const native = createNativeIo((raw) => {
  const msg = raw as ExtToHost;
  void handleExt(msg);
});

function send(msg: HostToExt): void {
  native.send(msg);
}

async function handleExt(msg: ExtToHost): Promise<void> {
  try {
    if (msg.type === "hello") {
      send({ type: "hello", workspace: WORKSPACE_DIR, agentPath });
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
      const opened = await client.createSession();
      writeSessionId(opened.sessionId);
      send({
        type: "session",
        sessionId: opened.sessionId,
        replay: opened.replay,
        created: opened.created,
        forked: opened.forked,
      });
      return;
    }
    if (msg.type === "session.use") {
      if (!client) throw new Error("agent is not ready");
      if (promptInFlight) throw new Error("a turn is already running");
      const opened = await client.useSession(msg.sessionId);
      writeSessionId(opened.sessionId);
      send({
        type: "session",
        sessionId: opened.sessionId,
        replay: opened.replay,
        created: opened.created,
        forked: opened.forked,
      });
      return;
    }
    if (msg.type === "session.fork") {
      if (!client) throw new Error("agent is not ready");
      if (promptInFlight) throw new Error("a turn is already running");
      const opened = await client.forkSession(msg.sessionId);
      writeSessionId(opened.sessionId);
      send({
        type: "session",
        sessionId: opened.sessionId,
        replay: opened.replay,
        created: opened.created,
        forked: opened.forked,
      });
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
      onUpdate: (update) => send({ type: "update", update }),
      onPermission: (id, params) => send({ type: "permission", id, params }),
      onCursor: (id, method, params) => send({ type: "cursor", id, method, params }),
    });
    client.start();
    await client.initialize();
    const opened = await client.openSession(readSessionId());
    writeSessionId(opened.sessionId);
    send({
      type: "session",
      sessionId: opened.sessionId,
      replay: opened.replay,
      created: opened.created,
      forked: opened.forked,
    });
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

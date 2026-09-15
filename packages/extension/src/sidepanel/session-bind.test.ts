import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BindRegistry, findSessionIdByAcpId } from "./session-bind.ts";

describe("BindRegistry", () => {
  it("pairs replies by requestId and ignores unknown or missing ids", () => {
    const registry = new BindRegistry();
    registry.add("r1", "session-a", "new");
    registry.add("r2", "session-b", "use");

    assert.deepEqual(registry.take("r1"), { localId: "session-a", kind: "new" });
    // 同一个 requestId 只能兑现一次，二次 take 不再命中。
    assert.equal(registry.take("r1"), undefined);
    // 没有 requestId（SW 回放 / Host 自发）不该认领任何绑定。
    assert.equal(registry.take(undefined), undefined);
    assert.deepEqual(registry.take("r2"), { localId: "session-b", kind: "use" });
  });

  it("never lets a stale bind capture a later reply from another session", () => {
    const registry = new BindRegistry();
    registry.add("r-b", "session-b", "new");
    // r-a 的请求没有回执就消失了（连接错误等）；其项被清理后，B 的回执只能配 B。
    registry.dropLocal("session-a");
    assert.deepEqual(registry.take("r-b"), { localId: "session-b", kind: "new" });
  });

  it("tracks pending binds but not prompt hangs", () => {
    const registry = new BindRegistry();
    assert.equal(registry.hasPendingBinds(), false);
    registry.add("p1", "session-a", "prompt");
    assert.equal(registry.hasPendingBinds(), false);
    registry.add("b1", "session-b", "new");
    assert.equal(registry.hasPendingBinds(), true);
  });

  it("replaces a previous prompt hang for the same session", () => {
    const registry = new BindRegistry();
    registry.add("p1", "session-a", "prompt");
    registry.add("p2", "session-a", "prompt");
    // 旧 prompt 悬挂项被顶掉，不会在之后拿到修正回执。
    registry.add("p3", "session-c", "prompt");
    assert.deepEqual(registry.take("p2"), { localId: "session-a", kind: "prompt" });
    assert.deepEqual(registry.take("p3"), { localId: "session-c", kind: "prompt" });
  });

  it("drops only prompt hangs on turn end", () => {
    const registry = new BindRegistry();
    registry.add("p1", "session-a", "prompt");
    registry.add("b1", "session-a", "use");
    registry.dropPrompts("session-a");
    assert.equal(registry.take("p1"), undefined);
    assert.deepEqual(registry.take("b1"), { localId: "session-a", kind: "use" });
  });

  it("clears every hang on connection reset", () => {
    const registry = new BindRegistry();
    registry.add("r1", "session-a", "new");
    registry.add("r2", "session-b", "prompt");
    registry.clear();
    assert.equal(registry.take("r1"), undefined);
    assert.equal(registry.take("r2"), undefined);
    assert.equal(registry.hasLocal("session-a"), false);
    assert.equal(registry.hasPendingBinds(), false);
  });
});

describe("findSessionIdByAcpId", () => {
  const sessions = [
    { id: "local-b", acpSessionId: "acp-1" },
    { id: "local-a", acpSessionId: "acp-2", acpByProvider: { cursor: "acp-old", copilot: "acp-3" } },
  ];

  it("maps an ACP id to its owning session", () => {
    assert.equal(findSessionIdByAcpId(sessions, "acp-1"), "local-b");
    assert.equal(findSessionIdByAcpId(sessions, "acp-2"), "local-a");
    assert.equal(findSessionIdByAcpId(sessions, "acp-3"), "local-a");
  });

  it("returns undefined instead of falling back to anything", () => {
    assert.equal(findSessionIdByAcpId(sessions, "acp-missing"), undefined);
    assert.equal(findSessionIdByAcpId(sessions, undefined), undefined);
    assert.equal(findSessionIdByAcpId(sessions, ""), undefined);
  });
});

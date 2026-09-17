// 主世界钩子的调用者判定。这里的每条规则都对着一个真实后果：页面抢到 token 会让它自己的
// 标签页既不被观察也不被武装，而钩子「静默失败」会让扩展以为是环境问题——所以 handshake
// 必须把「没装」「被页面拿了」「就是你」三件事分清楚。
import assert from "node:assert/strict";
import test from "node:test";

import { createCallerGuard } from "./hook-caller.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER = "ffeeddccbbaa99887766554433221100";

test("the service worker's first call claims the token", () => {
  const guard = createCallerGuard();
  assert.deepEqual(guard.handshake(TOKEN), { installed: true, authorized: true, claimed: true });
  assert.equal(guard.current(), TOKEN);
  assert.equal(guard.authorized(TOKEN), true);
  assert.equal(guard.mayRelease(TOKEN), true);
});

test("a page that gets there first holds the hook, and the handshake says so", () => {
  const guard = createCallerGuard();
  // The page calls first with its own string — the hook cannot tell it apart from us, so it
  // is claimed. What matters is that our next call is not silently "fine":
  assert.deepEqual(guard.handshake("page-was-here-first"), { installed: true, authorized: true, claimed: true });
  assert.deepEqual(guard.handshake(TOKEN), { installed: true, authorized: false, claimed: false });
  assert.equal(guard.authorized(TOKEN), false);
  assert.equal(guard.mayRelease(TOKEN), false);
});

test("a too-short caller cannot claim the token", () => {
  const guard = createCallerGuard();
  assert.deepEqual(guard.handshake("short"), { installed: true, authorized: false, claimed: false });
  assert.deepEqual(guard.handshake(null), { installed: true, authorized: false, claimed: false });
  assert.equal(guard.current(), "", "nothing was claimed");
  // ... so the real caller still gets it.
  assert.equal(guard.handshake(TOKEN).claimed, true);
});

test("a second caller never re-claims, it is just turned away", () => {
  const guard = createCallerGuard();
  guard.handshake(TOKEN);
  const seen = guard.handshake(OTHER);
  assert.deepEqual(seen, { installed: true, authorized: false, claimed: false });
  assert.equal(guard.current(), TOKEN, "the first token still stands");
});

test("read/set style checks never claim the token", () => {
  const guard = createCallerGuard();
  assert.equal(guard.authorized(TOKEN), false, "no token yet");
  assert.equal(guard.current(), "", "asking does not claim");
  assert.equal(guard.mayRelease(TOKEN), false, "releasing must never be the claiming call");
});

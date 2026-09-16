// 页面活动态（强制可见 / 有焦点）的核心行为。这里用最小的假 DOM 环境跑真实代码 ——
// Playwright 的 Chromium 永远不会把标签标成 hidden（它自己开了焦点模拟），所以「真的
// 隐藏时页面看到什么」只能在单测里用假环境验证，e2e 只覆盖接线与生命周期。
//
// 注意：shim 会改写传入的 EventTarget 原型，所以每个用例都要有自己的那个类。
import assert from "node:assert/strict";
import test from "node:test";

import { createActivityShim } from "./activity-shim.ts";

function makeEnv(options: { hidden: boolean; ttlMs?: number }) {
  class Target {
    readonly listeners = new Map<string, Set<unknown>>();

    addEventListener(type: string, listener: unknown): void {
      const set = this.listeners.get(type) ?? new Set<unknown>();
      set.add(listener);
      this.listeners.set(type, set);
    }

    removeEventListener(type: string, listener: unknown): void {
      this.listeners.get(type)?.delete(listener);
    }

    fire(type: string): void {
      for (const listener of [...(this.listeners.get(type) ?? [])]) {
        (listener as (event: { type: string }) => void)({ type });
      }
    }

    count(type: string): number {
      return this.listeners.get(type)?.size ?? 0;
    }
  }

  let realHidden = options.hidden;
  const proto: Record<string, unknown> = {};
  Object.defineProperty(proto, "hidden", { configurable: true, enumerable: true, get: () => realHidden });
  Object.defineProperty(proto, "visibilityState", {
    configurable: true,
    enumerable: true,
    get: () => (realHidden ? "hidden" : "visible"),
  });
  proto["hasFocus"] = function hasFocus() {
    return !realHidden;
  };

  const document = Object.create(proto) as Document;
  const frameCallbacks = new Map<number, () => void>();
  const timerCount = { value: 0 };
  let nextId = 1;
  const window = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = nextId++;
      frameCallbacks.set(id, () => callback(0));
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      frameCallbacks.delete(id);
    },
    setTimeout: (fn: () => void) => {
      timerCount.value += 1;
      const id = nextId++;
      frameCallbacks.set(id, fn);
      return id;
    },
    clearTimeout: (id: number) => {
      frameCallbacks.delete(id);
    },
  } as unknown as Window;

  const clock = { ms: 0 };
  const shim = createActivityShim({
    document,
    window,
    eventTarget: Target as unknown as typeof EventTarget,
    now: () => clock.ms,
    frameMs: 16,
    ttlMs: options.ttlMs ?? 1_000,
    muted: new Set(["visibilitychange", "blur"]),
  });

  return {
    shim,
    document,
    proto,
    window,
    clock,
    Target,
    timerCount,
    setRealHidden: (value: boolean) => {
      realHidden = value;
    },
    /** Run everything the fake browser has queued (rAF callbacks and timers). */
    runQueued: () => {
      for (const [id, callback] of [...frameCallbacks]) {
        frameCallbacks.delete(id);
        callback();
      }
    },
  };
}

test("an untouched page reads the browser's own answer", () => {
  const env = makeEnv({ hidden: true });
  assert.equal(env.document.visibilityState, "hidden");
  assert.equal(env.document.hidden, true);
  assert.equal(env.document.hasFocus(), false);
  assert.deepEqual(env.shim.read(), { armed: false, actualHidden: true, frameFallback: false });
});

test("armed, a really hidden page reads as visible and focused", () => {
  const env = makeEnv({ hidden: true });
  env.shim.set(true);
  assert.equal(env.document.visibilityState, "visible");
  assert.equal(env.document.hidden, false);
  assert.equal(env.document.hasFocus(), true);
  assert.deepEqual(env.shim.read(), { armed: true, actualHidden: true, frameFallback: false });
});

test("an armed page never hears visibilitychange or blur", () => {
  const env = makeEnv({ hidden: true });
  const seen: string[] = [];
  const target = new env.Target();

  env.shim.set(true);
  target.addEventListener("visibilitychange", () => seen.push("visibilitychange"));
  target.addEventListener("blur", () => seen.push("blur"));
  target.fire("visibilitychange");
  target.fire("blur");
  assert.deepEqual(seen, [], "muted while armed");

  // removeEventListener has to undo exactly what addEventListener did.
  const listener = () => undefined;
  target.addEventListener("visibilitychange", listener);
  target.removeEventListener("visibilitychange", listener);
  assert.equal(target.count("visibilitychange"), 1, "only the muted one was there");
});

test("listeners registered before arming still fire (documented limitation)", () => {
  const env = makeEnv({ hidden: true });
  const target = new env.Target();
  const seen: string[] = [];
  target.addEventListener("visibilitychange", () => seen.push("early"));
  env.shim.set(true);
  target.fire("visibilitychange");
  assert.deepEqual(seen, ["early"]);
});

test("requestAnimationFrame falls back to a timer while the page is really hidden", () => {
  const env = makeEnv({ hidden: true });
  const ticks: number[] = [];
  env.window.requestAnimationFrame(() => ticks.push(1));
  env.runQueued();
  assert.deepEqual(ticks, [1], "the real rAF path still runs when the fake browser paints");

  assert.equal(env.timerCount.value, 0);
  env.shim.set(true);
  env.window.requestAnimationFrame(() => ticks.push(2));
  assert.equal(env.timerCount.value, 1, "hidden: the callback went to a timer instead");
  assert.equal(env.shim.read().frameFallback, true);

  env.setRealHidden(false);
  env.window.requestAnimationFrame(() => ticks.push(3));
  assert.equal(env.timerCount.value, 1, "visible again: no fallback timer");
});

test("disarming restores the page's own view", () => {
  const env = makeEnv({ hidden: true });
  env.shim.set(true);
  assert.equal(env.document.hidden, false);

  env.shim.set(false);
  assert.equal(env.document.visibilityState, "hidden");
  assert.equal(env.document.hidden, true);
  assert.equal(env.document.hasFocus(), false);
  assert.deepEqual(env.shim.read(), { armed: false, actualHidden: true, frameFallback: false });

  // And the listener patch is gone with it.
  const target = new env.Target();
  const seen: string[] = [];
  target.addEventListener("visibilitychange", () => seen.push("after"));
  target.fire("visibilitychange");
  assert.deepEqual(seen, ["after"]);
});

test("arming expires on its own so a lost panel cannot fake visibility forever", () => {
  const env = makeEnv({ hidden: true, ttlMs: 500 });
  env.shim.set(true);
  env.clock.ms = 400;
  assert.equal(env.document.hidden, false, "still inside the TTL");
  env.clock.ms = 600;
  assert.equal(env.document.hidden, true, "TTL lapsed");
  assert.equal(env.shim.read().armed, false);
});

test("a document.onvisibilitychange handler survives arming and disarm", () => {
  const env = makeEnv({ hidden: true });
  const seen: string[] = [];
  const handler = () => seen.push("on");
  env.proto["onvisibilitychange"] = handler;
  assert.equal(env.proto["onvisibilitychange"], handler);

  env.shim.set(true);
  assert.equal(env.proto["onvisibilitychange"], handler, "still the page's handler, never called");
  assert.deepEqual(seen, []);

  env.shim.set(false);
  assert.equal(env.proto["onvisibilitychange"], handler);
});

// 页面自己的浮层（模态框 / 抽屉 / 遮罩）判定：纯函数部分在这里跑，DOM 收集部分由
// scripts/verify-page-overlays.mjs 在真浏览器里覆盖。
import assert from "node:assert/strict";
import test from "node:test";

import {
  MODAL_MIN_COVERAGE,
  OVERLAY_MIN_COVERAGE,
  OVERLAY_MIN_Z_INDEX,
  judgeOverlay,
  overlaySignature,
} from "../../shared/src/overlays.ts";

const probe = (overrides = {}) => ({ tag: "DIV", ...overrides });

test("a dialog role is a modal overlay", () => {
  assert.deepEqual(judgeOverlay(probe({ role: "dialog" })), {
    overlay: true,
    modal: true,
    reason: "role=dialog",
  });
  assert.equal(judgeOverlay(probe({ role: "alertdialog" })).modal, true);
  // Case/whitespace from the DOM must not matter.
  assert.equal(judgeOverlay(probe({ role: "DIALOG" })).overlay, true);
});

test("aria-modal and <dialog open> are modal overlays", () => {
  assert.equal(judgeOverlay(probe({ ariaModal: true })).modal, true);
  assert.deepEqual(judgeOverlay({ tag: "dialog", dialogOpen: true }), {
    overlay: true,
    modal: true,
    reason: "dialog[open]",
  });
  // A closed <dialog> is not on screen at all.
  assert.equal(judgeOverlay({ tag: "dialog", dialogOpen: false }).overlay, false);
});

test("a high floating layer counts by how much of the viewport it covers", () => {
  const big = judgeOverlay(probe({ position: "fixed", zIndex: 1000, coverage: 0.9 }));
  assert.equal(big.overlay, true);
  assert.equal(big.modal, true);

  const panel = judgeOverlay(probe({ position: "absolute", zIndex: 500, coverage: MODAL_MIN_COVERAGE - 0.1 }));
  assert.equal(panel.overlay, true);
  assert.equal(panel.modal, false, "a side panel is an overlay but not a modal");

  const small = judgeOverlay(probe({ position: "fixed", zIndex: 500, coverage: OVERLAY_MIN_COVERAGE - 0.01 }));
  assert.equal(small.overlay, false);
});

test("ordinary page chrome is not an overlay", () => {
  for (const candidate of [
    probe({ position: "static" }),
    probe({ position: "relative", zIndex: 5000, coverage: 1 }),
    probe({ position: "fixed", zIndex: OVERLAY_MIN_Z_INDEX - 1, coverage: 1 }),
    probe({ position: "fixed", zIndex: 900 }),
  ]) {
    assert.equal(judgeOverlay(candidate).overlay, false, JSON.stringify(candidate));
  }
});

test("the signature changes when the overlay set changes", () => {
  const item = (role, label, coverage) => ({
    role,
    label,
    text: "",
    zIndex: 1,
    coverage,
    modal: false,
    backgroundInert: false,
    at: 0,
  });
  const empty = overlaySignature({ overlays: [], modal: false });
  const one = overlaySignature({ overlays: [item("dialog", "Sign in", 0.5)], modal: true });
  const alsoOne = overlaySignature({ overlays: [item("dialog", "Sign in", 0.5)], modal: true });
  const other = overlaySignature({ overlays: [item("dialog", "Sign up", 0.5)], modal: true });
  assert.equal(one, alsoOne, "same set, same signature");
  assert.notEqual(one, other);
  assert.notEqual(one, empty);
});

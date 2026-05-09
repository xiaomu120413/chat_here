import test from "node:test";
import assert from "node:assert/strict";

import { maskSecret } from "../../ui/gatewaySecurity.js";

test("maskSecret hides full gateway tokens by default", () => {
  assert.equal(maskSecret("mobile-test-token-123456"), "mobi••••3456");
  assert.equal(maskSecret("short"), "••••");
  assert.equal(maskSecret(""), "");
});

test("maskSecret supports custom visible edges", () => {
  assert.equal(maskSecret("abcdef123456", { head: 2, tail: 3 }), "ab••••456");
});

import test from "node:test";
import assert from "node:assert/strict";

import { getErrorMessage } from "../../ui/render.js";

test("getErrorMessage extracts message from plain objects", () => {
  assert.equal(getErrorMessage({ message: "plain object failure" }), "plain object failure");
});

test("getErrorMessage falls back when message is missing", () => {
  assert.equal(getErrorMessage({ code: 500 }, "fallback text"), "fallback text");
});

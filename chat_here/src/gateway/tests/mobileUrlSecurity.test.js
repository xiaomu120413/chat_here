import test from "node:test";
import assert from "node:assert/strict";

import { createSanitizedMobileUrl } from "../../mobile/urlSecurity.js";

test("mobile URL sanitizer removes token query parameters", () => {
  const sanitized = createSanitizedMobileUrl(
    "http://127.0.0.1:1421/?mobile=1&gateway=http%3A%2F%2F127.0.0.1%3A18080&token=secret",
  );

  assert.equal(sanitized, "http://127.0.0.1:1421/?mobile=1&gateway=http%3A%2F%2F127.0.0.1%3A18080");
});

test("mobile URL sanitizer preserves non-sensitive URLs", () => {
  const href = "http://127.0.0.1:1421/?mobile=1&gateway=http%3A%2F%2F127.0.0.1%3A18080";
  assert.equal(createSanitizedMobileUrl(href), href);
  assert.equal(createSanitizedMobileUrl("not a url"), "not a url");
});

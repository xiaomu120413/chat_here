import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MOBILE_CONFIG_TTL_MS,
  isFreshMobileGatewayConfig,
  withMobileConfigSavedAt,
} from "../../mobile/configSecurity.js";

test("mobile config stores a saved timestamp", () => {
  const saved = withMobileConfigSavedAt(
    { baseUrl: "http://127.0.0.1:17321", token: "secret" },
    Date.parse("2026-05-09T00:00:00.000Z"),
  );

  assert.deepEqual(saved, {
    baseUrl: "http://127.0.0.1:17321",
    token: "secret",
    savedAt: "2026-05-09T00:00:00.000Z",
  });
});

test("mobile config expires saved tokens", () => {
  const now = Date.parse("2026-05-09T00:00:00.000Z");
  const fresh = {
    token: "secret",
    savedAt: new Date(now - DEFAULT_MOBILE_CONFIG_TTL_MS + 1).toISOString(),
  };
  const expired = {
    token: "secret",
    savedAt: new Date(now - DEFAULT_MOBILE_CONFIG_TTL_MS - 1).toISOString(),
  };

  assert.equal(isFreshMobileGatewayConfig(fresh, now), true);
  assert.equal(isFreshMobileGatewayConfig(expired, now), false);
  assert.equal(isFreshMobileGatewayConfig({ token: "secret" }, now), false);
});

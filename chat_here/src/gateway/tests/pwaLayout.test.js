import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("HTML declares PWA manifest and mobile viewport", async () => {
  const html = await readFile(new URL("../../../index.html", import.meta.url), "utf8");

  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/);
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /id="rail-sessions"/);
  assert.match(html, /id="rail-members"/);
  assert.match(html, /id="rail-self-test"/);
  assert.match(html, /id="cancel-run-btn"/);
  assert.match(html, /id="gateway-copy-mobile-btn"/);
  assert.match(html, /data-insert="@codex "/);
  assert.match(html, /data-insert="@copilot "/);
  assert.match(html, /data-insert="@all "/);
  assert.match(html, /id="mobile-app"/);
  assert.match(html, /id="mobile-gateway-url"/);
  assert.match(html, /id="mobile-gateway-token"/);
  assert.match(html, /id="mobile-disconnect-btn"/);
  assert.match(html, /输入消息，Enter 发送/);
  assert.match(html, />发送<\/button>/);
});

test("PWA manifest is installable enough for browser entry", async () => {
  const raw = await readFile(new URL("../../../manifest.webmanifest", import.meta.url), "utf8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.icons.length, 2);
  assert.ok(manifest.icons.every((icon) => icon.type === "image/svg+xml"));
});

test("CSS includes 430px and 390px mobile breakpoints", async () => {
  const css = await readFile(new URL("../../styles.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /\.qq-shell\.show-session-list \.session-pane/);
  assert.match(css, /overflow-x: hidden/);
  assert.match(css, /button:disabled/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /\.mobile-shell/);
  assert.match(css, /\.mobile-grid/);
  assert.match(css, /\.mobile-message-list/);
});

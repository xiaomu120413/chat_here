import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const codexModel = process.env.CHAT_HERE_CODEX_SMOKE_MODEL ?? "gpt-5.4";
const copilotModel = process.env.CHAT_HERE_COPILOT_SMOKE_MODEL ?? "gpt-5.4-mini";

const results = [];
results.push(await smokeCodex());
results.push(await smokeCopilot());

for (const result of results) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`${status} ${result.name}: ${result.message}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

async function smokeCodex() {
  const dir = await mkdtemp(join(tmpdir(), "chat-here-codex-smoke-"));
  const outputPath = join(dir, "last-message.txt");
  try {
    const output = await runWithStdin(
      process.platform === "win32" ? "cmd" : "codex",
      process.platform === "win32"
        ? [
            "/C",
            "codex",
            "exec",
            "--skip-git-repo-check",
            "--model",
            codexModel,
            "--output-last-message",
            outputPath,
            "-",
          ]
        : [
            "exec",
            "--skip-git-repo-check",
            "--model",
            codexModel,
            "--output-last-message",
            outputPath,
            "-",
          ],
      "Reply with exactly CODEX_SMOKE_OK.",
      120_000,
    );

    const fileText = await readFile(outputPath, "utf8").catch(() => "");
    const text = [fileText, output.stdout].join("\n").trim();
    return text.includes("CODEX_SMOKE_OK")
      ? { ok: true, name: "codex", message: `model ${codexModel} returned CODEX_SMOKE_OK` }
      : { ok: false, name: "codex", message: truncate(output.stderr || text || "empty output") };
  } catch (error) {
    return { ok: false, name: "codex", message: getErrorText(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function smokeCopilot() {
  try {
    const loader = process.env.CHAT_HERE_COPILOT_LOADER ?? (await resolveCopilotLoader());
    const result = await execFileAsync(
      "node",
      [loader, "-p", "Reply with exactly COPILOT_SMOKE_OK.", "--model", copilotModel, "--allow-all-tools", "--silent"],
      { timeout: 120_000, windowsHide: true },
    );
    const text = [result.stdout, result.stderr].join("\n");
    return text.includes("COPILOT_SMOKE_OK")
      ? { ok: true, name: "copilot", message: `model ${copilotModel} returned COPILOT_SMOKE_OK` }
      : { ok: false, name: "copilot", message: truncate(text || "empty output") };
  } catch (error) {
    return { ok: false, name: "copilot", message: getErrorText(error) };
  }
}

async function resolveCopilotLoader() {
  if (!process.env.APPDATA) {
    throw new Error("APPDATA is not set; set CHAT_HERE_COPILOT_LOADER to the Copilot npm loader path");
  }
  return join(process.env.APPDATA, "npm", "node_modules", "@github", "copilot", "npm-loader.js");
}

function runWithStdin(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
    child.stdin.end(input);
  });
}

function getErrorText(error) {
  return truncate(error?.message || String(error));
}

function truncate(text) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  return normalized.length > 420 ? `${normalized.slice(0, 420)}...` : normalized;
}

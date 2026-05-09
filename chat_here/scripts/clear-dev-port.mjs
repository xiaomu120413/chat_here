import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEV_PORT = Number(process.env.CHAT_HERE_DEV_PORT ?? 1421);
const cwd = process.cwd().toLowerCase();

if (process.platform === "win32") {
  await clearWindowsPort(DEV_PORT);
} else {
  await clearUnixPort(DEV_PORT);
}

async function clearWindowsPort(port) {
  const connections = await run("powershell", [
    "-NoProfile",
    "-Command",
    `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
  ]);

  const pids = uniqueNumbers(connections.stdout);
  for (const pid of pids) {
    const command = await run("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
    ]);
    const line = command.stdout.trim().toLowerCase();
    if (isOwnDevProcess(line)) {
      await run("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force`]);
      console.log(`cleared stale dev server on port ${port} (pid ${pid})`);
    } else if (line) {
      console.error(`port ${port} is occupied by an unrelated process (pid ${pid})`);
      console.error(line);
      process.exitCode = 1;
    }
  }
}

async function clearUnixPort(port) {
  const output = await run("sh", ["-lc", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`]);
  const pids = uniqueNumbers(output.stdout);
  for (const pid of pids) {
    const command = await run("sh", ["-lc", `ps -p ${pid} -o command=`]);
    const line = command.stdout.trim().toLowerCase();
    if (isOwnDevProcess(line)) {
      await run("kill", ["-TERM", String(pid)]);
      console.log(`cleared stale dev server on port ${port} (pid ${pid})`);
    } else if (line) {
      console.error(`port ${port} is occupied by an unrelated process (pid ${pid})`);
      console.error(line);
      process.exitCode = 1;
    }
  }
}

function isOwnDevProcess(commandLine) {
  return commandLine.includes("vite") && commandLine.includes(String(DEV_PORT)) && commandLine.includes(cwd);
}

function uniqueNumbers(text) {
  return [...new Set(String(text).match(/\d+/g) ?? [])].map(Number);
}

async function run(command, args) {
  try {
    return await execFileAsync(command, args, { windowsHide: true });
  } catch (error) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      code: error.code ?? 1,
    };
  }
}

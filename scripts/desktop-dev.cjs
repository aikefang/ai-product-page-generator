const crypto = require("crypto");
const fsp = require("fs/promises");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const { resolveElectronBinary } = require("./electron-binary.cjs");
const { ensureSafeWorkdir } = require("./safe-workdir.cjs");
const { toSqliteFileUrl } = require("./runtime-paths.cjs");

const projectRoot = path.resolve(__dirname, "..");
const safeCwd = ensureSafeWorkdir(projectRoot);
const runtimeRoot = path.resolve(process.env.DESKTOP_DEV_DATA_DIR || path.join(projectRoot, ".desktop-dev"));

let nextProcess = null;
let electronProcess = null;
let isShuttingDown = false;

function findAvailablePort(preferredPort = 3000, maxAttempts = 40) {
  const tryPort = (port, remaining) =>
    new Promise((resolve, reject) => {
      const tester = net.createServer();

      tester.once("error", (error) => {
        tester.close();
        if (remaining <= 0) {
          reject(error);
          return;
        }
        resolve(tryPort(port + 1, remaining - 1));
      });

      tester.once("listening", () => {
        const address = tester.address();
        tester.close(() => {
          if (typeof address === "object" && address && typeof address.port === "number") {
            resolve(address.port);
            return;
          }
          resolve(port);
        });
      });

      tester.listen(port, "127.0.0.1");
    });

  return tryPort(preferredPort, maxAttempts);
}

function waitForServer(url, timeoutMs = 120000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();

        if ((response.statusCode ?? 500) < 500) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Next dev server health check failed with status ${response.statusCode}`));
          return;
        }

        setTimeout(attempt, 500);
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error("Timed out waiting for Next dev server to start."));
          return;
        }

        setTimeout(attempt, 500);
      });
    };

    attempt();
  });
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureRuntime() {
  const prismaDir = path.join(runtimeRoot, "prisma");
  const storageDir = path.join(runtimeRoot, "storage");
  const configPath = path.join(runtimeRoot, "config", "runtime.json");

  await Promise.all([
    fsp.mkdir(prismaDir, { recursive: true }),
    fsp.mkdir(storageDir, { recursive: true }),
  ]);

  const currentConfig = (await readJson(configPath)) ?? {};
  const appSecret =
    typeof currentConfig.appSecret === "string" && currentConfig.appSecret.length >= 12
      ? currentConfig.appSecret
      : crypto.randomBytes(32).toString("hex");

  await writeJson(configPath, {
    appSecret,
    updatedAt: new Date().toISOString(),
  });

  return {
    userDataDir: runtimeRoot,
    databasePath: path.join(prismaDir, "dev.db"),
    storageDir,
    appSecret,
  };
}

function getRuntimeEnv(runtime, port) {
  return {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    APP_RUNTIME: "desktop",
    APP_USER_DATA_DIR: runtime.userDataDir,
    DATABASE_URL: toSqliteFileUrl(runtime.databasePath),
    STORAGE_ROOT: runtime.storageDir,
    APP_SECRET: runtime.appSecret,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || "图灵绘画",
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code}`));
    });
  });
}

function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill();
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 250);
}

async function main() {
  const electronBinary = resolveElectronBinary({ projectRoot, repair: true });
  const runtime = await ensureRuntime();
  const port = Number(process.env.DESKTOP_DEV_PORT || process.env.PORT || 3000);
  const resolvedPort = await findAvailablePort(Number.isFinite(port) ? port : 3000);
  const env = getRuntimeEnv(runtime, resolvedPort);
  const url = `http://127.0.0.1:${resolvedPort}`;

  await runCommand(process.execPath, [path.join(projectRoot, "scripts", "apply-prisma-migrations.cjs")], {
    cwd: projectRoot,
    env,
  });

  nextProcess = spawn(
    process.execPath,
    [
      path.join(projectRoot, "scripts", "run-next-safe.cjs"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(resolvedPort),
    ],
    {
      cwd: safeCwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );

  nextProcess.on("exit", (code) => {
    if (!isShuttingDown) {
      shutdown(code ?? 0);
    }
  });

  await waitForServer(url);

  const electronEnv = {
    ...env,
    DESKTOP_DEV_SERVER_URL: url,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  electronProcess = spawn(electronBinary, [projectRoot], {
    cwd: safeCwd,
    env: electronEnv,
    stdio: "inherit",
    windowsHide: true,
  });

  electronProcess.on("exit", (code) => {
    shutdown(code ?? 0);
  });

  console.log(`Desktop dev client is loading ${url}`);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});

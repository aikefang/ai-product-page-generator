const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function getElectronPackageRoot(projectRoot) {
  return path.join(projectRoot, "node_modules", "electron");
}

function getElectronFallbackPath(projectRoot) {
  const platformPaths = {
    darwin: path.join(getElectronPackageRoot(projectRoot), "dist", "Electron.app", "Contents", "MacOS", "Electron"),
    linux: path.join(getElectronPackageRoot(projectRoot), "dist", "electron"),
    win32: path.join(getElectronPackageRoot(projectRoot), "dist", "electron.exe"),
  };

  return platformPaths[process.platform] ?? null;
}

function getRequiredElectronRuntimeFiles(projectRoot, electronBinary) {
  if (process.platform !== "darwin") {
    return [electronBinary];
  }

  return [
    electronBinary,
    path.join(
      getElectronPackageRoot(projectRoot),
      "dist",
      "Electron.app",
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Electron Framework",
    ),
  ];
}

function isElectronRuntimeComplete(projectRoot, electronBinary) {
  return getRequiredElectronRuntimeFiles(projectRoot, electronBinary).every((filePath) => fs.existsSync(filePath));
}

function tryRequireElectron(projectRoot) {
  try {
    const electronBinary = require(path.join(getElectronPackageRoot(projectRoot), "index.js"));
    if (typeof electronBinary === "string" && isElectronRuntimeComplete(projectRoot, electronBinary)) {
      return electronBinary;
    }
  } catch {
    return null;
  }

  return null;
}

function runElectronInstall(projectRoot) {
  const electronRoot = getElectronPackageRoot(projectRoot);
  const installScript = path.join(electronRoot, "install.js");

  if (!fs.existsSync(installScript)) {
    throw new Error("Electron install.js 不存在，请先执行 npm install。");
  }

  fs.rmSync(path.join(electronRoot, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(electronRoot, "path.txt"), { force: true });

  const result = spawnSync(process.execPath, [installScript], {
    cwd: electronRoot,
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
      force_no_cache: "true",
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    console.warn(`Electron install.js 修复失败，退出码：${result.status ?? "unknown"}，继续尝试直接下载。`);
    return false;
  }

  return true;
}

function runDirectElectronDownload(projectRoot) {
  const result = spawnSync(process.execPath, [__filename, "download", projectRoot], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
    },
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`Electron 直接下载修复失败，退出码：${result.status ?? "unknown"}`);
  }
}

async function extractElectronZip(zipPath, distPath) {
  fs.mkdirSync(distPath, { recursive: true });

  const unzipResult = spawnSync("unzip", ["-q", zipPath, "-d", distPath], {
    stdio: "inherit",
    windowsHide: true,
  });

  if (unzipResult.status === 0) {
    return;
  }

  const extract = require("extract-zip");
  await extract(zipPath, { dir: distPath });
}

function resolveElectronBinary(options) {
  const projectRoot = options.projectRoot;
  const repair = Boolean(options.repair);
  const packageRoot = getElectronPackageRoot(projectRoot);

  if (!fs.existsSync(packageRoot)) {
    throw new Error("Electron 依赖不存在，请先执行 npm install。");
  }

  const requiredPath = getElectronFallbackPath(projectRoot);
  if (!requiredPath) {
    throw new Error(`当前平台不支持 Electron：${process.platform}`);
  }

  const requiredFiles = getRequiredElectronRuntimeFiles(projectRoot, requiredPath);
  const missingFiles = requiredFiles.filter((filePath) => !fs.existsSync(filePath));

  if (missingFiles.length > 0 && repair) {
    console.log("Electron 安装不完整，正在重新下载并修复 Electron 二进制...");
    runElectronInstall(projectRoot);

    if (!isElectronRuntimeComplete(projectRoot, requiredPath)) {
      console.log("Electron install.js 未产出完整运行时，改用直接下载修复...");
      runDirectElectronDownload(projectRoot);
    }
  }

  const resolved = tryRequireElectron(projectRoot) ?? requiredPath;
  const stillMissing = getRequiredElectronRuntimeFiles(projectRoot, resolved).filter((filePath) => !fs.existsSync(filePath));

  if (stillMissing.length > 0) {
    throw new Error(
      [
        "Electron 没有安装完整，无法启动桌面客户端。",
        "缺失文件：",
        ...stillMissing.map((filePath) => `- ${filePath}`),
        "请执行：npm approve-scripts electron && npm rebuild electron",
        "如果网络在国内较慢，可执行：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm rebuild electron",
      ].join("\n"),
    );
  }

  return resolved;
}

async function downloadElectronBinary(projectRoot) {
  const { downloadArtifact } = require("@electron/get");
  const electronRoot = getElectronPackageRoot(projectRoot);
  const { version } = require(path.join(electronRoot, "package.json"));
  const platformPath = {
    darwin: "Electron.app/Contents/MacOS/Electron",
    linux: "electron",
    win32: "electron.exe",
  }[process.platform];

  if (!platformPath) {
    throw new Error(`当前平台不支持 Electron：${process.platform}`);
  }

  fs.rmSync(path.join(electronRoot, "dist"), { recursive: true, force: true });
  fs.rmSync(path.join(electronRoot, "path.txt"), { force: true });

  const mirrors = [
    process.env.ELECTRON_MIRROR,
    "https://npmmirror.com/mirrors/electron/",
    "https://github.com/electron/electron/releases/download/",
  ].filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

  let zipPath = null;
  const errors = [];
  const mirrorEnvKeys = [
    "ELECTRON_MIRROR",
    "NPM_CONFIG_ELECTRON_MIRROR",
    "npm_config_electron_mirror",
    "ELECTRON_CUSTOM_DIR",
    "NPM_CONFIG_ELECTRON_CUSTOM_DIR",
    "npm_config_electron_custom_dir",
    "ELECTRON_CUSTOM_FILENAME",
    "NPM_CONFIG_ELECTRON_CUSTOM_FILENAME",
    "npm_config_electron_custom_filename",
  ];

  for (const mirror of mirrors) {
    const previousEnv = new Map(mirrorEnvKeys.map((key) => [key, process.env[key]]));
    try {
      for (const key of mirrorEnvKeys) {
        delete process.env[key];
      }
      process.env.ELECTRON_MIRROR = mirror;
      console.log(`正在下载 Electron ${version}：${mirror}`);

      zipPath = await downloadArtifact({
        version,
        artifactName: "electron",
        force: process.env.ELECTRON_FORCE_DOWNLOAD === "true",
        platform: process.platform,
        arch: process.arch,
        checksums: require(path.join(electronRoot, "checksums.json")),
      });
      console.log(`Electron zip 下载完成：${zipPath}`);
      break;
    } catch (error) {
      errors.push(`${mirror}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      for (const [key, value] of previousEnv.entries()) {
        if (typeof value === "undefined") {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  if (!zipPath) {
    throw new Error(["Electron zip 下载失败：", ...errors.map((error) => `- ${error}`)].join("\n"));
  }

  await extractElectronZip(zipPath, path.join(electronRoot, "dist"));
  await fs.promises.writeFile(path.join(electronRoot, "path.txt"), platformPath, "utf8");
  console.log(`Electron 已解压到：${path.join(electronRoot, "dist")}`);

  const binaryPath = getElectronFallbackPath(projectRoot);
  if (!binaryPath || !isElectronRuntimeComplete(projectRoot, binaryPath)) {
    throw new Error("Electron zip 已解压，但运行时文件仍不完整。");
  }
}

async function main() {
  if (process.argv[2] !== "download") {
    return;
  }

  const projectRoot = path.resolve(process.argv[3] || path.join(__dirname, ".."));
  await downloadElectronBinary(projectRoot);
}

if (require.main === module) {
  main()
    .then(() => {
      if (process.argv[2] === "download") {
        process.exit(0);
      }
    })
    .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
    });
}

module.exports = {
  resolveElectronBinary,
};

const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork, spawn } = require("child_process");

const PORT = 4000;

let serverProcess;
let mainWindow;
let logStream;

function serverRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "server");
}

function getDatabasePath() {
  if (!app.isPackaged) {
    return path.join(serverRoot(), "prisma", "dev.db");
  }
  const dbDir = path.join(app.getPath("userData"), "database");
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, "data.db");
}

function logPath() {
  return path.join(app.getPath("userData"), "logs", "app.log");
}

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  try {
    if (!logStream) {
      const dir = path.dirname(logPath());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      logStream = fs.createWriteStream(logPath(), { flags: "a" });
    }
    logStream.write(stamped);
  } catch {
    // تجاهل أخطاء كتابة السجل نفسه حتى لا تعطّل بدء التطبيق
  }
}

function runNodeScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => log(`[${path.basename(scriptPath)}] ${d}`.trimEnd()));
    child.stderr.on("data", (d) => log(`[${path.basename(scriptPath)}] ${d}`.trimEnd()));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`فشل تنفيذ ${scriptPath} (رمز الخروج ${code})`))));
    child.on("error", reject);
  });
}

async function prepareDatabase(databaseUrl, dbFilePath) {
  const isFreshDb = !fs.existsSync(dbFilePath);
  const root = serverRoot();
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const schemaPath = path.join(root, "prisma", "schema.prisma");

  if (!fs.existsSync(prismaCli)) {
    throw new Error(`لم يتم العثور على أداة Prisma في المسار المتوقع: ${prismaCli}`);
  }

  await runNodeScript(prismaCli, ["migrate", "deploy", "--schema", schemaPath], { DATABASE_URL: databaseUrl });

  if (isFreshDb) {
    const seedScript = path.join(root, "prisma", "seed.cjs");
    await runNodeScript(seedScript, [], { DATABASE_URL: databaseUrl });
  }
}

function startServer(databaseUrl) {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(serverRoot(), "dist", "index.js");
    if (!fs.existsSync(serverEntry)) {
      return reject(new Error(`لم يتم العثور على ملف الخادم في المسار المتوقع: ${serverEntry}`));
    }
    serverProcess = fork(serverEntry, [], {
      env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    serverProcess.stdout.on("data", (d) => log(`[server] ${d}`.trimEnd()));
    serverProcess.stderr.on("data", (d) => log(`[server] ${d}`.trimEnd()));
    serverProcess.once("error", reject);
    serverProcess.once("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`توقف الخادم الداخلي بشكل غير متوقع (رمز الخروج ${code}). راجع ملف السجل: ${logPath()}`));
      }
    });
    // امنح الخادم لحظة ليبدأ الاستماع قبل فتح النافذة
    setTimeout(resolve, 1500);
  });
}

async function createWindow() {
  const dbFilePath = getDatabasePath();
  const databaseUrl = `file:${dbFilePath}`;
  log(`بدء التشغيل. isPackaged=${app.isPackaged} databaseUrl=${databaseUrl} resourcesPath=${process.resourcesPath}`);

  if (app.isPackaged) {
    await prepareDatabase(databaseUrl, dbFilePath);
  }
  await startServer(databaseUrl);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    title: "نظام إدارة المستفيدين - جمعية البر الخيرية بمحافظة السليل",
    autoHideMenuBar: true,
  });
  mainWindow.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(() => {
  createWindow().catch((err) => {
    log(`فشل بدء التشغيل: ${err.stack || err}`);
    dialog.showErrorBox(
      "تعذر تشغيل النظام",
      `حدث خطأ أثناء تشغيل النظام:\n\n${err.message}\n\nراجع ملف السجل للتفاصيل:\n${logPath()}`
    );
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});

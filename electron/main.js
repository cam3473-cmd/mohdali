const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork, spawn } = require("child_process");

const PORT = 4000;

let serverProcess;
let mainWindow;

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

function runNodeScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`فشل تنفيذ ${scriptPath} (code ${code})`))));
    child.on("error", reject);
  });
}

async function prepareDatabase(databaseUrl, dbFilePath) {
  const isFreshDb = !fs.existsSync(dbFilePath);
  const root = serverRoot();
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const schemaPath = path.join(root, "prisma", "schema.prisma");

  await runNodeScript(prismaCli, ["migrate", "deploy", "--schema", schemaPath], { DATABASE_URL: databaseUrl });

  if (isFreshDb) {
    const seedScript = path.join(root, "prisma", "seed.cjs");
    await runNodeScript(seedScript, [], { DATABASE_URL: databaseUrl });
  }
}

function startServer(databaseUrl) {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(serverRoot(), "dist", "index.js");
    serverProcess = fork(serverEntry, [], {
      env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(PORT) },
      stdio: "inherit",
    });
    serverProcess.once("error", reject);
    // امنح الخادم لحظة ليبدأ الاستماع قبل فتح النافذة
    setTimeout(resolve, 1500);
  });
}

async function createWindow() {
  const dbFilePath = getDatabasePath();
  const databaseUrl = `file:${dbFilePath}`;

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
    console.error("تعذر تشغيل التطبيق:", err);
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

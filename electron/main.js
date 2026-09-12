const { app, BrowserWindow, dialog, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { fork, spawn } = require("child_process");

// اسم ثابت ومعروف مسبقاً حتى يكون مسار بيانات المستخدم (وملف السجل) متوقعاً دائماً،
// بغض النظر عن كيفية تعيين electron-builder لاسم الحزمة داخلياً
app.setName("AlSulailCharityBeneficiaries");

const PORT = 4000;

let serverProcess;
let mainWindow;
let logStream;

function serverRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "server");
}

// جذر يحتوي node_modules الجذرية للمشروع (تُنشئها npm workspaces بتجميع الحزم
// المشتركة هناك بدل تكرارها داخل كل حزمة فرعية)
function monorepoRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
}

// تبحث عن حزمة ضمن node_modules الخاصة بـ server أولاً، ثم الجذر المشترك،
// لأن npm workspaces قد ترفع الحزم المشتركة (مثل أداة Prisma) إلى الجذر
function resolveNodeModulesPath(relativePath) {
  const candidates = [
    path.join(serverRoot(), "node_modules", relativePath),
    path.join(monorepoRoot(), "node_modules", relativePath),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error(`لم يتم العثور على ${relativePath}. المسارات التي تم التحقق منها:\n${candidates.join("\n")}`);
  }
  return found;
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
  const prismaCli = resolveNodeModulesPath(path.join("prisma", "build", "index.js"));
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

  // تُحسب مقاسات النافذة من مساحة الشاشة المتاحة فعلياً (تختلف بين الأجهزة)
  // بدلاً من مقاس ثابت، حتى تظهر النافذة كاملة ومناسبة لأي شاشة دون تمرير أو قص
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.min(1320, screenWidth);
  const windowHeight = Math.min(840, screenHeight);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    title: "نظام إدارة المستفيدين - جمعية البر الخيرية بمحافظة السليل",
    autoHideMenuBar: true,
  });
  if (screenWidth <= 1320 || screenHeight <= 840) {
    mainWindow.maximize();
  }
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

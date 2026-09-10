// يُجهّز نسخة مستقلة وصغيرة من حزم تشغيل الخادم (بدون أدوات التطوير مثل
// Electron وVite وTypeScript وElectron Builder التي ترفعها npm workspaces
// إلى node_modules الجذرية) لتُستخدم داخل حزمة التثبيت. يُشغَّل تلقائياً قبل
// electron-builder عبر "predist" في package.json.
//
// السبب: تثبيت المشروع كاملاً بأسلوب npm workspaces يرفع الحزم المشتركة إلى
// node_modules في جذر المستودع (بما فيها أدوات ثقيلة لا يحتاجها الخادم أبداً
// وقت التشغيل)، ونسخ كل ذلك ضمن حزمة التثبيت يُفشل خطوة الضغط NSIS على بعض
// أجهزة ويندوز (نتيجة الحجم الهائل أو طول المسارات). التثبيت المستقل هنا
// ينتج node_modules تحتوي فقط على ما يحتاجه الخادم فعلياً.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const electronDir = path.join(__dirname, "..");
const serverDir = path.join(electronDir, "..", "server");
const stagingDir = path.join(electronDir, ".server-deploy");

console.log("[prepare-server-deps] تجهيز حزم تشغيل الخادم بشكل مستقل...");

if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(stagingDir, { recursive: true });

fs.copyFileSync(path.join(serverDir, "package.json"), path.join(stagingDir, "package.json"));
fs.copyFileSync(path.join(serverDir, "prisma", "schema.prisma"), path.join(stagingDir, "schema.prisma"));

console.log("[prepare-server-deps] npm install --omit=dev ...");
execSync("npm install --omit=dev --no-audit --no-fund --ignore-scripts", {
  cwd: stagingDir,
  stdio: "inherit",
});

console.log("[prepare-server-deps] توليد Prisma Client...");
const prismaCli = path.join(stagingDir, "node_modules", "prisma", "build", "index.js");
execSync(`node "${prismaCli}" generate --schema "schema.prisma"`, {
  cwd: stagingDir,
  stdio: "inherit",
});

console.log("[prepare-server-deps] تم بنجاح:", path.join(stagingDir, "node_modules"));

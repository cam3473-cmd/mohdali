import crypto from "crypto";
import fs from "fs";
import path from "path";

// القيمة الافتراضية غير الآمنة الموجودة في server/.env.example — لا تُستخدم كمفتاح فعلي أبداً
const INSECURE_DEFAULT = "change-this-secret-in-production";

function databaseDir(): string {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("file:")) {
    return path.dirname(path.resolve(url.slice("file:".length)));
  }
  return path.join(__dirname, "..", "..");
}

// إذا لم يضبط المشغّل JWT_SECRET (أو تركه على القيمة الافتراضية غير الآمنة)، يتم توليد
// مفتاح عشوائي مرة واحدة وحفظه بجانب قاعدة البيانات، بدل الاعتماد على قيمة معروفة للجميع.
export function resolveJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret && envSecret !== INSECURE_DEFAULT) {
    return envSecret;
  }

  const secretPath = path.join(databaseDir(), ".jwt-secret");
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, "utf8").trim();
  }

  const generated = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

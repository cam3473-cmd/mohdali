import "express-async-errors";
import express from "express";
import cors from "cors";
import compression from "compression";
import path from "path";
import os from "os";
import { authRouter } from "./routes/auth";
import { beneficiariesRouter } from "./routes/beneficiaries";
import { supportsRouter } from "./routes/supports";
import { batchesRouter } from "./routes/batches";
import { coursesRouter } from "./routes/courses";
import { usersRouter } from "./routes/users";
import { reportsRouter } from "./routes/reports";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

app.use(cors());
// يضغط استجابات JSON والملفات الساكنة، يفيد سرعة الاستجابة عبر الشبكة المحلية للأجهزة الأخرى
app.use(compression());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// عناوين الشبكة المحلية لهذا الجهاز، لتمكين بقية الموظفين من معرفة رابط الدخول
app.get("/api/network-info", (_req, res) => {
  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  res.json({ addresses, port: PORT });
});
app.use("/api/auth", authRouter);
app.use("/api/beneficiaries", beneficiariesRouter);
app.use("/api/supports", supportsRouter);
app.use("/api/batches", batchesRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/users", usersRouter);
app.use("/api/reports", reportsRouter);

// معالج أخطاء عام يمنع توقف الخادم بسبب استثناء غير متوقع في أحد المسارات
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

// تقديم واجهة الويب المبنية (في وضع الإنتاج / تطبيق سطح المكتب)
// ملفات JS/CSS تحمل بصمة (hash) في اسمها فيصح تخزينها مؤقتاً بأمان، أما index.html
// فيجب ألا يُخزَّن أبداً: هو من يُحدّد أسماء تلك الملفات، وتخزينه مؤقتاً بالخطأ يعني
// بقاء الواجهة القديمة تعمل بعد كل تحديث وتثبيت جديد للتطبيق رغم نجاح البناء فعلياً
const webDist = path.join(__dirname, "../../web/dist");
app.use(express.static(webDist, { index: false }));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

// شبكة أمان: منع توقف الخادم بالكامل بسبب خطأ غير متوقع لم تتم معالجته
process.on("unhandledRejection", (err) => console.error("خطأ غير معالج:", err));
process.on("uncaughtException", (err) => console.error("استثناء غير معالج:", err));

// الاستماع على جميع عناوين الشبكة المحلية ليتمكن بقية الموظفين من الدخول عبر المتصفح
const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
  // إشعار العملية الأم (Electron) بأن الخادم جاهز فعلياً بدل انتظار مهلة ثابتة قد لا تكفي أو تُخفي فشلاً صامتاً
  process.send?.({ type: "server-ready" });
});

// فشل الاستماع (مثل انشغال المنفذ بعملية سابقة) يجب أن يُعلم العملية الأم بدل ترك الخادم متوقفاً بصمت
httpServer.on("error", (err) => {
  console.error("فشل بدء الاستماع على المنفذ:", err);
  process.send?.({ type: "server-error", message: (err as Error).message });
  process.exit(1);
});

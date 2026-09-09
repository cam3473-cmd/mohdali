// نسخة JavaScript خالصة من سكربت التهيئة، تُستخدم من تطبيق سطح المكتب (Electron)
// عند أول تشغيل على جهاز جديد، حيث لا تتوفر أدوات TypeScript/tsx داخل التطبيق المُجمّع.
// يجب أن تبقى متوافقة مع server/prisma/seed.ts (المستخدم في بيئة التطوير عبر "npm run db:seed").

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "Sulail@1447";

const employees = [
  { username: "admin", fullName: "مدير النظام" },
  { username: "employee1", fullName: "الموظف الأول" },
  { username: "employee2", fullName: "الموظف الثاني" },
  { username: "employee3", fullName: "الموظف الثالث" },
  { username: "employee4", fullName: "الموظف الرابع" },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  for (const emp of employees) {
    await prisma.user.upsert({
      where: { username: emp.username },
      update: {},
      create: { username: emp.username, fullName: emp.fullName, passwordHash },
    });
  }

  console.log("تم إنشاء حسابات الموظفين الافتراضية بنجاح.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

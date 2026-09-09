import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// حسابات الموظفين الافتراضية (5 موظفين بصلاحيات كاملة متساوية)
// يُنصح بتغيير كلمة المرور الافتراضية بعد أول تسجيل دخول
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
      create: {
        username: emp.username,
        fullName: emp.fullName,
        passwordHash,
      },
    });
  }

  console.log("تم إنشاء حسابات الموظفين الافتراضية بنجاح.");
  console.log(`كلمة المرور الافتراضية لجميع الحسابات: ${DEFAULT_PASSWORD}`);
  console.log("الرجاء تغييرها فوراً من شاشة إدارة المستخدمين بعد أول تسجيل دخول.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

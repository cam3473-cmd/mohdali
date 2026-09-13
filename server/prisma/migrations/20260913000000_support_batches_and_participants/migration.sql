-- DropIndex
DROP INDEX "CourseEnrollment_beneficiaryId_courseId_key";

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "totalCost" REAL;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CourseEnrollment";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SupportCampaign";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "SupportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "quantity" INTEGER,
    "unitPrice" REAL,
    "receivedDate" DATETIME NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "distributionMethod" TEXT NOT NULL DEFAULT 'HEAD_PLUS_DEPENDENTS',
    "unifiedAmount" REAL,
    "headAmount" REAL,
    "dependentAmount" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "SupportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "civilId" TEXT,
    "phone" TEXT,
    "birthDate" DATETIME,
    "birthDateHijri" TEXT,
    "email" TEXT,
    "beneficiaryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENROLLED',
    "certificateIssued" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "CourseParticipant_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseParticipant_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseParticipant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Support" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "beneficiaryId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL,
    "description" TEXT,
    "quantity" INTEGER,
    "supportDate" DATETIME NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISBURSED',
    "notes" TEXT,
    "batchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "Support_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Support_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SupportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Support_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Support" ("amount", "beneficiaryId", "category", "createdAt", "createdById", "description", "id", "notes", "quantity", "status", "supportDate", "year") SELECT "amount", "beneficiaryId", "category", "createdAt", "createdById", "description", "id", "notes", "quantity", "status", "supportDate", "year" FROM "Support";
DROP TABLE "Support";
ALTER TABLE "new_Support" RENAME TO "Support";
CREATE INDEX "Support_beneficiaryId_idx" ON "Support"("beneficiaryId");
CREATE INDEX "Support_year_idx" ON "Support"("year");
CREATE INDEX "Support_category_idx" ON "Support"("category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CourseParticipant_courseId_idx" ON "CourseParticipant"("courseId");


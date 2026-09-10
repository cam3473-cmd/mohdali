/*
  Warnings:

  - You are about to drop the `CashSupport` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InKindSupport` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CashSupport";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "InKindSupport";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Support" (
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
    "campaignId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "Support_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Support_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SupportCampaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Support_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "perPersonRate" REAL,
    "totalBudget" REAL,
    "distributionDate" DATETIME NOT NULL,
    "year" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "SupportCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Support_beneficiaryId_idx" ON "Support"("beneficiaryId");

-- CreateIndex
CREATE INDEX "Support_year_idx" ON "Support"("year");

-- CreateIndex
CREATE INDEX "Support_category_idx" ON "Support"("category");

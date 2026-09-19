-- AlterTable
ALTER TABLE "Support" ADD COLUMN "surveySentAt" DATETIME;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "smsApiKey" TEXT,
    "smsSenderName" TEXT,
    "surveyFormBaseUrl" TEXT,
    "surveyFormEntryParam" TEXT,
    "updatedAt" DATETIME NOT NULL
);

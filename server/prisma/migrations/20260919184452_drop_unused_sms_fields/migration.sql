/*
  Warnings:

  - You are about to drop the column `smsApiKey` on the `AppSettings` table. All the data in the column will be lost.
  - You are about to drop the column `smsSenderName` on the `AppSettings` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "surveyFormBaseUrl" TEXT,
    "surveyFormEntryParam" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("id", "surveyFormBaseUrl", "surveyFormEntryParam", "updatedAt") SELECT "id", "surveyFormBaseUrl", "surveyFormEntryParam", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- AlterTable
ALTER TABLE "Beneficiary" ADD COLUMN "birthDateHijri" TEXT;
ALTER TABLE "Beneficiary" ADD COLUMN "caseType" TEXT;
ALTER TABLE "Beneficiary" ADD COLUMN "fileNumber" TEXT;
ALTER TABLE "Beneficiary" ADD COLUMN "iban" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Beneficiary_fileNumber_key" ON "Beneficiary"("fileNumber");


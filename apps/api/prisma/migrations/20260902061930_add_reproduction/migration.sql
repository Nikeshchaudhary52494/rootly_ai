-- CreateEnum
CREATE TYPE "ReproductionStatus" AS ENUM ('PENDING', 'GENERATING_TEST', 'CREATING_SANDBOX', 'CHECKING_OUT', 'INSTALLING', 'RUNNING', 'CLASSIFYING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReproductionResult" AS ENUM ('REPRODUCED', 'NOT_REPRODUCED', 'INCONCLUSIVE');

-- CreateTable
CREATE TABLE "ReproductionRun" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "status" "ReproductionStatus" NOT NULL DEFAULT 'PENDING',
    "result" "ReproductionResult",
    "generatedTest" TEXT,
    "testFilePath" TEXT,
    "targetCommitSha" TEXT,
    "stdout" TEXT,
    "stderr" TEXT,
    "exitCode" INTEGER,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReproductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReproductionTest" (
    "id" TEXT NOT NULL,
    "reproductionRunId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReproductionTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReproductionRun_incidentId_idx" ON "ReproductionRun"("incidentId");

-- CreateIndex
CREATE INDEX "ReproductionRun_investigationId_idx" ON "ReproductionRun"("investigationId");

-- CreateIndex
CREATE INDEX "ReproductionRun_status_idx" ON "ReproductionRun"("status");

-- CreateIndex
CREATE INDEX "ReproductionRun_createdAt_idx" ON "ReproductionRun"("createdAt");

-- CreateIndex
CREATE INDEX "ReproductionTest_reproductionRunId_idx" ON "ReproductionTest"("reproductionRunId");

-- AddForeignKey
ALTER TABLE "ReproductionRun" ADD CONSTRAINT "ReproductionRun_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReproductionRun" ADD CONSTRAINT "ReproductionRun_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReproductionTest" ADD CONSTRAINT "ReproductionTest_reproductionRunId_fkey" FOREIGN KEY ("reproductionRunId") REFERENCES "ReproductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

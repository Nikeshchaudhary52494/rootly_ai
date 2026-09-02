-- CreateEnum
CREATE TYPE "FixStatus" AS ENUM ('PENDING', 'GENERATING_FIX', 'VALIDATING_PATCH', 'CREATING_SANDBOX', 'CHECKING_OUT', 'APPLYING_PATCH', 'RUNNING_REPRODUCTION', 'RUNNING_REGRESSION_TESTS', 'VALIDATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FixResult" AS ENUM ('FIX_VERIFIED', 'FIX_REJECTED', 'INCONCLUSIVE');

-- CreateTable
CREATE TABLE "FixAttempt" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "reproductionRunId" TEXT NOT NULL,
    "status" "FixStatus" NOT NULL DEFAULT 'PENDING',
    "result" "FixResult",
    "targetCommitSha" TEXT,
    "patch" TEXT,
    "changedFiles" TEXT[],
    "explanation" TEXT,
    "validationSummary" JSONB,
    "stdout" TEXT,
    "stderr" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixPatch" (
    "id" TEXT NOT NULL,
    "fixAttemptId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "patchedContent" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixPatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixAttempt_incidentId_idx" ON "FixAttempt"("incidentId");

-- CreateIndex
CREATE INDEX "FixAttempt_investigationId_idx" ON "FixAttempt"("investigationId");

-- CreateIndex
CREATE INDEX "FixAttempt_reproductionRunId_idx" ON "FixAttempt"("reproductionRunId");

-- CreateIndex
CREATE INDEX "FixAttempt_status_idx" ON "FixAttempt"("status");

-- CreateIndex
CREATE INDEX "FixAttempt_createdAt_idx" ON "FixAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "FixPatch_fixAttemptId_idx" ON "FixPatch"("fixAttemptId");

-- AddForeignKey
ALTER TABLE "FixAttempt" ADD CONSTRAINT "FixAttempt_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixAttempt" ADD CONSTRAINT "FixAttempt_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixAttempt" ADD CONSTRAINT "FixAttempt_reproductionRunId_fkey" FOREIGN KEY ("reproductionRunId") REFERENCES "ReproductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixPatch" ADD CONSTRAINT "FixPatch_fixAttemptId_fkey" FOREIGN KEY ("fixAttemptId") REFERENCES "FixAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

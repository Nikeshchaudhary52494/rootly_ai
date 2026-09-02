-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('PENDING', 'RUNNING', 'LOADING_CONTEXT', 'ANALYZING_ERROR', 'ANALYZING_CODE', 'ANALYZING_HISTORY', 'GENERATING_HYPOTHESES', 'EVALUATING_EVIDENCE', 'GENERATING_REPORT', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('LIKELY', 'POSSIBLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('SUPPORTING', 'CONTRADICTING');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('ERROR', 'SOURCE_CODE', 'STACK_TRACE', 'TEST', 'GIT_COMMIT', 'CONFIGURATION');

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "modelVersion" TEXT,
    "finalConfidence" DOUBLE PRECISION,
    "summary" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationHypothesis" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "HypothesisStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationHypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationEvidence" (
    "id" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "hypothesisId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestigationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investigation_incidentId_idx" ON "Investigation"("incidentId");

-- CreateIndex
CREATE INDEX "Investigation_incidentId_createdAt_idx" ON "Investigation"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "InvestigationHypothesis_investigationId_idx" ON "InvestigationHypothesis"("investigationId");

-- CreateIndex
CREATE INDEX "InvestigationEvidence_investigationId_idx" ON "InvestigationEvidence"("investigationId");

-- CreateIndex
CREATE INDEX "InvestigationEvidence_hypothesisId_idx" ON "InvestigationEvidence"("hypothesisId");

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationHypothesis" ADD CONSTRAINT "InvestigationHypothesis_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationEvidence" ADD CONSTRAINT "InvestigationEvidence_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationEvidence" ADD CONSTRAINT "InvestigationEvidence_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "InvestigationHypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

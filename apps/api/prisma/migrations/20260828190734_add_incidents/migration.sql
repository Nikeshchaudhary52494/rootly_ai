/*
  Warnings:

  - Added the required column `fingerprint` to the `ErrorEvent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- AlterTable
ALTER TABLE "ErrorEvent" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "incidentId" TEXT;

-- Backfill: pre-Phase-3 rows have no fingerprint yet, derive one from errorName+errorMessage.
UPDATE "ErrorEvent" SET "fingerprint" = encode(sha256(convert_to("errorName" || '|' || "errorMessage", 'UTF8')), 'hex') WHERE "fingerprint" IS NULL;

ALTER TABLE "ErrorEvent" ALTER COLUMN "fingerprint" SET NOT NULL;

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "sequenceNumber" SERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "errorName" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "latestEventId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_projectId_environmentId_status_idx" ON "Incident"("projectId", "environmentId", "status");

-- CreateIndex
CREATE INDEX "Incident_lastSeenAt_idx" ON "Incident"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_projectId_environmentId_fingerprint_key" ON "Incident"("projectId", "environmentId", "fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_fingerprint_idx" ON "ErrorEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorEvent_incidentId_idx" ON "ErrorEvent"("incidentId");

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

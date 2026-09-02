-- CreateEnum
CREATE TYPE "PullRequestStatus" AS ENUM ('CREATING', 'OPEN', 'CLOSED', 'MERGED', 'FAILED');

-- AlterTable
ALTER TABLE "FixAttempt" ADD COLUMN     "validatedPatchHash" TEXT;

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "fixAttemptId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "commitSha" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PullRequestStatus" NOT NULL DEFAULT 'CREATING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PullRequest_incidentId_idx" ON "PullRequest"("incidentId");

-- CreateIndex
CREATE INDEX "PullRequest_fixAttemptId_idx" ON "PullRequest"("fixAttemptId");

-- CreateIndex
CREATE INDEX "PullRequest_repositoryId_idx" ON "PullRequest"("repositoryId");

-- CreateIndex
CREATE INDEX "PullRequest_status_idx" ON "PullRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repositoryId_branchName_key" ON "PullRequest"("repositoryId", "branchName");

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_fixAttemptId_fkey" FOREIGN KEY ("fixAttemptId") REFERENCES "FixAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

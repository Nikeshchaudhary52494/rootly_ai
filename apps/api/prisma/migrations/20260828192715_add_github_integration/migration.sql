-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('GITHUB');

-- CreateEnum
CREATE TYPE "RepositoryFileType" AS ENUM ('FILE', 'DIRECTORY');

-- CreateEnum
CREATE TYPE "IncidentCodeContextStatus" AS ENUM ('PENDING', 'COLLECTING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "RepositoryProvider" NOT NULL DEFAULT 'GITHUB',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryFile" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" "RepositoryFileType" NOT NULL,
    "sha" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCodeContext" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "status" "IncidentCodeContextStatus" NOT NULL DEFAULT 'PENDING',
    "generatedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "primaryFilePath" TEXT,
    "primaryLineNumber" INTEGER,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentCodeContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCodeFile" (
    "id" TEXT NOT NULL,
    "incidentCodeContextId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineNumber" INTEGER,
    "columnNumber" INTEGER,
    "functionName" TEXT,
    "content" TEXT NOT NULL,
    "contentStartLine" INTEGER NOT NULL,
    "contentEndLine" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentCodeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentCodeCommit" (
    "id" TEXT NOT NULL,
    "incidentCodeContextId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentCodeCommit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_projectId_key" ON "Repository"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_repositoryUrl_key" ON "Repository"("repositoryUrl");

-- CreateIndex
CREATE INDEX "RepositoryFile_repositoryId_idx" ON "RepositoryFile"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryFile_repositoryId_path_key" ON "RepositoryFile"("repositoryId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentCodeContext_incidentId_key" ON "IncidentCodeContext"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentCodeFile_incidentCodeContextId_idx" ON "IncidentCodeFile"("incidentCodeContextId");

-- CreateIndex
CREATE INDEX "IncidentCodeCommit_incidentCodeContextId_idx" ON "IncidentCodeCommit"("incidentCodeContextId");

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryFile" ADD CONSTRAINT "RepositoryFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCodeContext" ADD CONSTRAINT "IncidentCodeContext_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCodeContext" ADD CONSTRAINT "IncidentCodeContext_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCodeFile" ADD CONSTRAINT "IncidentCodeFile_incidentCodeContextId_fkey" FOREIGN KEY ("incidentCodeContextId") REFERENCES "IncidentCodeContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentCodeCommit" ADD CONSTRAINT "IncidentCodeCommit_incidentCodeContextId_fkey" FOREIGN KEY ("incidentCodeContextId") REFERENCES "IncidentCodeContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

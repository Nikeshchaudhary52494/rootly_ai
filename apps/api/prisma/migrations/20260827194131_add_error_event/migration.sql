-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "environmentName" TEXT NOT NULL,
    "release" TEXT,
    "errorName" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "stackTrace" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorEvent_eventId_key" ON "ErrorEvent"("eventId");

-- CreateIndex
CREATE INDEX "ErrorEvent_projectId_idx" ON "ErrorEvent"("projectId");

-- CreateIndex
CREATE INDEX "ErrorEvent_environmentId_idx" ON "ErrorEvent"("environmentId");

-- CreateIndex
CREATE INDEX "ErrorEvent_timestamp_idx" ON "ErrorEvent"("timestamp");

-- CreateIndex
CREATE INDEX "ErrorEvent_receivedAt_idx" ON "ErrorEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_errorName_idx" ON "ErrorEvent"("errorName");

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

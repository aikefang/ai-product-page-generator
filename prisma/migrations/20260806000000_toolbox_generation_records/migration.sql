-- CreateTable
CREATE TABLE "ToolboxGenerationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toolType" TEXT NOT NULL,
    "taskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "inputImagePath" TEXT,
    "maskImagePath" TEXT,
    "outputImagePath" TEXT,
    "prompt" TEXT,
    "model" TEXT,
    "references" JSONB,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolboxGenerationRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "GenerationTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ToolboxGenerationRecord_toolType_createdAt_idx" ON "ToolboxGenerationRecord"("toolType", "createdAt");

-- CreateIndex
CREATE INDEX "ToolboxGenerationRecord_taskId_idx" ON "ToolboxGenerationRecord"("taskId");

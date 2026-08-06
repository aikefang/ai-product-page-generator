import { NextRequest } from "next/server";
import { ToolboxToolType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { relativeStorageUrl } from "@/lib/utils/files";
import { handleRouteError, ok } from "@/lib/utils/route";

function toFileUrl(filePath?: string | null) {
  return filePath ? relativeStorageUrl(filePath) : null;
}

const toolboxToolTypes = new Set<string>(Object.values(ToolboxToolType));

export async function GET(request: NextRequest) {
  try {
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 80);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.floor(limitParam))) : 80;
    const toolTypeParam = request.nextUrl.searchParams.get("toolType");
    const toolType = toolTypeParam && toolboxToolTypes.has(toolTypeParam) ? (toolTypeParam as ToolboxToolType) : null;

    const records = await prisma.toolboxGenerationRecord.findMany({
      where: toolType ? { toolType } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        task: {
          select: {
            id: true,
            taskType: true,
            status: true,
            errorMessage: true,
          },
        },
      },
    });

    return ok(
      records.map((record) => ({
        id: record.id,
        toolType: record.toolType,
        status: record.status,
        taskId: record.taskId,
        taskType: record.task?.taskType ?? null,
        taskStatus: record.task?.status ?? null,
        errorMessage: record.task?.errorMessage ?? null,
        inputImageUrl: toFileUrl(record.inputImagePath),
        maskImageUrl: toFileUrl(record.maskImagePath),
        outputImageUrl: toFileUrl(record.outputImagePath),
        prompt: record.prompt,
        model: record.model,
        references: record.references,
        metadata: record.metadata,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

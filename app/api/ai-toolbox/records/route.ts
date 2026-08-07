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
    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 40);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(80, Math.floor(limitParam))) : 40;
    const cursor = request.nextUrl.searchParams.get("cursor");
    const toolTypeParam = request.nextUrl.searchParams.get("toolType");
    const toolType = toolTypeParam && toolboxToolTypes.has(toolTypeParam) ? (toolTypeParam as ToolboxToolType) : null;

    const records = await prisma.toolboxGenerationRecord.findMany({
      where: toolType ? { toolType } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
    const hasMore = records.length > limit;
    const pageRecords = hasMore ? records.slice(0, limit) : records;
    const nextCursor = hasMore ? pageRecords.at(-1)?.id ?? null : null;

    return ok(
      {
        records: pageRecords.map((record) => ({
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
        nextCursor,
        hasMore,
      },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

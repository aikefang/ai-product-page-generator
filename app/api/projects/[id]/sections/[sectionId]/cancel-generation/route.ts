import { TaskType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { cancelTask, updateTaskProgress } from "@/lib/services/task-service";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

function resolveTaskType(preferred: string, fallback: string) {
  const inlineSchema = (prisma as typeof prisma & { _engineConfig?: { inlineSchema?: string } })._engineConfig?.inlineSchema;
  return (typeof inlineSchema === "string" && inlineSchema.includes(preferred) ? preferred : fallback) as TaskType;
}

function sectionImageTaskTypes() {
  const values: TaskType[] = [TaskType.GENERATE, TaskType.REGENERATE];
  const editImageTaskType = resolveTaskType("EDIT_IMAGE", "REGENERATE");
  if (!values.includes(editImageTaskType)) {
    values.push(editImageTaskType);
  }
  return values;
}

export async function POST(_request: Request, context: { params: { id: string; sectionId: string } }) {
  try {
    const section = await prisma.pageSection.findFirst({
      where: { id: context.params.sectionId, projectId: context.params.id },
    });
    if (!section) {
      return fail("NOT_FOUND", "Section not found.", null, 404);
    }

    const task = await prisma.generationTask.findFirst({
      where: {
        projectId: context.params.id,
        sectionId: context.params.sectionId,
        taskType: { in: sectionImageTaskTypes() },
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const parentTask = await prisma.generationTask.findFirst({
      where: {
        projectId: context.params.id,
        sectionId: null,
        taskType: "GENERATE",
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });
    const parentOutput =
      parentTask?.outputPayload && typeof parentTask.outputPayload === "object" && !Array.isArray(parentTask.outputPayload)
        ? (parentTask.outputPayload as Record<string, unknown>)
        : {};
    const belongsToActiveBatch = parentOutput.currentSectionId === section.id;

    if (parentTask && belongsToActiveBatch) {
      await updateTaskProgress(parentTask.id, { cancelSectionId: section.id });
    }

    if (task) {
      await cancelTask(task.id);
    }

    await prisma.pageSection.update({
      where: { id: section.id },
      data: { status: section.currentImageAssetId ? "SUCCESS" : "IDLE" },
    });

    return ok({
      taskId: task?.id ?? null,
      parentTaskId: belongsToActiveBatch ? parentTask?.id ?? null : null,
      canceled: Boolean(task || belongsToActiveBatch),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

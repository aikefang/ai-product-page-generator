import { Prisma, TaskType } from "@prisma/client";
import type { ImageGenerationResult } from "@/lib/ai/provider-client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getProviderAdapter } from "@/lib/services/provider-service";
import { runWithProviderCredentials, type RequestProviderCredentials } from "@/lib/services/provider-runtime";
import {
  completeTask,
  createTask,
  failTask,
  getTask,
  runTaskInBackground,
  startTask,
} from "@/lib/services/task-service";
import {
  imageUrlToDataUrl,
  saveToolboxGeneratedImage,
  saveToolboxInputImage,
} from "@/lib/storage/asset-manager";

const systemProjectPlatform = "__turing_system_task__";

function resolveTaskType(preferred: string, fallback: string) {
  const inlineSchema = (prisma as typeof prisma & { _engineConfig?: { inlineSchema?: string } })._engineConfig?.inlineSchema;
  return (typeof inlineSchema === "string" && inlineSchema.includes(preferred) ? preferred : fallback) as TaskType;
}

export type ToolboxLocalRepaintInput = {
  image: string;
  mask: string;
  editInstruction: string;
  referenceImages?: string[];
  referenceCropImages?: string[];
};

export type ToolboxLocalRepaintResult = {
  imageUrl: string;
  recordId?: string;
  model: string;
  revisedPrompt?: string;
  updatedAt: string;
};

export type ToolboxLocalRepaintInstructionInput = {
  image: string;
  baseMask: string;
  basePreviewImage?: string | null;
  references?: Array<{
    image: string;
    mask: string;
    previewImage?: string | null;
    cropImage?: string | null;
  }>;
};

const inpaintInstructionSchema = z.object({
  instruction: z.string().min(2).max(1200),
});

function unique(values: Array<string | null | undefined>) {
  return values.filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
}

function getImageEditModels(provider: Awaited<ReturnType<typeof getProviderAdapter>>["provider"]) {
  return unique([
    provider.models.find((item) => item.isDefaultImageEdit)?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).image_edit))?.modelId,
    provider.models.find((item) => item.isDefaultHeroImage)?.modelId,
    provider.models.find((item) => item.isDefaultDetailImage)?.modelId,
  ]);
}

function getVisionTextModels(provider: Awaited<ReturnType<typeof getProviderAdapter>>["provider"]) {
  return unique([
    provider.models.find((item) => item.isDefaultAnalysis)?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).vision))?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).image_input))?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).structured_output))?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).text))?.modelId,
  ]);
}

function buildStandaloneLocalRepaintPrompt(input: ToolboxLocalRepaintInput) {
  const referenceImages = input.referenceImages ?? [];
  const referenceCropImages = input.referenceCropImages ?? [];

  return [
    "Localized inpainting edit for a standalone user-uploaded image.",
    "The first image is the base image. A mask image is attached to define the editable area.",
    "Only the transparent area of the mask may be regenerated. All opaque/unmasked pixels must be preserved as closely as possible.",
    "Keep the exact original canvas size, aspect ratio, framing, and composition. Do not crop, resize, extend, zoom, rotate, or reframe the base image.",
    "Do not redesign the whole image. Do not change layout, typography, labels, background, product position, lighting, color palette, or any unmasked object.",
    "Blend the edited area naturally into its surroundings, matching existing perspective, material, shadows, edges, sharpness, and noise.",
    referenceImages.length > 0
      ? `There are ${referenceImages.length} full reference image(s). Use them only for details inside the masked area.`
      : "No full reference images were intentionally provided.",
    referenceCropImages.length > 0
      ? `There are ${referenceCropImages.length} cropped reference image(s). These crops are the user's painted reference regions and should be prioritized for local detail, shape, texture, edge, and color.`
      : "",
    `User local edit instruction: ${input.editInstruction.trim()}`,
    "Return one edited image with the same canvas and overall composition as the base image.",
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeImageEditFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown image edit error";
  if (/monthly spending limit|spending limit|billing|quota/i.test(detail)) {
    return "当前 API Key 的局部重绘额度已用尽。请前往代理商控制台提高或移除月度限额，或更换可用的 API Key。";
  }
  if (/timed out|aborterror|network error|fetch failed|gateway-timeout|gateway time-out|504/i.test(detail)) {
    return "当前 Provider 请求超时或网络异常，请稍后重试。";
  }
  return `当前 Provider 没有可用的真实局部重绘能力，或不支持 multipart mask 图片编辑。局部重绘不会使用普通重绘兜底，以避免改动未涂抹区域。原因摘要：${detail}`;
}

async function saveToolboxResult(result: ImageGenerationResult) {
  return saveToolboxGeneratedImage({
    source: {
      url: result.url,
      b64Json: result.b64Json,
      mimeType: "image/png",
    },
    prefix: "local-repaint",
  });
}

async function normalizeLocalRepaintInput(input: ToolboxLocalRepaintInput): Promise<ToolboxLocalRepaintInput> {
  return {
    ...input,
    image: await imageUrlToDataUrl(input.image),
    referenceImages: await Promise.all((input.referenceImages ?? []).map((image) => imageUrlToDataUrl(image))),
    referenceCropImages: await Promise.all((input.referenceCropImages ?? []).map((image) => imageUrlToDataUrl(image))),
  };
}

async function createLocalRepaintRecord(input: {
  sourceInput: ToolboxLocalRepaintInput;
  prompt?: string;
  model?: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  taskId?: string | null;
  outputImagePath?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [inputImage, maskImage] = await Promise.all([
    saveToolboxInputImage({ image: input.sourceInput.image, prefix: "local-repaint-base" }),
    saveToolboxInputImage({ image: input.sourceInput.mask, prefix: "local-repaint-mask" }),
  ]);

  const references = {
    referenceImageCount: input.sourceInput.referenceImages?.length ?? 0,
    referenceCropImageCount: input.sourceInput.referenceCropImages?.length ?? 0,
  } satisfies Prisma.InputJsonValue;
  const metadata = (input.metadata ?? {}) as Prisma.InputJsonValue;

  return prisma.toolboxGenerationRecord.create({
    data: {
      toolType: "LOCAL_REPAINT",
      taskId: input.taskId ?? null,
      status: input.status,
      inputImagePath: inputImage.filePath,
      maskImagePath: maskImage.filePath,
      outputImagePath: input.outputImagePath ?? null,
      prompt: input.prompt ?? input.sourceInput.editInstruction,
      model: input.model ?? null,
      references,
      metadata,
    },
  });
}

async function findLocalRepaintRecordByTaskId(taskId: string) {
  return prisma.toolboxGenerationRecord.findFirst({
    where: {
      taskId,
      toolType: "LOCAL_REPAINT",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

async function updateLocalRepaintRecord(
  recordId: string,
  input: {
    status?: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
    outputImagePath?: string | null;
    prompt?: string | null;
    model?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const metadata = input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined;
  await prisma.toolboxGenerationRecord.update({
    where: { id: recordId },
    data: {
      status: input.status,
      outputImagePath: input.outputImagePath,
      prompt: input.prompt,
      model: input.model,
      metadata,
    },
  });
}

async function runImageEditModel(input: ToolboxLocalRepaintInput): Promise<ToolboxLocalRepaintResult & { outputImagePath: string; prompt: string }> {
  const { provider, adapter } = await getProviderAdapter();
  const models = getImageEditModels(provider);
  const normalizedInput = await normalizeLocalRepaintInput(input);
  const prompt = buildStandaloneLocalRepaintPrompt(normalizedInput);
  const referenceImages = [
    ...(normalizedInput.referenceImages ?? []),
    ...(normalizedInput.referenceCropImages ?? []),
  ];
  const errors: string[] = [];

  for (const model of models) {
    try {
      const result = await adapter.editImage({
        model,
        image: normalizedInput.image,
        mask: normalizedInput.mask,
        prompt,
        referenceImages,
        timeoutMs: 180000,
        monitor: {
          operation: "toolbox_local_repaint",
        },
      });
      const saved = await saveToolboxResult(result);

      return {
        imageUrl: saved.url,
        outputImagePath: saved.filePath,
        prompt,
        model,
        revisedPrompt: result.revisedPrompt ?? "",
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  throw new Error(models.length === 0 ? "当前没有可用的图片编辑模型。" : summarizeImageEditFailure(new Error(errors.join(" | "))));
}

async function ensureSystemTaskProject() {
  const existing = await prisma.project.findFirst({
    where: { platform: systemProjectPlatform },
    orderBy: { createdAt: "asc" },
  });

  if (existing) return existing;

  return prisma.project.create({
    data: {
      name: "图灵绘画系统任务",
      platform: systemProjectPlatform,
      style: "system",
      description: "内部后台任务占位项目，不在历史记录中展示。",
    },
  });
}

export async function runToolboxLocalRepaint(input: ToolboxLocalRepaintInput) {
  if (!input.image.startsWith("data:image/") && !input.image.startsWith("/api/files/") && !input.image.startsWith("http")) {
    throw new Error("请上传一张可用的待局部重绘图片。");
  }
  if (!input.mask.startsWith("data:image/")) {
    throw new Error("请先涂抹需要局部重绘的区域。");
  }
  if (input.editInstruction.trim().length < 2) {
    throw new Error("请填写局部重绘的修改说明。");
  }

  const result = await runImageEditModel(input);
  const record = await createLocalRepaintRecord({
    sourceInput: input,
    prompt: result.prompt,
    model: result.model,
    status: "SUCCESS",
    outputImagePath: result.outputImagePath,
    metadata: {
      revisedPrompt: result.revisedPrompt ?? "",
      updatedAt: result.updatedAt,
    },
  });

  return {
    imageUrl: result.imageUrl,
    recordId: record.id,
    model: result.model,
    revisedPrompt: result.revisedPrompt,
    updatedAt: result.updatedAt,
  };
}

export async function generateToolboxLocalRepaintInstruction(input: ToolboxLocalRepaintInstructionInput) {
  if (!input.image) {
    throw new Error("请先上传一张待局部重绘图片。");
  }
  if (!input.baseMask.startsWith("data:image/")) {
    throw new Error("请先在当前图上涂抹需要局部重绘的区域。");
  }

  const { provider, adapter } = await getProviderAdapter();
  const models = getVisionTextModels(provider);
  const model = models[0] ?? null;
  if (!model) {
    throw new Error("当前 Provider 没有可用于生成局部修改说明的视觉文本模型。");
  }

  const references = input.references ?? [];
  const normalizedBaseImage = await imageUrlToDataUrl(input.image);
  const normalizedReferences = await Promise.all(
    references.map(async (reference) => ({
      ...reference,
      image: await imageUrlToDataUrl(reference.image),
    })),
  );
  const imageInputs: string[] = [];
  const imageDescriptions: string[] = [];
  const pushImage = (image: string | null | undefined, description: string) => {
    if (!image) return;
    imageInputs.push(image);
    imageDescriptions.push(`Image #${imageInputs.length}: ${description}`);
  };

  pushImage(normalizedBaseImage, "当前需要局部重绘的原图。");
  pushImage(input.basePreviewImage, "当前原图的红色涂抹预览图；红色区域是用户要改的位置。");
  pushImage(input.baseMask, "当前原图的 mask；透明区域是用户要改的位置，白色不透明区域必须保持不变。");
  normalizedReferences.forEach((reference, index) => {
    pushImage(reference.image, `参考图 ${index + 1} 原图。`);
    pushImage(reference.previewImage, `参考图 ${index + 1} 的红色涂抹预览图；红色区域是用户想借鉴的局部细节。`);
    pushImage(reference.mask, `参考图 ${index + 1} 的 mask；透明区域是用户想借鉴的局部细节。`);
    pushImage(reference.cropImage, `参考图 ${index + 1} 的涂抹区域自动裁剪图；这是局部重绘时需要优先参考的细节。`);
  });

  const hasReferenceRegions = references.length > 0;
  const userPrompt = [
    "你是图片局部重绘的修图说明助手。你的任务不是生成图片，而是根据用户涂抹区域写一段可直接用于局部重绘模型的中文修改说明。",
    hasReferenceRegions
      ? "用户同时提供了参考图涂抹区域，请结合参考图局部细节生成修改说明。"
      : "用户没有勾选参考图。请只根据当前原图、红色涂抹位置和周围上下文，自动判断涂抹区域最可能需要修复或优化什么，并生成明确可执行的修改说明。",
    "",
    "输入图片顺序：",
    ...imageDescriptions,
    "",
    "写说明时必须遵守：",
    "- 只描述当前原图涂抹区域内应该如何修改。",
    hasReferenceRegions
      ? "- 明确引用参考图中被涂抹的局部细节，例如形状、边缘、材质、孔位、弯折角度、颜色或纹理。"
      : "- 没有参考图时，不要编造外部参考；要根据原图涂抹处的内容和周围上下文判断：可以修复瑕疵、补全缺失、统一材质/边缘/光影、优化文字或删除异常元素。",
    hasReferenceRegions
      ? "- 如果提供了参考图涂抹区域裁剪图，优先根据裁剪图描述需要迁移到当前原图涂抹区域的细节。"
      : "- 说明要尽量具体，避免只写“优化这里”；需要点明要修复的对象、边缘、纹理、文字、光影或背景融合方式。",
    "- 明确要求保持未涂抹区域不变，包括构图、背景、文字、产品位置、光影、道具和排版。",
    "- 明确要求保持原图尺寸、比例、画布和构图不变，不要裁切、不要缩放、不要扩图、不要改变非涂抹区域像素内容。",
    "- 不要写成整图重绘，不要让模型改变画面整体风格。",
    "- 输出一句或两句中文，适合直接填入“局部修改说明”。",
    "",
    "只返回 JSON：{\"instruction\":\"...\"}",
  ].join("\n");

  const result = await adapter.generateStructured({
    model,
    systemPrompt: "Return strict JSON only. No markdown.",
    userPrompt,
    schema: inpaintInstructionSchema,
    images: imageInputs,
    timeoutMs: 90000,
    monitor: {
      operation: "toolbox_local_repaint_instruction",
    },
  });

  return {
    instruction: result.parsed.instruction.trim(),
    usedModel: model,
  };
}

async function runToolboxLocalRepaintTask(taskId: string, input: ToolboxLocalRepaintInput) {
  const record = await findLocalRepaintRecordByTaskId(taskId);

  try {
    await startTask(taskId, { currentStep: "running" });
    if (record) {
      await updateLocalRepaintRecord(record.id, { status: "RUNNING" });
    }

    const result = await runImageEditModel(input);
    if (record) {
      await updateLocalRepaintRecord(record.id, {
        status: "SUCCESS",
        outputImagePath: result.outputImagePath,
        prompt: result.prompt,
        model: result.model,
        metadata: {
          revisedPrompt: result.revisedPrompt ?? "",
          updatedAt: result.updatedAt,
        },
      });
    }

    await completeTask(taskId, {
      mode: "toolbox_local_repaint",
      currentStep: "completed",
      imageUrl: result.imageUrl,
      recordId: record?.id ?? null,
      model: result.model,
      revisedPrompt: result.revisedPrompt ?? "",
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (record) {
      await updateLocalRepaintRecord(record.id, {
        status: "FAILED",
        metadata: {
          errorMessage: error instanceof Error ? error.message : "工具箱局部重绘失败",
        },
      });
    }
    await failTask(taskId, error instanceof Error ? error.message : "工具箱局部重绘失败");
  }
}

export async function createToolboxLocalRepaintTask(
  input: ToolboxLocalRepaintInput,
  credentials: RequestProviderCredentials,
) {
  const systemProject = await ensureSystemTaskProject();
  const task = await createTask({
    projectId: systemProject.id,
    taskType: resolveTaskType("TOOLBOX_LOCAL_REPAINT", "REGENERATE"),
    status: "PENDING",
    inputPayload: {
      mode: "toolbox_local_repaint",
      hasMask: Boolean(input.mask),
      editInstruction: input.editInstruction,
      referenceImageCount: input.referenceImages?.length ?? 0,
      referenceCropImageCount: input.referenceCropImages?.length ?? 0,
    },
    outputPayload: {
      mode: "toolbox_local_repaint",
      currentStep: "queued",
    },
  });
  await createLocalRepaintRecord({
    sourceInput: input,
    status: "PENDING",
    taskId: task.id,
  });

  runTaskInBackground(() => runWithProviderCredentials(credentials, () => runToolboxLocalRepaintTask(task.id, input)));
  return getTask(task.id);
}

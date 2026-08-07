import { Prisma, TaskType } from "@prisma/client";
import type { ImageGenerationResult } from "@/lib/ai/provider-client";
import sharp from "sharp";
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
const outpaintMaxCanvasSide = 2048;
const FEATHER_RADIUS = 24;

function resolveTaskType(preferred: string, fallback: string) {
  const inlineSchema = (prisma as typeof prisma & { _engineConfig?: { inlineSchema?: string } })._engineConfig?.inlineSchema;
  return (typeof inlineSchema === "string" && inlineSchema.includes(preferred) ? preferred : fallback) as TaskType;
}

function toolboxRecordClient() {
  const client = (prisma as typeof prisma & {
    toolboxGenerationRecord?: typeof prisma.toolboxGenerationRecord;
  }).toolboxGenerationRecord;
  if (!client) {
    throw new Error("Prisma Client 尚未加载工具箱生成记录模型，请重启开发服务并确认已执行 npm run prisma:generate。");
  }
  return client;
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

export type ToolboxGenerationResult = ToolboxLocalRepaintResult;

export type ToolboxOutpaintInput = {
  image: string;
  prompt?: string;
  expand: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type ToolboxImageToImageInput = {
  prompt?: string;
  referenceImages: string[];
};

export type ToolboxProductSceneInput = {
  productImage: string;
  prompt?: string;
  sceneImages?: string[];
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

const edgeAnalysisSchema = z.object({
  top: z.string().optional().nullable().describe("What objects, colors, textures, structures are cut off at the top edge"),
  right: z.string().optional().nullable().describe("What objects, colors, textures, structures are cut off at the right edge"),
  bottom: z.string().optional().nullable().describe("What objects, colors, textures, structures are cut off at the bottom edge"),
  left: z.string().optional().nullable().describe("What objects, colors, textures, structures are cut off at the left edge"),
  overallScene: z.string().describe("Brief description of the overall scene, subject, and lighting"),
  humanGuidance: z.string().optional().nullable().describe("If human body parts are visible, describe which parts and how they should naturally extend"),
});
type EdgeAnalysis = z.infer<typeof edgeAnalysisSchema>;

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

function getImageGenerationModels(provider: Awaited<ReturnType<typeof getProviderAdapter>>["provider"]) {
  return unique([
    provider.models.find((item) => item.isDefaultHeroImage)?.modelId,
    provider.models.find((item) => item.isDefaultDetailImage)?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).image_gen))?.modelId,
    provider.models.find((item) => Boolean((item.capabilities as Record<string, boolean>).image_edit))?.modelId,
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

async function saveToolboxPngBuffer(buffer: Buffer, prefix: string) {
  return saveToolboxGeneratedImage({
    source: {
      b64Json: buffer.toString("base64"),
      mimeType: "image/png",
    },
    prefix,
  });
}

function dataUrlToImageBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("图片数据格式不正确。");
  }

  return {
    mimeType: match[1]!,
    buffer: Buffer.from(match[2]!, "base64"),
  };
}

function bufferToPngDataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function imageResultToBuffer(result: ImageGenerationResult) {
  if (result.b64Json) {
    return Buffer.from(result.b64Json, "base64");
  }

  if (result.url) {
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error(`扩图结果下载失败：${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error("图像模型没有返回可用图片。");
}

function getOutpaintEditSize(width: number, height: number) {
  const ratio = width / Math.max(height, 1);
  const candidates = [
    { size: "1024x1024", ratio: 1 },
    { size: "1536x1024", ratio: 1.5 },
    { size: "1024x1536", ratio: 1 / 1.5 },
  ];
  return candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(Math.log(ratio / candidate.ratio)),
    }))
    .sort((a, b) => a.distance - b.distance)[0]!.size;
}

function summarizeOutpaintFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown outpaint error";
  if (/monthly spending limit|spending limit|billing|quota/i.test(detail)) {
    return "当前 API Key 的智能扩图额度已用尽。请前往代理商控制台提高或移除月度限额，或更换可用的 API Key。";
  }
  if (/timed out|aborterror|network error|fetch failed|gateway-timeout|gateway time-out|504/i.test(detail)) {
    return "当前 Provider 请求超时或网络异常，请稍后重试。";
  }
  if (/bad_response_status_code|openai_error|422/i.test(detail)) {
    return `当前 Provider 的图片编辑通道没有正确支持 multipart mask 扩图请求。智能扩图需要 /images/edits 同时接收 image 和 mask；请更换支持该能力的 Provider，或让当前 Provider 修复 gpt-image 系列图片编辑通道。原因摘要：${detail}`;
  }
  if (/model_not_found|No available channel/i.test(detail)) {
    return `当前 Provider 没有为候选图片编辑模型开放可用通道。请在 Provider 后台开通真实图片编辑能力，或切换到支持 /images/edits + mask 的模型。原因摘要：${detail}`;
  }
  return `当前 Provider 没有可用的真实扩图能力，或不支持 multipart mask 图片编辑。智能扩图不会使用普通生成兜底，以避免裁剪原图。原因摘要：${detail}`;
}

async function createSolidPng(params: {
  width: number;
  height: number;
  background: { r: number; g: number; b: number; alpha: number };
}) {
  return sharp({
    create: {
      width: params.width,
      height: params.height,
      channels: 4,
      background: params.background,
    },
  })
    .png()
    .toBuffer();
}

async function prepareOutpaintEditAssets(input: ToolboxOutpaintInput) {
  const normalizedImage = await imageUrlToDataUrl(input.image);
  const { buffer: sourceBuffer } = dataUrlToImageBuffer(normalizedImage);
  const metadata = await sharp(sourceBuffer).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("无法读取原图尺寸，请换一张图片重试。");
  }

  const expand = {
    top: normalizePercent(input.expand.top),
    right: normalizePercent(input.expand.right),
    bottom: normalizePercent(input.expand.bottom),
    left: normalizePercent(input.expand.left),
  };

  if (expand.top + expand.right + expand.bottom + expand.left <= 0) {
    throw new Error("请至少选择一个方向进行扩图。");
  }

  const rawExpandPixels = {
    top: Math.round(sourceHeight * expand.top / 100),
    right: Math.round(sourceWidth * expand.right / 100),
    bottom: Math.round(sourceHeight * expand.bottom / 100),
    left: Math.round(sourceWidth * expand.left / 100),
  };
  const rawTargetWidth = sourceWidth + rawExpandPixels.left + rawExpandPixels.right;
  const rawTargetHeight = sourceHeight + rawExpandPixels.top + rawExpandPixels.bottom;
  const scale = Math.min(1, outpaintMaxCanvasSide / Math.max(rawTargetWidth, rawTargetHeight));
  const source = {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
  const expandPixels = {
    top: Math.max(0, Math.round(rawExpandPixels.top * scale)),
    right: Math.max(0, Math.round(rawExpandPixels.right * scale)),
    bottom: Math.max(0, Math.round(rawExpandPixels.bottom * scale)),
    left: Math.max(0, Math.round(rawExpandPixels.left * scale)),
  };
  const target = {
    width: source.width + expandPixels.left + expandPixels.right,
    height: source.height + expandPixels.top + expandPixels.bottom,
  };
  const sourcePng = await sharp(sourceBuffer)
    .resize(source.width, source.height, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  const canvas = await sharp({
    create: {
      width: target.width,
      height: target.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: sourcePng, left: expandPixels.left, top: expandPixels.top }])
    .png()
    .toBuffer();
  const opaqueOriginalRegion = await createSolidPng({
    width: source.width,
    height: source.height,
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  });
  const mask = await sharp({
    create: {
      width: target.width,
      height: target.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: opaqueOriginalRegion, left: expandPixels.left, top: expandPixels.top }])
    .png()
    .toBuffer();

  return {
    expand,
    source,
    target,
    sourcePng,
    canvas,
    mask,
    offset: {
      left: expandPixels.left,
      top: expandPixels.top,
    },
    editSize: getOutpaintEditSize(target.width, target.height),
    scaled: scale < 1,
  };
}

async function createFeatherMask(width: number, height: number, featherRadius: number): Promise<Buffer> {
  const r = Math.max(1, Math.round(featherRadius));
  const shrink = r * 2;
  const innerW = Math.max(4, width - shrink * 2);
  const innerH = Math.max(4, height - shrink * 2);

  const inner = await sharp({
    create: { width: innerW, height: innerH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();

  const canvas = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: inner, left: shrink, top: shrink }])
    .png()
    .toBuffer();

  return sharp(canvas).blur(r).png().toBuffer();
}

async function finalizeOutpaintResult(
  result: ImageGenerationResult,
  assets: Awaited<ReturnType<typeof prepareOutpaintEditAssets>>,
  featherRadius: number = FEATHER_RADIUS,
) {
  const resultBuffer = await imageResultToBuffer(result);
  const resolved = sharp(resultBuffer).resize(assets.target.width, assets.target.height, { fit: "fill" });

  if (featherRadius <= 0) {
    return resolved
      .composite([{ input: assets.sourcePng, left: assets.offset.left, top: assets.offset.top }])
      .png()
      .toBuffer();
  }

  const mask = await createFeatherMask(assets.source.width, assets.source.height, featherRadius);
  const featheredSource = await sharp(assets.sourcePng)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  return resolved
    .composite([{ input: featheredSource, left: assets.offset.left, top: assets.offset.top }])
    .png()
    .toBuffer();
}

async function createToolboxRecord(input: {
  toolType: "OUTPAINT" | "IMAGE_TO_IMAGE" | "PRODUCT_SCENE";
  sourceImage?: string | null;
  prompt?: string | null;
  model?: string | null;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  taskId?: string | null;
  outputImagePath?: string | null;
  references?: Prisma.InputJsonValue;
  metadata?: Record<string, unknown>;
}) {
  const sourceImage = input.sourceImage
    ? await saveToolboxInputImage({ image: input.sourceImage, prefix: `toolbox-${input.toolType.toLowerCase()}` })
    : { filePath: null };
  return toolboxRecordClient().create({
    data: {
      toolType: input.toolType,
      taskId: input.taskId ?? null,
      status: input.status,
      inputImagePath: sourceImage.filePath,
      outputImagePath: input.outputImagePath ?? null,
      prompt: input.prompt ?? null,
      model: input.model ?? null,
      references: input.references ?? {},
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

async function findToolboxRecordByTaskId(
  taskId: string,
  toolType: "OUTPAINT" | "IMAGE_TO_IMAGE" | "PRODUCT_SCENE",
) {
  return toolboxRecordClient().findFirst({
    where: { taskId, toolType },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

async function updateToolboxRecord(
  recordId: string,
  input: {
    status?: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
    outputImagePath?: string | null;
    prompt?: string | null;
    model?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await toolboxRecordClient().update({
    where: { id: recordId },
    data: {
      status: input.status,
      outputImagePath: input.outputImagePath,
      prompt: input.prompt,
      model: input.model,
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}

async function runImageGenerationModel(input: {
  prompt: string;
  referenceImages?: string[];
  operation: string;
}): Promise<ToolboxGenerationResult & { outputImagePath: string; prompt: string }> {
  const { provider, adapter } = await getProviderAdapter();
  const models = getImageGenerationModels(provider);
  const referenceImages = await Promise.all((input.referenceImages ?? []).map((image) => imageUrlToDataUrl(image)));
  const errors: string[] = [];

  for (const model of models) {
    try {
      const result = await adapter.generateImage({
        model,
        prompt: input.prompt,
        referenceImages,
        timeoutMs: 180000,
        monitor: {
          operation: input.operation,
        },
      });
      const saved = await saveToolboxResult(result);
      return {
        imageUrl: saved.url,
        outputImagePath: saved.filePath,
        prompt: input.prompt,
        model,
        revisedPrompt: result.revisedPrompt ?? "",
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  throw new Error(models.length === 0 ? "当前没有可用的图片生成模型。" : `所有可用图片模型都生成失败：${errors.join(" | ")}`);
}

async function analyzeOutpaintEdges(
  sourceImageBuffer: Buffer,
  expand: { top: number; right: number; bottom: number; left: number },
): Promise<EdgeAnalysis | null> {
  try {
    const { provider, adapter } = await getProviderAdapter();
    const models = getVisionTextModels(provider);
    const model = models[0] ?? null;
    if (!model) return null;

    const expandingEdges = [
      expand.top > 0 ? "top" : null,
      expand.right > 0 ? "right" : null,
      expand.bottom > 0 ? "bottom" : null,
      expand.left > 0 ? "left" : null,
    ].filter(Boolean) as string[];

    if (expandingEdges.length === 0) return null;

    const analysisImage = await sharp(sourceImageBuffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const userPrompt = [
      "You are an image analysis assistant. The user wants to expand this image outward.",
      "Edges to expand: " + expandingEdges.join(", ") + ".",
      "",
      "=== INSTRUCTIONS ===",
      "For each edge that needs expansion, carefully observe what is visible right at that boundary:",
      "1. What objects, structures, or elements are partially cut off at each edge? How should they continue?",
      "2. What colors, gradients, lighting direction, and color temperature exist at each edge?",
      "3. What textures and patterns (floor, wall, fabric, sky, water, etc.) are at each edge? How should they repeat/extend?",
      "4. Are there perspective guides, horizon lines, shadows, or reflections at the edges? Describe their direction and intensity.",
      "5. overallScene: Describe the overall scene, subject, and lighting conditions briefly.",
      "6. humanGuidance: If human body parts (hands, arms, legs, head, body) are visible, describe exactly which parts are present, their pose, and how they should naturally extend beyond the edges. Emphasize anatomical correctness.",
      "",
      "Only describe edges that are being expanded. Skip edges with no expansion.",
      "Be specific and actionable — the description will be passed directly to an image generation model.",
      "Return ONLY JSON.",
    ].join("\n");

    const result = await adapter.generateStructured({
      model,
      systemPrompt: "Return strict JSON only. No markdown.",
      userPrompt,
      schema: edgeAnalysisSchema,
      images: [bufferToPngDataUrl(analysisImage)],
      timeoutMs: 30000,
      monitor: { operation: "toolbox_outpaint_edge_analysis" },
    });

    return result.parsed;
  } catch {
    return null;
  }
}

async function runOutpaintEditModel(input: ToolboxOutpaintInput): Promise<ToolboxGenerationResult & {
  outputImagePath: string;
  prompt: string;
  metadata: Record<string, unknown>;
}> {
  const { provider, adapter } = await getProviderAdapter();
  const models = getImageEditModels(provider);
  const assets = await prepareOutpaintEditAssets(input);
  const edgeAnalysis = await analyzeOutpaintEdges(assets.sourcePng, assets.expand);
  const prompt = buildOutpaintPrompt(input, edgeAnalysis);
  const errors: string[] = [];

  for (const model of models) {
    try {
      const result = await adapter.editImage({
        model,
        image: bufferToPngDataUrl(assets.canvas),
        mask: bufferToPngDataUrl(assets.mask),
        prompt,
        size: assets.editSize,
        timeoutMs: 180000,
        monitor: {
          operation: "toolbox_outpaint",
        },
      });
      const finalized = await finalizeOutpaintResult(result, assets);
      const saved = await saveToolboxPngBuffer(finalized, "outpaint");
      const updatedAt = new Date().toISOString();

      return {
        imageUrl: saved.url,
        outputImagePath: saved.filePath,
        prompt,
        model,
        revisedPrompt: result.revisedPrompt ?? "",
        updatedAt,
        metadata: {
          revisedPrompt: result.revisedPrompt ?? "",
          updatedAt,
          realOutpaint: true,
          protectedOriginalPixels: true,
          editSize: assets.editSize,
          sourceSize: assets.source,
          outputSize: assets.target,
          sourceOffset: assets.offset,
          scaledForEdit: assets.scaled,
          expand: assets.expand,
        },
      };
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  throw new Error(models.length === 0 ? "当前没有可用的图片编辑模型。" : summarizeOutpaintFailure(new Error(errors.join(" | "))));
}

function normalizePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildOutpaintPrompt(input: ToolboxOutpaintInput, edgeAnalysis?: EdgeAnalysis | null) {
  const expand = {
    top: normalizePercent(input.expand.top),
    right: normalizePercent(input.expand.right),
    bottom: normalizePercent(input.expand.bottom),
    left: normalizePercent(input.expand.left),
  };

  const parts: string[] = [
    "You are an expert outpainting assistant. Your task is to intelligently expand this image outward.",
    "",
    "=== SETUP ===",
    "The uploaded image contains the original image centered on a larger transparent canvas. A binary mask defines which areas need filling (transparent = paint here, opaque = keep as-is).",
    `Expansion requested: top ${expand.top}%, right ${expand.right}%, bottom ${expand.bottom}%, left ${expand.left}% relative to the original.`,
    "",
  ];

  if (edgeAnalysis?.overallScene) {
    parts.push(
      "=== SCENE CONTEXT (pre-analyzed by AI vision) ===",
      `Scene: ${edgeAnalysis.overallScene}`,
    );
  }

  if (edgeAnalysis?.humanGuidance) {
    parts.push(
      "=== HUMAN ANATOMY GUIDANCE ===",
      "This image contains human body parts. Follow these rules strictly:",
      `${edgeAnalysis.humanGuidance}`,
      "- Every finger must have exactly 3 joints and end with a clean, natural fingertip. Do not merge, twist, stretch, or multiply fingers.",
      "- Count the fingers at each hand edge and generate exactly the same count continuing naturally.",
      "- Hands must maintain natural human proportions, curvature, and skin tone matching the original.",
      "- Never generate extra fingers, fused fingers, impossible poses, or distorted hand shapes.",
      "- If an arm/hand is partially visible, continue the pose organically — do not break wrist joints or snap rotations.",
    );
  } else {
    parts.push(
      "=== HUMAN ANATOMY CAUTION ===",
      "If any human body parts (hands, arms, feet, face) are visible in the original image, pay extreme attention:",
      "- Fingers must each have 3 joints, natural curvature, and correct count — never fuse, twist, duplicate, or deform fingers.",
      "- Hands must maintain proper human proportions and anatomical structure.",
      "- Continue any visible limbs with natural pose continuation — no joint snapping or impossible angles.",
    );
  }

  if (edgeAnalysis) {
    const edgeParts: string[] = [];
    if (expand.top > 0 && edgeAnalysis.top) edgeParts.push(`- TOP edge: ${edgeAnalysis.top}`);
    if (expand.right > 0 && edgeAnalysis.right) edgeParts.push(`- RIGHT edge: ${edgeAnalysis.right}`);
    if (expand.bottom > 0 && edgeAnalysis.bottom) edgeParts.push(`- BOTTOM edge: ${edgeAnalysis.bottom}`);
    if (expand.left > 0 && edgeAnalysis.left) edgeParts.push(`- LEFT edge: ${edgeAnalysis.left}`);
    if (edgeParts.length > 0) {
      parts.push(
        "=== EDGE-BY-EDGE CONTENT TO EXTEND ===",
        "The following was pre-analyzed by AI vision. Use this as authoritative guidance for what to generate at each edge:",
        ...edgeParts,
        "",
      );
    }
  }

  parts.push(
    "=== CRITICAL: CONTENT-AWARE EDGE CONTINUATION ===",
    "Your generated content MUST continue these elements seamlessly:",
    "- Objects, products, or subjects that are partially cut off at an edge → extend their full shape",
    "- Background gradients, colors, and lighting → continue the exact same gradient angle, color temperature, and falloff",
    "- Textures and patterns (floor, wall, fabric, sky, water, etc.) → repeat/extend with the same scale and direction",
    "- Structural lines, horizon lines, perspective guides → extend along the same geometric trajectory",
    "- Shadows and reflections → continue with matching direction, softness, and density",
    "- Depth of field → the extended area should have the same focal plane and blur characteristics",
    "",
    "=== EXECUTION RULES ===",
    "1. First, observe each edge: what colors, objects, textures, and structures are present RIGHT AT the boundary.",
    "2. Extend those exact elements outward — do not invent new elements unrelated to the edge content.",
    "3. Match colors EXACTLY at the boundary — any color shift will be immediately visible as a seam.",
    "4. Blend seamlessly: the transition from original to generated must be invisible.",
    "5. Preserve the original image region 100% — do not alter, recolor, or blur the protected area.",
    "6. Do not crop, zoom, rotate, distort, reframe, or redesign the original.",
  );

  if (input.prompt?.trim()) {
    parts.push(`USER GUIDANCE: ${input.prompt.trim()}`);
  }

  parts.push("Return the full expanded canvas as a single natural image.");
  return parts.join("\n");
}

function buildImageToImagePrompt(input: ToolboxImageToImageInput) {
  return [
    "Create a new image inspired by the uploaded reference image(s).",
    "Analyze the subject, product identity, materials, colors, visual style, camera angle, composition and lighting from the references.",
    input.prompt?.trim()
      ? `User request: ${input.prompt.trim()}`
      : "No explicit user request was provided. Create a high-quality commercially useful variation with a coherent new scene, angle, composition, or action while preserving the recognizable subject identity from the references.",
    "Do not merely duplicate the reference. Produce a fresh image that follows the user's intent and keeps important product details accurate.",
  ].filter(Boolean).join("\n");
}

function buildProductScenePrompt(input: ToolboxProductSceneInput) {
  return [
    "Generate a commercial product scene image.",
    "The first uploaded image is the product identity reference. Preserve the product shape, proportions, material, color, logo/text details when visible, and key distinguishing features.",
    (input.sceneImages?.length ?? 0) > 0
      ? `Additional uploaded scene reference image count: ${input.sceneImages?.length}. Use them as environment, mood, lighting, camera and styling references, not as product replacements.`
      : "No scene reference image was uploaded. Infer a suitable professional scene from the product and user request.",
    input.prompt?.trim()
      ? `User scene instruction: ${input.prompt.trim()}`
      : "Create a clean, realistic, conversion-oriented scene that naturally presents the product.",
    "Keep the product realistic and prominent. The scene should support the product rather than overwhelm it.",
  ].filter(Boolean).join("\n");
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

  return toolboxRecordClient().create({
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
  return toolboxRecordClient().findFirst({
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
  await toolboxRecordClient().update({
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

export async function runToolboxOutpaint(input: ToolboxOutpaintInput) {
  if (!input.image) {
    throw new Error("请先上传一张需要扩图的原图。");
  }

  const result = await runOutpaintEditModel(input);
  const record = await createToolboxRecord({
    toolType: "OUTPAINT",
    sourceImage: input.image,
    prompt: result.prompt,
    model: result.model,
    status: "SUCCESS",
    outputImagePath: result.outputImagePath,
    references: {
      expand: {
        top: normalizePercent(input.expand.top),
        right: normalizePercent(input.expand.right),
        bottom: normalizePercent(input.expand.bottom),
        left: normalizePercent(input.expand.left),
      },
    } satisfies Prisma.InputJsonValue,
    metadata: result.metadata,
  });

  return {
    imageUrl: result.imageUrl,
    recordId: record.id,
    model: result.model,
    revisedPrompt: result.revisedPrompt,
    updatedAt: result.updatedAt,
  };
}

async function runToolboxOutpaintTask(taskId: string, input: ToolboxOutpaintInput) {
  const record = await findToolboxRecordByTaskId(taskId, "OUTPAINT");
  try {
    await startTask(taskId, { currentStep: "running" });
    if (record) await updateToolboxRecord(record.id, { status: "RUNNING" });
    const result = await runOutpaintEditModel(input);
    if (record) {
      await updateToolboxRecord(record.id, {
        status: "SUCCESS",
        outputImagePath: result.outputImagePath,
        prompt: result.prompt,
        model: result.model,
        metadata: result.metadata,
      });
    }
    await completeTask(taskId, {
      mode: "toolbox_outpaint",
      currentStep: "completed",
      imageUrl: result.imageUrl,
      recordId: record?.id ?? null,
      model: result.model,
      revisedPrompt: result.revisedPrompt ?? "",
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (record) {
      await updateToolboxRecord(record.id, {
        status: "FAILED",
        metadata: { errorMessage: error instanceof Error ? error.message : "智能扩图失败" },
      });
    }
    await failTask(taskId, error instanceof Error ? error.message : "智能扩图失败");
  }
}

export async function createToolboxOutpaintTask(input: ToolboxOutpaintInput, credentials: RequestProviderCredentials) {
  const systemProject = await ensureSystemTaskProject();
  const task = await createTask({
    projectId: systemProject.id,
    taskType: resolveTaskType("TOOLBOX_OUTPAINT", "REGENERATE"),
    status: "PENDING",
    inputPayload: {
      mode: "toolbox_outpaint",
      hasImage: Boolean(input.image),
      expand: input.expand,
      prompt: input.prompt ?? "",
    },
    outputPayload: {
      mode: "toolbox_outpaint",
      currentStep: "queued",
    },
  });
  await createToolboxRecord({
    toolType: "OUTPAINT",
    sourceImage: input.image,
    status: "PENDING",
    taskId: task.id,
    prompt: buildOutpaintPrompt(input),
    references: { expand: input.expand } satisfies Prisma.InputJsonValue,
  });
  runTaskInBackground(() => runWithProviderCredentials(credentials, () => runToolboxOutpaintTask(task.id, input)));
  return getTask(task.id);
}

export async function runToolboxImageToImage(input: ToolboxImageToImageInput) {
  if ((input.referenceImages?.length ?? 0) === 0 && !input.prompt?.trim()) {
    throw new Error("请上传至少一张参考图，或填写生成要求。");
  }

  const prompt = buildImageToImagePrompt(input);
  const result = await runImageGenerationModel({
    prompt,
    referenceImages: input.referenceImages,
    operation: "toolbox_image_to_image",
  });
  const record = await createToolboxRecord({
    toolType: "IMAGE_TO_IMAGE",
    sourceImage: input.referenceImages[0] ?? null,
    prompt: result.prompt,
    model: result.model,
    status: "SUCCESS",
    outputImagePath: result.outputImagePath,
    references: { referenceImageCount: input.referenceImages.length } satisfies Prisma.InputJsonValue,
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

async function runToolboxImageToImageTask(taskId: string, input: ToolboxImageToImageInput) {
  const record = await findToolboxRecordByTaskId(taskId, "IMAGE_TO_IMAGE");
  try {
    await startTask(taskId, { currentStep: "running" });
    if (record) await updateToolboxRecord(record.id, { status: "RUNNING" });
    const result = await runImageGenerationModel({
      prompt: buildImageToImagePrompt(input),
      referenceImages: input.referenceImages,
      operation: "toolbox_image_to_image",
    });
    if (record) {
      await updateToolboxRecord(record.id, {
        status: "SUCCESS",
        outputImagePath: result.outputImagePath,
        prompt: result.prompt,
        model: result.model,
        metadata: { revisedPrompt: result.revisedPrompt ?? "", updatedAt: result.updatedAt },
      });
    }
    await completeTask(taskId, {
      mode: "toolbox_image_to_image",
      currentStep: "completed",
      imageUrl: result.imageUrl,
      recordId: record?.id ?? null,
      model: result.model,
      revisedPrompt: result.revisedPrompt ?? "",
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (record) {
      await updateToolboxRecord(record.id, {
        status: "FAILED",
        metadata: { errorMessage: error instanceof Error ? error.message : "以图生图失败" },
      });
    }
    await failTask(taskId, error instanceof Error ? error.message : "以图生图失败");
  }
}

export async function createToolboxImageToImageTask(input: ToolboxImageToImageInput, credentials: RequestProviderCredentials) {
  const systemProject = await ensureSystemTaskProject();
  const task = await createTask({
    projectId: systemProject.id,
    taskType: resolveTaskType("TOOLBOX_IMAGE_TO_IMAGE", "REGENERATE"),
    status: "PENDING",
    inputPayload: {
      mode: "toolbox_image_to_image",
      prompt: input.prompt ?? "",
      referenceImageCount: input.referenceImages.length,
    },
    outputPayload: {
      mode: "toolbox_image_to_image",
      currentStep: "queued",
    },
  });
  await createToolboxRecord({
    toolType: "IMAGE_TO_IMAGE",
    sourceImage: input.referenceImages[0] ?? null,
    status: "PENDING",
    taskId: task.id,
    prompt: buildImageToImagePrompt(input),
    references: { referenceImageCount: input.referenceImages.length } satisfies Prisma.InputJsonValue,
  });
  runTaskInBackground(() => runWithProviderCredentials(credentials, () => runToolboxImageToImageTask(task.id, input)));
  return getTask(task.id);
}

export async function runToolboxProductScene(input: ToolboxProductSceneInput) {
  if (!input.productImage) {
    throw new Error("请先上传一张产品图。");
  }

  const prompt = buildProductScenePrompt(input);
  const referenceImages = [input.productImage, ...(input.sceneImages ?? [])];
  const result = await runImageGenerationModel({
    prompt,
    referenceImages,
    operation: "toolbox_product_scene",
  });
  const record = await createToolboxRecord({
    toolType: "PRODUCT_SCENE",
    sourceImage: input.productImage,
    prompt: result.prompt,
    model: result.model,
    status: "SUCCESS",
    outputImagePath: result.outputImagePath,
    references: { sceneImageCount: input.sceneImages?.length ?? 0 } satisfies Prisma.InputJsonValue,
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

async function runToolboxProductSceneTask(taskId: string, input: ToolboxProductSceneInput) {
  const record = await findToolboxRecordByTaskId(taskId, "PRODUCT_SCENE");
  try {
    await startTask(taskId, { currentStep: "running" });
    if (record) await updateToolboxRecord(record.id, { status: "RUNNING" });
    const result = await runImageGenerationModel({
      prompt: buildProductScenePrompt(input),
      referenceImages: [input.productImage, ...(input.sceneImages ?? [])],
      operation: "toolbox_product_scene",
    });
    if (record) {
      await updateToolboxRecord(record.id, {
        status: "SUCCESS",
        outputImagePath: result.outputImagePath,
        prompt: result.prompt,
        model: result.model,
        metadata: { revisedPrompt: result.revisedPrompt ?? "", updatedAt: result.updatedAt },
      });
    }
    await completeTask(taskId, {
      mode: "toolbox_product_scene",
      currentStep: "completed",
      imageUrl: result.imageUrl,
      recordId: record?.id ?? null,
      model: result.model,
      revisedPrompt: result.revisedPrompt ?? "",
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (record) {
      await updateToolboxRecord(record.id, {
        status: "FAILED",
        metadata: { errorMessage: error instanceof Error ? error.message : "商品换场景失败" },
      });
    }
    await failTask(taskId, error instanceof Error ? error.message : "商品换场景失败");
  }
}

export async function createToolboxProductSceneTask(input: ToolboxProductSceneInput, credentials: RequestProviderCredentials) {
  const systemProject = await ensureSystemTaskProject();
  const task = await createTask({
    projectId: systemProject.id,
    taskType: resolveTaskType("TOOLBOX_PRODUCT_SCENE", "REGENERATE"),
    status: "PENDING",
    inputPayload: {
      mode: "toolbox_product_scene",
      prompt: input.prompt ?? "",
      hasProductImage: Boolean(input.productImage),
      sceneImageCount: input.sceneImages?.length ?? 0,
    },
    outputPayload: {
      mode: "toolbox_product_scene",
      currentStep: "queued",
    },
  });
  await createToolboxRecord({
    toolType: "PRODUCT_SCENE",
    sourceImage: input.productImage,
    status: "PENDING",
    taskId: task.id,
    prompt: buildProductScenePrompt(input),
    references: { sceneImageCount: input.sceneImages?.length ?? 0 } satisfies Prisma.InputJsonValue,
  });
  runTaskInBackground(() => runWithProviderCredentials(credentials, () => runToolboxProductSceneTask(task.id, input)));
  return getTask(task.id);
}

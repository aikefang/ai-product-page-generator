import { z } from "zod";

import { contentLanguageOptions } from "@/lib/utils/content-language";

const MAX_REFERENCE_CROP_IMAGE_LENGTH = 3 * 1024 * 1024;
const referenceCropImageSchema = z
  .string()
  .startsWith("data:image/")
  .max(MAX_REFERENCE_CROP_IMAGE_LENGTH, "参考图局部裁剪图过大，请缩小涂抹区域或重新生成修改说明。");

export const generationRequestSchema = z.object({
  modelId: z.string().optional().nullable(),
  referenceAssetIds: z.array(z.string()).optional().default([]),
  editMode: z.enum(["repaint", "enhance", "translate", "inpaint"]).optional().default("repaint"),
  targetLanguage: z.enum(contentLanguageOptions).optional(),
  mask: z.string().startsWith("data:image/").optional(),
  editInstruction: z.string().trim().max(1200).optional(),
  referenceCropImages: z.array(referenceCropImageSchema).max(12).optional().default([]),
});

export const inpaintInstructionRequestSchema = z.object({
  baseMask: z.string().startsWith("data:image/"),
  basePreviewImage: z.string().startsWith("data:image/").optional().nullable(),
  references: z
    .array(
      z.object({
        assetId: z.string().min(1),
        mask: z.string().startsWith("data:image/"),
        previewImage: z.string().startsWith("data:image/").optional().nullable(),
        cropImage: referenceCropImageSchema.optional().nullable(),
      }),
    )
    .max(12)
    .optional()
    .default([]),
});

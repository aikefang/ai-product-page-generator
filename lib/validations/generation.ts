import { z } from "zod";

import { contentLanguageOptions } from "@/lib/utils/content-language";

export const generationRequestSchema = z.object({
  modelId: z.string().optional().nullable(),
  referenceAssetIds: z.array(z.string()).optional().default([]),
  editMode: z.enum(["repaint", "enhance", "translate", "inpaint"]).optional().default("repaint"),
  targetLanguage: z.enum(contentLanguageOptions).optional(),
  mask: z.string().startsWith("data:image/").optional(),
  editInstruction: z.string().trim().max(1200).optional(),
  referenceCropImages: z.array(z.string().startsWith("data:image/")).max(12).optional().default([]),
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
        cropImage: z.string().startsWith("data:image/").optional().nullable(),
      }),
    )
    .min(1)
    .max(12),
});

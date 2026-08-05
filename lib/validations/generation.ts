import { z } from "zod";

import { contentLanguageOptions } from "@/lib/utils/content-language";

export const generationRequestSchema = z.object({
  modelId: z.string().optional().nullable(),
  referenceAssetIds: z.array(z.string()).optional().default([]),
  editMode: z.enum(["repaint", "enhance", "translate", "inpaint"]).optional().default("repaint"),
  targetLanguage: z.enum(contentLanguageOptions).optional(),
  mask: z.string().startsWith("data:image/").optional(),
  editInstruction: z.string().trim().max(1200).optional(),
});

import { NextRequest } from "next/server";
import { z } from "zod";

import { generateToolboxLocalRepaintInstruction } from "@/lib/services/toolbox-service";
import { withProviderCredentials } from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";

export const maxDuration = 120;

const dataImageSchema = z.string().startsWith("data:image/");

const requestSchema = z.object({
  image: z.string().min(1),
  baseMask: dataImageSchema,
  basePreviewImage: dataImageSchema.optional().nullable(),
  references: z
    .array(
      z.object({
        image: z.string().min(1),
        mask: dataImageSchema,
        previewImage: dataImageSchema.optional().nullable(),
        cropImage: dataImageSchema.max(3 * 1024 * 1024).optional().nullable(),
      }),
    )
    .max(12)
    .optional()
    .default([]),
});

export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json());
      const result = await generateToolboxLocalRepaintInstruction(input);
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

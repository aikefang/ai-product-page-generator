import { NextRequest } from "next/server";
import { z } from "zod";

import {
  createToolboxLocalRepaintTask,
  runToolboxLocalRepaint,
} from "@/lib/services/toolbox-service";
import {
  readProviderCredentialsFromRequest,
  withProviderCredentials,
} from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";

export const maxDuration = 180;

const dataImageSchema = z.string().startsWith("data:image/");

const requestSchema = z.object({
  executionMode: z.enum(["sync", "background"]).optional().default("sync"),
  image: z.string().min(1),
  mask: dataImageSchema,
  editInstruction: z.string().trim().min(2).max(1200),
  referenceImages: z.array(z.string().min(1)).max(12).optional().default([]),
  referenceCropImages: z.array(dataImageSchema.max(3 * 1024 * 1024)).max(12).optional().default([]),
});

export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json());
      if (input.executionMode === "background") {
        const task = await createToolboxLocalRepaintTask(
          {
            image: input.image,
            mask: input.mask,
            editInstruction: input.editInstruction,
            referenceImages: input.referenceImages,
            referenceCropImages: input.referenceCropImages,
          },
          readProviderCredentialsFromRequest(request),
        );
        return ok(task, { status: 202 });
      }

      const result = await runToolboxLocalRepaint({
        image: input.image,
        mask: input.mask,
        editInstruction: input.editInstruction,
        referenceImages: input.referenceImages,
        referenceCropImages: input.referenceCropImages,
      });
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

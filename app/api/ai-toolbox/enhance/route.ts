import { NextRequest } from "next/server";
import { z } from "zod";

import {
  createToolboxImageEnhanceTask,
  runToolboxImageEnhance,
} from "@/lib/services/toolbox-service";
import {
  readProviderCredentialsFromRequest,
  withProviderCredentials,
} from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";

export const maxDuration = 180;

const requestSchema = z.object({
  executionMode: z.enum(["sync", "background"]).optional().default("sync"),
  image: z.string().min(1),
  prompt: z.string().trim().max(1200).optional().default(""),
  enhancementMode: z.enum(["auto", "clarity", "color", "product", "portrait"]).optional().default("auto"),
  intensity: z.enum(["natural", "balanced", "strong"]).optional().default("balanced"),
});

export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json());
      if (input.executionMode === "background") {
        const task = await createToolboxImageEnhanceTask(input, readProviderCredentialsFromRequest(request));
        return ok(task, { status: 202 });
      }

      const result = await runToolboxImageEnhance(input);
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

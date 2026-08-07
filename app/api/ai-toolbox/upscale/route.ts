import { NextRequest } from "next/server";
import { z } from "zod";

import {
  createToolboxUpscaleTask,
  runToolboxUpscale,
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
  scale: z.union([z.literal(2), z.literal(4)]).optional().default(2),
  detailMode: z.enum(["standard", "product", "text"]).optional().default("standard"),
});

export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json());
      if (input.executionMode === "background") {
        const task = await createToolboxUpscaleTask(input, readProviderCredentialsFromRequest(request));
        return ok(task, { status: 202 });
      }

      const result = await runToolboxUpscale(input);
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

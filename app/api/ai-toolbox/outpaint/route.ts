import { NextRequest } from "next/server";
import { z } from "zod";

import {
  createToolboxOutpaintTask,
  runToolboxOutpaint,
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
  useMask: z.boolean().optional().default(false),
  expand: z.object({
    top: z.number().min(0).max(100),
    right: z.number().min(0).max(100),
    bottom: z.number().min(0).max(100),
    left: z.number().min(0).max(100),
  }),
});

export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json());
      if (input.executionMode === "background") {
        const task = await createToolboxOutpaintTask(input, readProviderCredentialsFromRequest(request));
        return ok(task, { status: 202 });
      }

      const result = await runToolboxOutpaint(input);
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

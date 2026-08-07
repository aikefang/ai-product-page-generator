import { NextRequest } from "next/server";
import { z } from "zod";

import {
  createToolboxImageTranslateTask,
  runToolboxImageTranslate,
} from "@/lib/services/toolbox-service";
import {
  readProviderCredentialsFromRequest,
  withProviderCredentials,
} from "@/lib/services/provider-runtime";
import { contentLanguageOptions } from "@/lib/utils/content-language";
import { handleRouteError, ok } from "@/lib/utils/route";

export const maxDuration = 180;

const requestSchema = z.object({
  executionMode: z.enum(["sync", "background"]).optional().default("sync"),
  image: z.string().min(1),
  targetLanguage: z.enum(contentLanguageOptions),
});

export async function POST(request: NextRequest) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json());
      if (input.executionMode === "background") {
        const task = await createToolboxImageTranslateTask(
          {
            image: input.image,
            targetLanguage: input.targetLanguage,
          },
          readProviderCredentialsFromRequest(request),
        );
        return ok(task, { status: 202 });
      }

      const result = await runToolboxImageTranslate({
        image: input.image,
        targetLanguage: input.targetLanguage,
      });
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

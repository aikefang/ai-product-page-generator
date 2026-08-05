import { NextRequest } from "next/server";

import { generateLocalInpaintInstruction } from "@/lib/services/generation-service";
import { withProviderCredentials } from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";
import { inpaintInstructionRequestSchema } from "@/lib/validations/generation";

export async function POST(
  request: NextRequest,
  context: { params: { id: string; sectionId: string } },
) {
  return withProviderCredentials(request, async () => {
    try {
      const input = inpaintInstructionRequestSchema.parse(await request.json().catch(() => ({})));
      const result = await generateLocalInpaintInstruction(context.params.id, context.params.sectionId, input);
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

import { NextRequest } from "next/server";

import { editSectionImage, startSectionImageEditTask } from "@/lib/services/generation-service";
import { generationRequestSchema } from "@/lib/validations/generation";
import { readProviderCredentialsFromRequest, withProviderCredentials } from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";

export async function POST(
  request: NextRequest,
  context: { params: { id: string; sectionId: string } },
) {
  return withProviderCredentials(request, async () => {
    try {
      const input = generationRequestSchema.parse(await request.json().catch(() => ({})));
      if (input.editMode === "inpaint") {
        const task = await startSectionImageEditTask(context.params.id, context.params.sectionId, {
          preferredModelId: input.modelId,
          referenceAssetIds: input.referenceAssetIds,
          editMode: input.editMode,
          targetLanguage: input.targetLanguage,
          mask: input.mask,
          editInstruction: input.editInstruction,
          referenceCropImages: input.referenceCropImages,
        }, readProviderCredentialsFromRequest(request));
        return ok(task, { status: 202 });
      }

      const result = await editSectionImage(context.params.id, context.params.sectionId, {
        preferredModelId: input.modelId,
        referenceAssetIds: input.referenceAssetIds,
        editMode: input.editMode,
        targetLanguage: input.targetLanguage,
        mask: input.mask,
        editInstruction: input.editInstruction,
        referenceCropImages: input.referenceCropImages,
      });
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}

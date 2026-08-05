import type { PageSection, ProductAsset } from "@prisma/client";

import {
  contentLanguageNamesForPrompt,
  normalizeContentLanguage,
  type ContentLanguage,
} from "@/lib/utils/content-language";

function buildReferenceText(referenceAssets: ProductAsset[]) {
  if (!referenceAssets.length) {
    return "No reference images were provided.";
  }

  return `Reference images: ${referenceAssets.map((item) => item.fileName).join(" / ")}`;
}

function buildMainImageInstruction(referenceAssets: ProductAsset[]) {
  if (!referenceAssets.length) {
    return "If no product image reference is provided, infer the product carefully from the structured analysis and keep the same product identity across all generated sections.";
  }

  return [
    "The uploaded main product image is the source of truth for product identity.",
    "Keep the same product category, shape, material, color family, proportions, grid/layer structure, moving parts, and key recognisable details across every generated hero image and detail image.",
    "Do not invent a different product.",
    "Use the provided image as the visual anchor, then change composition, scene, angle, crop, lighting, and selling-point emphasis according to the section goal. Never replace the product with a similar-looking object or a generic prop.",
  ].join(" ");
}

function buildAspectInstruction(aspectRatio: "1:1" | "3:4" | "9:16") {
  if (aspectRatio === "1:1") {
    return "The final image must be a square 1:1 e-commerce hero composition, optimized for tappable product gallery covers.";
  }

  return aspectRatio === "3:4"
    ? "The final image must be a vertical 3:4 marketplace poster composition."
    : "The final image must be a vertical 9:16 long-form mobile commerce composition.";
}

function buildTargetLanguageInstruction(contentLanguage: ContentLanguage) {
  const targetLanguage = contentLanguageNamesForPrompt[normalizeContentLanguage(contentLanguage)];

  return [
    `All user-facing marketing copy that appears inside the image must be written in ${targetLanguage}.`,
    `The section title, key selling points, short supporting copy, disclaimers, and CTA should all be in ${targetLanguage} when they appear in the image.`,
    "Do not mix in Simplified Chinese unless the target language is Simplified Chinese.",
    "Keep the typography native, polished, and commercially readable for the target language.",
  ].join(" ");
}

function buildPhysicalRealityInstruction() {
  return [
    "Respect product physics and product-specific mechanical logic.",
    "Infer how the product actually works from the uploaded image and section goal: cable exit points, vents, nozzles, hinges, openings, drawers, buttons, handles, gravity, shadows, reflections, support surfaces, airflow, liquid flow, and user interaction direction.",
    "Do not create impossible physical effects: reversed airflow, cords disappearing into furniture, floating unsupported products, hands passing through solid parts, liquids flowing upward, disconnected shadows, impossible reflections, text crossing through product geometry, or parts bending in a way the material cannot.",
    "For hair dryers specifically, airflow must leave the front nozzle, the rear intake must not emit wind, and the power cord must connect naturally from the handle/base instead of merging into a desk or wall.",
    "For Rubik's cubes, speed cubes, puzzle cubes and other mechanical toys: preserve the correct cube order such as 3x3x3 when stated or visible, keep six square color faces, visible corner/edge/center piece logic, real twistable layer seams, rounded or straight tile style matching the reference, and do not turn it into a ruler, sticker sheet, generic storage box, electronics device, or unrelated block toy.",
  ].join(" ");
}

function buildGenerationRequirementsInstruction(generationRequirements?: string | null) {
  const trimmed = generationRequirements?.trim();
  if (!trimmed) {
    return "No extra project-level image generation requirements were provided.";
  }

  return [
    "Project-level image generation requirements from the user. Treat these as high-priority creative constraints for this image while still following the current section goal:",
    trimmed,
    "Operationalize these requirements concretely through camera angle, scene, props, product interaction, composition variation, and in-image copy. Do not ignore them or mention them only as abstract text.",
  ].join("\n");
}

export function buildSectionImagePrompt(
  section: PageSection,
  referenceAssets: ProductAsset[] = [],
  aspectRatio: "1:1" | "3:4" | "9:16" = "9:16",
  contentLanguage: ContentLanguage = "zh-CN",
  generationRequirements?: string | null,
) {
  return [
    "You are a senior e-commerce key-visual designer creating marketplace-ready product artwork.",
    `Section type: ${section.type}`,
    `Section title: ${section.title}`,
    `Section goal: ${section.goal}`,
    `Section copy: ${section.copy}`,
    `Visual prompt guidance: ${section.visualPrompt}`,
    buildReferenceText(referenceAssets),
    buildMainImageInstruction(referenceAssets),
    buildAspectInstruction(aspectRatio),
    buildTargetLanguageInstruction(contentLanguage),
    buildGenerationRequirementsInstruction(generationRequirements),
    buildPhysicalRealityInstruction(),
    "Generate one high-conversion mobile e-commerce visual for this section.",
    "The image should emphasize product clarity, composition hierarchy, material texture, and marketplace aesthetics.",
    "The headline, selling points, supporting copy, and CTA should be visually designed inside the image rather than left for later DOM text insertion.",
    "Make the result feel like finished commercial artwork, not a blank template.",
  ].join("\n");
}

export function buildRegenerationPrompt(
  section: PageSection,
  referenceAssets: ProductAsset[] = [],
  aspectRatio: "1:1" | "3:4" | "9:16" = "9:16",
  contentLanguage: ContentLanguage = "zh-CN",
  generationRequirements?: string | null,
) {
  return [
    buildSectionImagePrompt(section, referenceAssets, aspectRatio, contentLanguage, generationRequirements),
    "This is a regeneration task. Keep the same product identity and selling-point direction, but improve composition accuracy, completion quality, and conversion appeal.",
  ].join("\n");
}

export function buildImageEditPrompt(
  section: PageSection,
  referenceAssets: ProductAsset[] = [],
  mode: "repaint" | "enhance" | "translate" | "inpaint" = "repaint",
  aspectRatio: "1:1" | "3:4" | "9:16" = "9:16",
  contentLanguage: ContentLanguage = "zh-CN",
  generationRequirements?: string | null,
  editInstruction?: string | null,
) {
  const targetLanguage = contentLanguageNamesForPrompt[normalizeContentLanguage(contentLanguage)];
  const modeInstruction =
    mode === "translate"
      ? `This is an in-image translation task. Use the current image as the base and translate every visible user-facing word, headline, selling point, label, badge, CTA, note, and disclaimer into ${targetLanguage}. Preserve the original product, layout, composition, typography hierarchy, colors, lighting, and commercial style as much as possible. Do not add new claims or redesign the image except where text length requires natural typographic fitting. Remove the original-language text after replacing it with ${targetLanguage}.`
      : mode === "enhance"
        ? "This is an enhancement task. Use the current image as the base, preserve the overall framing, and improve realism, texture, lighting, clarity, edge quality, and commercial polish."
        : mode === "inpaint"
          ? "This is a localized inpainting task. Use the current image as the base and modify only the transparent/painted mask area. Preserve every unmasked area as much as possible, including product identity, typography, labels, layout, background, lighting, shadows, colors, framing, and composition. Use the reference images only to repair or regenerate the masked detail. Do not redesign the whole image."
        : "This is a repaint task. Use the current image as the base, keep the same product identity, and redesign the composition, atmosphere, styling, and conversion emphasis according to the section goal.";

  return [
    buildSectionImagePrompt(section, referenceAssets, aspectRatio, contentLanguage, generationRequirements),
    modeInstruction,
    mode === "inpaint" && editInstruction?.trim()
      ? `User local edit instruction: ${editInstruction.trim()}`
      : "",
    "The current section image must be treated as the editable base image.",
    "Keep the product identical to the uploaded main product image and do not replace it with a different item.",
    mode === "translate"
      ? "Only change the in-image language. Do not translate invisible metadata, do not add subtitles outside the artwork, and do not leave bilingual duplicates unless the original design intentionally uses bilingual branding."
      : "",
    "Output one marketplace-ready mobile e-commerce image only.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLocalInpaintPrompt(
  section: PageSection,
  referenceAssets: ProductAsset[] = [],
  editInstruction?: string | null,
  referenceCropImageCount = 0,
) {
  return [
    "Localized inpainting edit.",
    "The first image is the base image. A mask image is attached to define the editable area.",
    "Only the transparent area of the mask may be regenerated. All opaque/unmasked pixels must be preserved as closely as possible.",
    "Do not redesign the whole image. Do not change crop, layout, typography, labels, background, product position, lighting, color palette, or any unmasked object.",
    "Blend the edited area naturally into its surroundings, matching existing perspective, material, shadows, edges, sharpness, and noise.",
    referenceAssets.length
      ? `Additional reference images: ${referenceAssets.map((item) => item.fileName).join(" / ")}. Use them only to repair or regenerate details inside the masked area. Do not use them as a reason to change unmasked areas.`
      : "No additional reference images were intentionally provided for this local edit.",
    referenceCropImageCount > 0
      ? `There are ${referenceCropImageCount} extra cropped reference image(s) after the full reference images. These crops are the user's painted reference regions and should be prioritized for the exact local detail, shape, texture, edge, and color inside the masked area.`
      : "",
    `Section context: ${section.title}. ${section.goal}`,
    editInstruction?.trim()
      ? `User local edit instruction: ${editInstruction.trim()}`
      : "",
    "Return one edited image with the same overall composition as the base image.",
  ]
    .filter(Boolean)
    .join("\n");
}
export function buildSectionSvgLayoutPrompt(
  section: PageSection,
  referenceAssets: ProductAsset[] = [],
  aspectRatio: "1:1" | "3:4" | "9:16" = "9:16",
  contentLanguage: ContentLanguage = "zh-CN",
) {
  const targetLanguage = contentLanguageNamesForPrompt[normalizeContentLanguage(contentLanguage)];

  return [
    "You are designing a mobile e-commerce section poster that will be rendered as SVG.",
    "Return one strict JSON object only.",
    `All user-facing copy must be written in ${targetLanguage}.`,
    `Section type: ${section.type}`,
    `Section title: ${section.title}`,
    `Section goal: ${section.goal}`,
    `Section copy: ${section.copy}`,
    `Visual prompt guidance: ${section.visualPrompt}`,
    `Target aspect ratio: ${aspectRatio}`,
    buildReferenceText(referenceAssets),
    "Use the main uploaded product image as the product identity reference when composing the layout.",
    "Target JSON shape:",
    `{
  "headline": "string",
  "subheadline": "string",
  "badge": "string",
  "highlights": ["string", "string", "string"],
  "backgroundColor": "#F5E9D8",
  "accentColor": "#A85A2A",
  "panelColor": "#FFF8F0"
}`,
    "Keep the headline concise and commercial.",
    "highlights should contain 2 to 4 short selling points.",
  ].join("\n");
}

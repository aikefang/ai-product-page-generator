"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Brush,
  Eraser,
  Expand,
  History,
  Image,
  ImagePlus,
  Languages,
  Maximize2,
  Mountain,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  LocalRepaintDrawer,
  type LocalRepaintRunMode,
} from "@/components/editor/local-repaint-drawer";
import {
  ImageToImageDrawer,
  ProductSceneDrawer,
  SmartOutpaintDrawer,
} from "@/components/tools/toolbox-generation-drawers";
import { useImagePreview } from "@/components/shared/image-preview-provider";
import type { LocalRepaintMaskPayload, LocalRepaintPayload, LocalRepaintReference } from "@/components/editor/local-repaint-panel";
import type { ReferenceMaskPayload } from "@/components/editor/reference-mask-selection-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { Input } from "@/components/ui/input";
import { fileToBase64Payload } from "@/lib/utils/base64-upload";

type ToolboxTaskPayload = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";
  outputPayload?: {
    imageUrl?: string;
    recordId?: string | null;
    model?: string;
    revisedPrompt?: string;
    updatedAt?: string;
  } | null;
  errorMessage?: string | null;
};

type StandaloneVersion = {
  id: string;
  versionNumber: number;
  imageUrl: string;
  title: string;
  model?: string;
  recordId?: string | null;
  createdAt: string;
  isActive: boolean;
  isOriginal?: boolean;
};

type ToolboxRecord = {
  id: string;
  toolType: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";
  taskId?: string | null;
  taskStatus?: string | null;
  errorMessage?: string | null;
  inputImageUrl?: string | null;
  maskImageUrl?: string | null;
  outputImageUrl?: string | null;
  prompt?: string | null;
  model?: string | null;
  createdAt: string;
};

const toolboxToolTypeLabels: Record<string, string> = {
  LOCAL_REPAINT: "局部重绘",
  OUTPAINT: "智能扩图",
  IMAGE_TO_IMAGE: "以图生图",
  TEXT_TO_IMAGE: "文生图",
  ENHANCE: "图片增强",
  BACKGROUND_REPLACE: "背景替换",
  PRODUCT_SCENE: "商品换场景",
  UPSCALE: "高清放大",
  REMOVE_BACKGROUND: "抠图去背景",
  IMAGE_TRANSLATE: "图片翻译",
};

const recordStatusLabels: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCESS: "成功",
  FAILED: "失败",
  CANCELED: "已取消",
};

const tools = [
  {
    title: "局部重绘",
    description: "涂抹局部区域，只重新生成需要修改的位置。",
    icon: Brush,
    recordToolType: "LOCAL_REPAINT",
  },
  {
    title: "智能扩图",
    description: "在原图基础上向外延展画布，补全场景和背景。",
    icon: Expand,
    recordToolType: "OUTPAINT",
  },
  {
    title: "以图生图",
    description: "参考商品图，生成新场景、新角度或新动作图片。",
    icon: ImagePlus,
    recordToolType: "IMAGE_TO_IMAGE",
  },
  {
    title: "文生图",
    description: "通过文字描述生成商品视觉、场景图或创意图。",
    icon: Sparkles,
    recordToolType: "TEXT_TO_IMAGE",
  },
  {
    title: "图片增强",
    description: "提升清晰度、质感、光影和整体视觉表现。",
    icon: Aperture,
    recordToolType: "ENHANCE",
  },
  {
    title: "背景替换",
    description: "保留主体，替换成更适合转化的背景环境。",
    icon: Mountain,
    recordToolType: "BACKGROUND_REPLACE",
  },
  {
    title: "商品换场景",
    description: "把商品自然放入家居、户外、办公等指定场景。",
    icon: Image,
    recordToolType: "PRODUCT_SCENE",
  },
  {
    title: "高清放大",
    description: "对图片进行高清修复和等比例放大。",
    icon: Maximize2,
    recordToolType: "UPSCALE",
  },
  {
    title: "抠图去背景",
    description: "自动识别主体，生成透明底或纯色底商品图。",
    icon: Eraser,
    recordToolType: "REMOVE_BACKGROUND",
  },
  {
    title: "图片翻译",
    description: "识别图中文字并转换成目标语言，尽量保持原排版。",
    icon: Languages,
    recordToolType: "IMAGE_TRANSLATE",
  },
];

export function AiToolboxWorkspace() {
  const [localRepaintOpen, setLocalRepaintOpen] = useState(false);
  const [outpaintOpen, setOutpaintOpen] = useState(false);
  const [imageToImageOpen, setImageToImageOpen] = useState(false);
  const [productSceneOpen, setProductSceneOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordFilterToolType, setRecordFilterToolType] = useState<string | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [toolboxRecords, setToolboxRecords] = useState<ToolboxRecord[]>([]);
  const [continueImageSeed, setContinueImageSeed] = useState(0);
  const [outpaintInitialImage, setOutpaintInitialImage] = useState<{ url: string; title?: string } | null>(null);
  const [imageToImageInitialReferences, setImageToImageInitialReferences] = useState<Array<{ url: string; title?: string }>>([]);
  const [productSceneInitialImage, setProductSceneInitialImage] = useState<{ url: string; title?: string } | null>(null);
  const [standaloneBaseImage, setStandaloneBaseImage] = useState<{
    title: string;
    imageUrl: string;
  } | null>(null);
  const [standaloneReferences, setStandaloneReferences] = useState<LocalRepaintReference[]>([]);
  const [checkedReferenceIds, setCheckedReferenceIds] = useState<string[]>([]);
  const [standaloneVersions, setStandaloneVersions] = useState<StandaloneVersion[]>([]);
  const [localRepaintRunningMode, setLocalRepaintRunningMode] = useState<LocalRepaintRunMode | null>(null);
  const [localRepaintTaskId, setLocalRepaintTaskId] = useState<string | null>(null);
  const baseImageInputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const { openImagePreview } = useImagePreview();

  const selectedReferences = useMemo(
    () => standaloneReferences.filter((reference) => checkedReferenceIds.includes(reference.id)),
    [checkedReferenceIds, standaloneReferences],
  );

  const resetStandaloneLocalRepaint = () => {
    setStandaloneBaseImage(null);
    setStandaloneReferences([]);
    setCheckedReferenceIds([]);
    setStandaloneVersions([]);
    setLocalRepaintRunningMode(null);
    setLocalRepaintTaskId(null);
    if (baseImageInputRef.current) {
      baseImageInputRef.current.value = "";
    }
    if (referenceInputRef.current) {
      referenceInputRef.current.value = "";
    }
  };

  const setStandaloneOriginalVersion = (image: { title: string; imageUrl: string }) => {
    setStandaloneVersions([
      {
        id: "original",
        versionNumber: 0,
        imageUrl: image.imageUrl,
        title: "原始图片",
        createdAt: new Date().toISOString(),
        isActive: true,
        isOriginal: true,
      },
    ]);
  };

  const handleLocalRepaintOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetStandaloneLocalRepaint();
    }
    setLocalRepaintOpen(nextOpen);
  };

  const handleOpenSoon = (name: string) => {
    toast.message(`${name} 即将开放`);
  };

  const loadToolboxRecords = async (toolType: string | null = recordFilterToolType) => {
    setRecordsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "120" });
      if (toolType) {
        params.set("toolType", toolType);
      }
      const response = await fetch(`/api/ai-toolbox/records?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error?.message ?? "生成记录加载失败");
      }
      setToolboxRecords(payload.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成记录加载失败");
    } finally {
      setRecordsLoading(false);
    }
  };

  const openRecordsDrawer = (toolType: string | null = null) => {
    setRecordFilterToolType(toolType);
    setToolboxRecords([]);
    setRecordsOpen(true);
    void loadToolboxRecords(toolType);
  };

  const formatRecordTime = (value: string) =>
    new Date(value).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const openRecordImagePreview = (record: ToolboxRecord, imageUrl: string | null | undefined, label: string) => {
    if (!imageUrl) return;

    openImagePreview({
      url: imageUrl,
      title: `${toolboxToolTypeLabels[record.toolType] ?? record.toolType}${label}`,
      meta: `${record.model ?? "未知模型"} · ${formatRecordTime(record.createdAt)}`,
    });
  };

  const continueFromRecord = (record: ToolboxRecord) => {
    const imageUrl = record.outputImageUrl ?? record.inputImageUrl;
    if (!imageUrl) {
      toast.error("这条记录没有可继续处理的图片。");
      return;
    }

    const title = `${toolboxToolTypeLabels[record.toolType] ?? record.toolType}记录图片`;
    setRecordsOpen(false);
    setContinueImageSeed((value) => value + 1);

    if (record.toolType === "LOCAL_REPAINT") {
      setStandaloneBaseImage({ title, imageUrl });
      setStandaloneOriginalVersion({ title, imageUrl });
      setLocalRepaintOpen(true);
      toast.success("已带入图片，可以继续局部重绘");
      return;
    }

    if (record.toolType === "OUTPAINT") {
      setOutpaintInitialImage({ title, url: imageUrl });
      setOutpaintOpen(true);
      toast.success("已带入图片，可以继续扩图");
      return;
    }

    if (record.toolType === "IMAGE_TO_IMAGE") {
      setImageToImageInitialReferences([{ title, url: imageUrl }]);
      setImageToImageOpen(true);
      toast.success("已带入图片作为参考图，可以继续生成");
      return;
    }

    if (record.toolType === "PRODUCT_SCENE") {
      setProductSceneInitialImage({ title, url: imageUrl });
      setProductSceneOpen(true);
      toast.success("已带入图片作为产品图，可以继续换场景");
      return;
    }

    toast.message(`${toolboxToolTypeLabels[record.toolType] ?? "该工具"} 即将开放，暂不支持继续处理。`);
  };

  useEffect(() => {
    if (!localRepaintTaskId) return;

    let disposed = false;
    const pollTask = async () => {
      try {
        const response = await fetch(`/api/tasks/${localRepaintTaskId}`, { cache: "no-store" });
        const payload = await response.json();
        const task = payload.success ? (payload.data as ToolboxTaskPayload | null) : null;
        if (disposed || !task) return;
        if (task.status === "PENDING" || task.status === "RUNNING") return;

        setLocalRepaintTaskId(null);
        setLocalRepaintRunningMode(null);

        if (task.status === "SUCCESS" && task.outputPayload?.imageUrl) {
          applyStandaloneResult({
            imageUrl: task.outputPayload.imageUrl,
            model: task.outputPayload.model ?? "",
            recordId: task.outputPayload.recordId ?? null,
            updatedAt: task.outputPayload.updatedAt ?? new Date().toISOString(),
          });
          toast.success("后台重绘已完成，结果已更新到弹窗");
          return;
        }

        toast.error(task.errorMessage ?? "后台重绘失败，请重试");
      } catch {
        // 轮询短暂失败不打断后台任务。
      }
    };

    void pollTask();
    const timer = window.setInterval(pollTask, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [localRepaintTaskId]);

  const handleOpenTool = (name: string) => {
    if (name === "局部重绘") {
      resetStandaloneLocalRepaint();
      setLocalRepaintOpen(true);
      return;
    }
    if (name === "智能扩图") {
      setOutpaintInitialImage(null);
      setOutpaintOpen(true);
      return;
    }
    if (name === "以图生图") {
      setImageToImageInitialReferences([]);
      setImageToImageOpen(true);
      return;
    }
    if (name === "商品换场景") {
      setProductSceneInitialImage(null);
      setProductSceneOpen(true);
      return;
    }

    handleOpenSoon(name);
  };

  const uploadStandaloneBaseImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const payload = await fileToBase64Payload(file);
      setStandaloneBaseImage({
        title: file.name,
        imageUrl: `data:${payload.mimeType};base64,${payload.base64Data}`,
      });
      setStandaloneOriginalVersion({
        title: file.name,
        imageUrl: `data:${payload.mimeType};base64,${payload.base64Data}`,
      });
      toast.success("已选择待局部重绘图片");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片读取失败");
    }
  };

  const uploadStandaloneReferences = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    try {
      const nextReferences = await Promise.all(
        files.map(async (file) => {
          const payload = await fileToBase64Payload(file);
          return {
            id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
            title: file.name,
            imageUrl: `data:${payload.mimeType};base64,${payload.base64Data}`,
          };
        }),
      );
      setStandaloneReferences((current) => [...current, ...nextReferences]);
      setCheckedReferenceIds((current) => [...new Set([...current, ...nextReferences.map((reference) => reference.id)])]);
      toast.success(`已添加 ${nextReferences.length} 张参考图`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图读取失败");
    }
  };

  const toggleStandaloneReference = (referenceId: string, checked: boolean) => {
    setCheckedReferenceIds((current) =>
      checked ? [...new Set([...current, referenceId])] : current.filter((id) => id !== referenceId),
    );
  };

  const applyStandaloneResult = (result: {
    imageUrl: string;
    model?: string;
    recordId?: string | null;
    updatedAt?: string;
  }) => {
    const createdAt = result.updatedAt ?? new Date().toISOString();
    setStandaloneVersions((current) => {
      const nextVersionNumber = current.filter((version) => !version.isOriginal).length + 1;
      const title = `局部重绘 v${nextVersionNumber}`;
      setStandaloneBaseImage({
        title,
        imageUrl: result.imageUrl,
      });
      return [
        {
          id: result.recordId ?? `${Date.now()}-${nextVersionNumber}`,
          versionNumber: nextVersionNumber,
          imageUrl: result.imageUrl,
          title,
          model: result.model,
          recordId: result.recordId,
          createdAt,
          isActive: true,
        },
        ...current.map((version) => ({ ...version, isActive: false })),
      ];
    });
  };

  const activateStandaloneVersion = (versionId: string) => {
    const version = standaloneVersions.find((item) => item.id === versionId);
    if (!version) return;
    setStandaloneBaseImage({
      title: version.title,
      imageUrl: version.imageUrl,
    });
    setStandaloneVersions((current) =>
      current.map((item) => ({
        ...item,
        isActive: item.id === versionId,
      })),
    );
    toast.success("已恢复到所选版本");
  };

  const runStandaloneLocalRepaint = async (mode: LocalRepaintRunMode, payload: LocalRepaintPayload) => {
    if (!standaloneBaseImage?.imageUrl) {
      toast.error("请先上传一张待局部重绘图片。");
      return false;
    }

    setLocalRepaintRunningMode(mode);
    try {
      const response = await fetch("/api/ai-toolbox/local-repaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionMode: mode,
          image: standaloneBaseImage.imageUrl,
          mask: payload.mask,
          editInstruction: payload.editInstruction,
          referenceImages: selectedReferences.map((reference) => reference.imageUrl),
          referenceCropImages: payload.referenceCropImages ?? [],
        }),
      });
      const responsePayload = await response.json();
      if (!responsePayload.success) {
        throw new Error(responsePayload.error?.message ?? "局部重绘失败");
      }

      if (mode === "background") {
        const task = responsePayload.data as ToolboxTaskPayload;
        if (!task?.id) {
          throw new Error("后台重绘任务创建失败。");
        }
        setLocalRepaintTaskId(task.id);
        toast.success("后台重绘任务已创建，可以关闭弹窗或继续处理其他内容");
        return true;
      }

      applyStandaloneResult(responsePayload.data);
      toast.success("局部重绘已完成，结果已更新到弹窗");
      return true;
    } catch (error) {
      setLocalRepaintRunningMode(null);
      toast.error(error instanceof Error ? error.message : "局部重绘失败");
      return false;
    } finally {
      if (mode === "sync") {
        setLocalRepaintRunningMode(null);
      }
    }
  };

  const generateStandaloneInstruction = async (
    baseMaskPayload: LocalRepaintMaskPayload,
    references: ReferenceMaskPayload[] = [],
  ) => {
    if (!standaloneBaseImage?.imageUrl) {
      throw new Error("请先上传一张待局部重绘图片。");
    }

    const referencePayload = references.map((reference) => {
      const source = selectedReferences.find((item) => item.id === reference.assetId);
      return {
        image: source?.imageUrl ?? "",
        mask: reference.mask,
        previewImage: reference.previewImage,
        cropImage: reference.cropImage,
      };
    }).filter((reference) => Boolean(reference.image));

    const response = await fetch("/api/ai-toolbox/local-repaint/instruction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: standaloneBaseImage.imageUrl,
        baseMask: baseMaskPayload.mask,
        basePreviewImage: baseMaskPayload.previewImage,
        references: referencePayload,
      }),
    });
    const payload = await response.json();
    if (!payload.success || !payload.data?.instruction) {
      throw new Error(payload.error?.message ?? "自动生成修改说明失败");
    }

    return {
      instruction: payload.data.instruction as string,
      referenceCropImages: references
        .map((reference) => reference.cropImage)
        .filter((image): image is string => Boolean(image)),
    };
  };

  const localRepaintReferencePanel = (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">当前图片</h3>
            <p className="mt-1 text-xs text-muted-foreground">{standaloneBaseImage?.title ?? "未选择待重绘图"}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => baseImageInputRef.current?.click()}>
            更换
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">参考图</h3>
            <Badge variant="outline">{selectedReferences.length} 张已勾选</Badge>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => referenceInputRef.current?.click()}>
            添加参考图
          </Button>
        </div>

        {standaloneReferences.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
            可以上传参考图，也可以不上传，局部重绘会只基于当前图和涂抹区域生成说明。
          </p>
        ) : (
          <div className="max-h-[270px] space-y-1.5 overflow-y-auto rounded-xl border border-border bg-background/70 p-2.5">
            {standaloneReferences.map((reference) => (
              <div
                key={reference.id}
                className="flex min-h-12 items-center gap-2 rounded-lg border border-transparent px-2 py-1 transition-colors hover:border-border hover:bg-muted/40"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch">
                  <input
                    type="checkbox"
                    checked={checkedReferenceIds.includes(reference.id)}
                    onChange={(event) => toggleStandaloneReference(reference.id, event.target.checked)}
                  />
                  <span className="truncate text-sm">{reference.title}</span>
                </label>
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  <img src={reference.imageUrl} alt={reference.title} className="h-full w-full object-cover" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const localRepaintVersionPanel = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">历史版本</h3>
        <Badge variant="outline">{standaloneVersions.length} 个版本</Badge>
      </div>
      {standaloneVersions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          独立工具模式的重绘结果会保存在这里，可以直接恢复到某个生成版本。
        </p>
      ) : (
        <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
          {standaloneVersions.map((version) => (
            <div key={version.id} className="rounded-xl border border-border bg-background/70 p-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_48px_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {version.isOriginal ? "原始图片" : `v${version.versionNumber}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {version.isOriginal ? "原始图片" : version.model ? `模型：${version.model}` : "独立工具生成"}
                  </p>
                </div>
                <div className="h-12 w-12 overflow-hidden rounded-xl border border-border bg-muted">
                  <img src={version.imageUrl} alt={version.title} className="h-full w-full object-cover" />
                </div>
                {version.isActive ? (
                  <Badge variant="success">当前</Badge>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => activateStandaloneVersion(version.id)}
                  >
                    恢复
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const recordDrawerToolLabel = recordFilterToolType
    ? (toolboxToolTypeLabels[recordFilterToolType] ?? recordFilterToolType)
    : null;

  return (
    <div>
      <Input ref={baseImageInputRef} type="file" accept="image/*" onChange={uploadStandaloneBaseImage} className="hidden" />
      <Input ref={referenceInputRef} type="file" accept="image/*" multiple onChange={uploadStandaloneReferences} className="hidden" />

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
        <div>
          <h1 className="text-xl font-semibold text-slate-950 dark:text-white">AI工具箱</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            独立使用局部重绘、扩图、以图生图等能力，生成结果会进入工具箱记录。
          </p>
        </div>
        <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openRecordsDrawer(null)}>
          <History className="mr-2 h-4 w-4" />
          查看生成记录
        </Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const enabled = ["局部重绘", "智能扩图", "以图生图", "商品换场景"].includes(tool.title);
          return (
            <Card
              key={tool.title}
              role="button"
              tabIndex={0}
              onClick={() => handleOpenTool(tool.title)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleOpenTool(tool.title);
                }
              }}
              className="group cursor-pointer overflow-hidden rounded-3xl border-slate-200 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-teal-200 hover:shadow-xl hover:shadow-teal-950/5 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-teal-300/30"
            >
              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-600 group-hover:text-white dark:bg-teal-400/10 dark:text-teal-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge variant={enabled ? "success" : "outline"}>{enabled ? "可试用" : "即将开放"}</Badge>
                </div>
                <div>
                  <CardTitle className="text-base">{tool.title}</CardTitle>
                  <CardDescription className="mt-2 min-h-10 text-sm leading-5">
                    {tool.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="grid gap-2 pt-0">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-2xl"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenTool(tool.title);
                  }}
                >
                  {enabled ? "打开工具" : "查看能力"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full rounded-2xl text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    openRecordsDrawer(tool.recordToolType);
                  }}
                >
                  <History className="mr-2 h-4 w-4" />
                  查看生成记录
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <LocalRepaintDrawer
        open={localRepaintOpen}
        onOpenChange={handleLocalRepaintOpenChange}
        title="局部重绘"
        imageUrl={standaloneBaseImage?.imageUrl}
        imageTitle={standaloneBaseImage?.title ?? "待重绘图片"}
        references={selectedReferences}
        referencePanel={localRepaintReferencePanel}
        versionPanel={localRepaintVersionPanel}
        canRun={Boolean(standaloneBaseImage)}
        runDisabledReason="请先上传一张待局部重绘图片。"
        immediateRunning={localRepaintRunningMode === "sync"}
        backgroundRunning={Boolean(localRepaintTaskId) || localRepaintRunningMode === "background"}
        onRun={runStandaloneLocalRepaint}
        onGenerateInstruction={generateStandaloneInstruction}
        emptyContent={
          <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-8">
            <div className="max-w-sm text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-200">
                <Upload className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-base font-semibold">上传待局部重绘图片</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                独立工具模式不依赖项目模块，先选择一张图片，然后涂抹需要修改的位置。
              </p>
              <Button type="button" className="mt-5 rounded-2xl" onClick={() => baseImageInputRef.current?.click()}>
                <ImagePlus className="mr-2 h-4 w-4" />
                选择图片
              </Button>
            </div>
          </div>
        }
      />
      <SmartOutpaintDrawer
        open={outpaintOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setOutpaintInitialImage(null);
          }
          setOutpaintOpen(nextOpen);
        }}
        initialImage={outpaintInitialImage}
        initialSeed={continueImageSeed}
      />
      <ImageToImageDrawer
        open={imageToImageOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setImageToImageInitialReferences([]);
          }
          setImageToImageOpen(nextOpen);
        }}
        initialReferenceImages={imageToImageInitialReferences}
        initialSeed={continueImageSeed}
      />
      <ProductSceneDrawer
        open={productSceneOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setProductSceneInitialImage(null);
          }
          setProductSceneOpen(nextOpen);
        }}
        initialProductImage={productSceneInitialImage}
        initialSeed={continueImageSeed}
      />
      <DrawerDialog
        open={recordsOpen}
        onOpenChange={setRecordsOpen}
        title={recordDrawerToolLabel ? `${recordDrawerToolLabel}生成记录` : "生成记录"}
        description={
          recordDrawerToolLabel
            ? `这里只展示 ${recordDrawerToolLabel} 产生的生成记录。`
            : "这里展示 AI 工具箱独立工具产生的生成记录。"
        }
        width={1120}
        closeOnOverlayClick
        footer={
          <>
            <Button type="button" variant="outline" className="w-[100px]" onClick={() => setRecordsOpen(false)}>
              关闭
            </Button>
            <Button type="button" className="w-[110px]" onClick={() => void loadToolboxRecords()} disabled={recordsLoading}>
              {recordsLoading ? <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              刷新
            </Button>
          </>
        }
      >
        {recordsLoading && toolboxRecords.length === 0 ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <div>
              <RefreshCw className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
              <p className="mt-4 text-sm font-medium">正在加载生成记录</p>
              <p className="mt-2 text-xs text-muted-foreground">稍等一下，马上把列表取回来。</p>
            </div>
          </div>
        ) : toolboxRecords.length === 0 ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <div>
              <History className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-4 text-sm font-medium">暂无生成记录</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {recordDrawerToolLabel
                  ? `使用 ${recordDrawerToolLabel} 生成图片后，会在这里看到记录。`
                  : "使用 AI 工具箱生成图片后，会在这里看到记录。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="hidden grid-cols-[92px_92px_112px_140px_minmax(0,1fr)_150px_96px] gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground md:grid">
              <span>原图</span>
              <span>结果图</span>
              <span>类型</span>
              <span>生成模型</span>
              <span>Prompt</span>
              <span>生成时间</span>
              <span>操作</span>
            </div>
            {toolboxRecords.map((record) => (
              <div
                key={record.id}
                className="grid grid-cols-1 gap-3 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[92px_92px_112px_140px_minmax(0,1fr)_150px_96px]"
              >
                <div>
                  <p className="mb-1 text-xs text-muted-foreground md:hidden">原图</p>
                  {record.inputImageUrl ? (
                    <button
                      type="button"
                      className="group h-[68px] w-[92px] overflow-hidden rounded-xl border border-border bg-muted transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                      onClick={() => openRecordImagePreview(record, record.inputImageUrl, "原图")}
                      title="查看原图"
                    >
                      <img
                        src={record.inputImageUrl}
                        alt={`${toolboxToolTypeLabels[record.toolType] ?? record.toolType}原图`}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ) : (
                    <div className="flex h-[68px] w-[92px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-xs text-muted-foreground">
                      暂无图片
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground md:hidden">结果图</p>
                  {record.outputImageUrl ? (
                    <button
                      type="button"
                      className="group h-[68px] w-[92px] overflow-hidden rounded-xl border border-border bg-muted transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                      onClick={() => openRecordImagePreview(record, record.outputImageUrl, "结果图")}
                      title="查看结果图"
                    >
                      <img
                        src={record.outputImageUrl}
                        alt={`${toolboxToolTypeLabels[record.toolType] ?? record.toolType}结果图`}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ) : (
                    <div className="flex h-[68px] w-[92px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-xs text-muted-foreground">
                      暂无图片
                    </div>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground md:hidden">类型</p>
                  <p className="text-sm font-medium">{toolboxToolTypeLabels[record.toolType] ?? record.toolType}</p>
                  <Badge variant={record.status === "SUCCESS" ? "success" : record.status === "FAILED" ? "destructive" : "outline"}>
                    {recordStatusLabels[record.status] ?? record.status}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground md:hidden">生成模型</p>
                  <p className="truncate text-sm text-foreground">{record.model ?? "-"}</p>
                  {record.taskId ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">任务：{record.taskId}</p>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground md:hidden">Prompt</p>
                  {record.prompt ? (
                    <p className="line-clamp-3 text-sm leading-6 text-foreground">{record.prompt}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">-</p>
                  )}
                  {record.errorMessage ? (
                    <p className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs leading-5 text-red-600 dark:text-red-300">
                      {record.errorMessage}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground md:hidden">生成时间</p>
                  <p className="text-sm text-foreground">{formatRecordTime(record.createdAt)}</p>
                </div>
                <div className="flex items-start">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-[88px] rounded-xl"
                    onClick={() => continueFromRecord(record)}
                  >
                    继续处理
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DrawerDialog>
    </div>
  );
}

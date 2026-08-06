"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Brush,
  Eraser,
  Expand,
  Image,
  ImagePlus,
  Languages,
  Maximize2,
  Mountain,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  LocalRepaintDrawer,
  type LocalRepaintRunMode,
} from "@/components/editor/local-repaint-drawer";
import type { LocalRepaintMaskPayload, LocalRepaintPayload, LocalRepaintReference } from "@/components/editor/local-repaint-panel";
import type { ReferenceMaskPayload } from "@/components/editor/reference-mask-selection-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
};

const tools = [
  {
    title: "局部重绘",
    description: "涂抹局部区域，只重新生成需要修改的位置。",
    icon: Brush,
  },
  {
    title: "智能扩图",
    description: "在原图基础上向外延展画布，补全场景和背景。",
    icon: Expand,
  },
  {
    title: "以图生图",
    description: "参考商品图，生成新场景、新角度或新动作图片。",
    icon: ImagePlus,
  },
  {
    title: "文生图",
    description: "通过文字描述生成商品视觉、场景图或创意图。",
    icon: Sparkles,
  },
  {
    title: "图片增强",
    description: "提升清晰度、质感、光影和整体视觉表现。",
    icon: Aperture,
  },
  {
    title: "背景替换",
    description: "保留主体，替换成更适合转化的背景环境。",
    icon: Mountain,
  },
  {
    title: "商品换场景",
    description: "把商品自然放入家居、户外、办公等指定场景。",
    icon: Image,
  },
  {
    title: "高清放大",
    description: "对图片进行高清修复和等比例放大。",
    icon: Maximize2,
  },
  {
    title: "抠图去背景",
    description: "自动识别主体，生成透明底或纯色底商品图。",
    icon: Eraser,
  },
  {
    title: "图片翻译",
    description: "识别图中文字并转换成目标语言，尽量保持原排版。",
    icon: Languages,
  },
];

export function AiToolboxWorkspace() {
  const [localRepaintOpen, setLocalRepaintOpen] = useState(false);
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

  const selectedReferences = useMemo(
    () => standaloneReferences.filter((reference) => checkedReferenceIds.includes(reference.id)),
    [checkedReferenceIds, standaloneReferences],
  );

  const handleOpenSoon = (name: string) => {
    toast.message(`${name} 即将开放`);
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
      setLocalRepaintOpen(true);
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
      setStandaloneVersions([]);
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
    const nextVersionNumber = standaloneVersions.length + 1;
    const createdAt = result.updatedAt ?? new Date().toISOString();
    const title = `局部重绘 v${nextVersionNumber}`;
    setStandaloneBaseImage({
      title,
      imageUrl: result.imageUrl,
    });
    setStandaloneVersions((current) => [
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
    ]);
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
                  <p className="text-sm font-medium">v{version.versionNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {version.model ? `模型：${version.model}` : "独立工具生成"}
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

  return (
    <div>
      <Input ref={baseImageInputRef} type="file" accept="image/*" onChange={uploadStandaloneBaseImage} className="hidden" />
      <Input ref={referenceInputRef} type="file" accept="image/*" multiple onChange={uploadStandaloneReferences} className="hidden" />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const enabled = tool.title === "局部重绘";
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
              <CardContent className="pt-0">
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
              </CardContent>
            </Card>
          );
        })}
      </section>

      <LocalRepaintDrawer
        open={localRepaintOpen}
        onOpenChange={setLocalRepaintOpen}
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
    </div>
  );
}

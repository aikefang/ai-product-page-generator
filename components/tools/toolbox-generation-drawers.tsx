"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ImageUploadDropzone } from "@/components/shared/image-upload-dropzone";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/drawer-dialog";
import { useImagePreview } from "@/components/shared/image-preview-provider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fileToBase64Payload } from "@/lib/utils/base64-upload";
import {
  contentLanguageOptions,
  normalizeContentLanguage,
  type ContentLanguage,
} from "@/lib/utils/content-language";

type RunMode = "sync" | "background";

type ToolboxTaskPayload = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELED";
  outputPayload?: ToolboxResult | null;
  errorMessage?: string | null;
};

type ToolboxResult = {
  imageUrl?: string;
  recordId?: string | null;
  model?: string;
  revisedPrompt?: string;
  updatedAt?: string;
};

type ToolboxVersion = {
  id: string;
  title: string;
  imageUrl: string;
  model?: string;
  createdAt: string | null;
  isActive: boolean;
  isOriginal?: boolean;
};

type ExpandEdges = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type InitialToolboxImage = {
  url: string;
  title?: string;
};

const imageTranslateLanguageLabels: Record<ContentLanguage, string> = {
  "zh-CN": "简体中文（中文）",
  "en-US": "英语（English）",
  "ja-JP": "日语（日本語）",
  "ko-KR": "韩语（한국어）",
  "es-ES": "西班牙语（Español）",
  "fr-FR": "法语（Français）",
  "de-DE": "德语（Deutsch）",
  "pt-PT": "葡萄牙语（Português）",
  "ar-SA": "阿拉伯语（العربية）",
  "ru-RU": "俄语（Русский）",
};

async function fileToDataUrl(file: File) {
  const payload = await fileToBase64Payload(file);
  return `data:${payload.mimeType};base64,${payload.base64Data}`;
}

async function filesToDataUrls(files: File[]) {
  return Promise.all(files.map((file) => fileToDataUrl(file)));
}

async function imageUrlToFile(image: InitialToolboxImage, fallbackName: string) {
  const response = await fetch(image.url);
  const blob = await response.blob();
  const mimeType = blob.type || "image/png";
  const extension = mimeType.includes("jpeg")
    ? "jpg"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
        ? "gif"
        : "png";
  const fileName = image.title?.includes(".") ? image.title : `${image.title ?? fallbackName}.${extension}`;
  return new File([blob], fileName, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function VersionPanel({
  versions,
  onActivate,
}: {
  versions: ToolboxVersion[];
  onActivate: (version: ToolboxVersion) => void;
}) {
  const { openImagePreview } = useImagePreview();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">历史版本</h3>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {versions.length} 个版本
        </span>
      </div>
      {versions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          生成结果会保存在这里，可以直接恢复到某个版本。
        </p>
      ) : (
        <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
          {versions.map((version) => (
            <div key={version.id} className="rounded-xl border border-border bg-background/70 p-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_52px_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{version.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {version.model ? `模型：${version.model}` : `${version.isOriginal ? "原始图片" : "AI工具箱生成"}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="h-12 w-12 overflow-hidden rounded-xl border border-border bg-muted cursor-zoom-in transition-opacity hover:opacity-80"
                  onClick={(event) => {
                    event.stopPropagation();
                    openImagePreview({
                      url: version.imageUrl,
                      title: version.title,
                      meta: version.model ? `模型：${version.model}` : undefined,
                    });
                  }}
                  aria-label={`预览：${version.title}`}
                >
                  <img src={version.imageUrl} alt={version.title} className="h-full w-full object-cover" />
                </button>
                {version.isActive ? (
                  <span className="rounded-full bg-emerald-500 px-2 py-1 text-xs text-white">当前</span>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onActivate(version)}>
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
}

function useToolboxRunner({
  endpoint,
  resultTitlePrefix,
  onResultImage,
}: {
  endpoint: string;
  resultTitlePrefix: string;
  onResultImage?: (imageUrl: string) => void;
}) {
  const [runningMode, setRunningMode] = useState<RunMode | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ToolboxVersion[]>([]);

  const applyResult = useCallback((result: ToolboxResult) => {
    const imageUrl = result.imageUrl;
    if (!imageUrl) return;
    setVersions((current) => {
      const generatedCount = current.filter((v) => !v.isOriginal).length;
      const nextNumber = generatedCount + 1;
      const version: ToolboxVersion = {
        id: result.recordId ?? `${Date.now()}-${nextNumber}`,
        title: `${resultTitlePrefix} v${nextNumber}`,
        imageUrl,
        model: result.model,
        createdAt: result.updatedAt ?? new Date().toISOString(),
        isActive: true,
      };
      return [version, ...current.map((item) => ({ ...item, isActive: false }))];
    });
    onResultImage?.(imageUrl);
  }, [onResultImage, resultTitlePrefix]);

  useEffect(() => {
    if (!taskId) return;

    let disposed = false;
    const pollTask = async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
        const payload = await response.json();
        const task = payload.success ? (payload.data as ToolboxTaskPayload | null) : null;
        if (disposed || !task) return;
        if (task.status === "PENDING" || task.status === "RUNNING") return;

        setTaskId(null);
        setRunningMode(null);
        if (task.status === "SUCCESS" && task.outputPayload?.imageUrl) {
          applyResult(task.outputPayload);
          toast.success("后台生成已完成，结果已更新到弹窗");
          return;
        }
        toast.error(task.errorMessage ?? "后台生成失败，请重试");
      } catch {
        // 短暂轮询错误不打断后台任务。
      }
    };

    void pollTask();
    const timer = window.setInterval(pollTask, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [applyResult, taskId]);

  const run = async (mode: RunMode, body: Record<string, unknown>) => {
    setRunningMode(mode);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, executionMode: mode }),
      });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error?.message ?? "生成失败");
      }

      if (mode === "background") {
        const task = payload.data as ToolboxTaskPayload;
        if (!task?.id) throw new Error("后台任务创建失败。");
        setTaskId(task.id);
        toast.success("后台任务已创建，可以关闭弹窗或继续处理其他内容");
        return true;
      }

      applyResult(payload.data as ToolboxResult);
      toast.success("生成完成，结果已更新到弹窗");
      return true;
    } catch (error) {
      setRunningMode(null);
      toast.error(error instanceof Error ? error.message : "生成失败");
      return false;
    } finally {
      if (mode === "sync") setRunningMode(null);
    }
  };

  const activateVersion = (version: ToolboxVersion) => {
    setVersions((current) => current.map((item) => ({ ...item, isActive: item.id === version.id })));
    onResultImage?.(version.imageUrl);
    toast.success("已恢复到所选版本");
  };

  const reset = useCallback(() => {
    setRunningMode(null);
    setTaskId(null);
    setVersions([]);
  }, []);

  const setOriginalVersion = useCallback((image: InitialToolboxImage) => {
    setVersions([
      {
        id: "original",
        title: "原始图片",
        imageUrl: image.url,
        createdAt: null,
        isActive: true,
        isOriginal: true,
      },
    ]);
  }, []);

  const deactivateAllVersions = useCallback(() => {
    setVersions((current) => current.map((item) => ({ ...item, isActive: false })));
  }, []);

  return {
    runningMode,
    backgroundRunning: Boolean(taskId) || runningMode === "background",
    versions,
    run,
    activateVersion,
    setOriginalVersion,
    deactivateAllVersions,
    reset,
  };
}

function DrawerFooter({
  closeLabel = "关闭",
  syncLabel,
  backgroundLabel,
  runningMode,
  backgroundRunning,
  disabled,
  onClose,
  onRun,
}: {
  closeLabel?: string;
  syncLabel: string;
  backgroundLabel: string;
  runningMode: RunMode | null;
  backgroundRunning: boolean;
  disabled?: boolean;
  onClose: () => void;
  onRun: (mode: RunMode) => void;
}) {
  const running = runningMode !== null || backgroundRunning;
  return (
    <>
      <Button type="button" variant="outline" onClick={onClose} className="w-[100px]">
        {closeLabel}
      </Button>
      <Button type="button" onClick={() => onRun("background")} disabled={disabled || running} variant="outline" className="w-[110px]">
        {backgroundRunning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {backgroundRunning ? "生成中..." : backgroundLabel}
      </Button>
      <Button type="button" onClick={() => onRun("sync")} disabled={disabled || running} className="w-[110px]">
        {runningMode === "sync" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {runningMode === "sync" ? "处理中..." : syncLabel}
      </Button>
    </>
  );
}

function OutpaintPreview({
  imageUrl,
  expand,
  onExpandChange,
}: {
  imageUrl: string;
  expand: ExpandEdges;
  onExpandChange: (expand: ExpandEdges) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    side: keyof ExpandEdges;
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);

  const startDrag = (side: keyof ExpandEdges) => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragRef.current = {
      side,
      startX: event.clientX,
      startY: event.clientY,
      startValue: expand[side],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || !root) return;

    const rect = root.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / Math.max(rect.width, 1)) * 100;
    const deltaY = ((event.clientY - drag.startY) / Math.max(rect.height, 1)) * 100;
    const next = { ...expand };
    if (drag.side === "left") next.left = clampPercent(drag.startValue - deltaX);
    if (drag.side === "right") next.right = clampPercent(drag.startValue + deltaX);
    if (drag.side === "top") next.top = clampPercent(drag.startValue - deltaY);
    if (drag.side === "bottom") next.bottom = clampPercent(drag.startValue + deltaY);
    onExpandChange(next);
  };

  return (
    <div className="space-y-3">
      <div
        ref={rootRef}
        onPointerMove={handleMove}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        className="relative mx-auto flex max-w-[680px] items-center justify-center rounded-3xl border border-dashed border-teal-300 bg-[linear-gradient(45deg,rgba(20,184,166,0.08)_25%,transparent_25%,transparent_50%,rgba(20,184,166,0.08)_50%,rgba(20,184,166,0.08)_75%,transparent_75%,transparent)] bg-[length:22px_22px] p-8 dark:border-teal-300/30"
        style={{
          paddingTop: `${24 + expand.top * 0.9}px`,
          paddingRight: `${24 + expand.right * 0.9}px`,
          paddingBottom: `${24 + expand.bottom * 0.9}px`,
          paddingLeft: `${24 + expand.left * 0.9}px`,
        }}
      >
        <img src={imageUrl} alt="扩图原图" className="max-h-[520px] max-w-full rounded-2xl border border-border bg-background object-contain shadow-lg" />
        {(["top", "right", "bottom", "left"] as Array<keyof ExpandEdges>).map((side) => (
          <button
            key={side}
            type="button"
            onPointerDown={startDrag(side)}
            className={`absolute rounded-full border border-teal-500 bg-white px-3 py-1 text-xs font-semibold text-teal-700 shadow-md transition hover:bg-teal-50 dark:bg-slate-950 dark:text-teal-200 ${
              side === "top"
                ? "left-1/2 top-3 -translate-x-1/2 cursor-ns-resize"
                : side === "bottom"
                  ? "bottom-3 left-1/2 -translate-x-1/2 cursor-ns-resize"
                  : side === "left"
                    ? "left-3 top-1/2 -translate-y-1/2 cursor-ew-resize"
                    : "right-3 top-1/2 -translate-y-1/2 cursor-ew-resize"
            }`}
          >
            {side === "top" ? "上" : side === "right" ? "右" : side === "bottom" ? "下" : "左"} {expand[side]}%
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        拖拽四边按钮调整扩展方向和比例，绿色棋盘区域表示需要 AI 延展的画布。
      </p>
    </div>
  );
}

export function SmartOutpaintDrawer({
  open,
  onOpenChange,
  initialImage,
  initialSeed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImage?: InitialToolboxImage | null;
  initialSeed?: number;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expand, setExpand] = useState<ExpandEdges>({ top: 20, right: 20, bottom: 20, left: 20 });
  const fileReadSeqRef = useRef(0);
  const runner = useToolboxRunner({
    endpoint: "/api/ai-toolbox/outpaint",
    resultTitlePrefix: "智能扩图",
    onResultImage: setImageUrl,
  });

  const resetState = useCallback(() => {
    fileReadSeqRef.current += 1;
    setFiles([]);
    setImageUrl("");
    setPrompt("");
    setExpand({ top: 20, right: 20, bottom: 20, left: 20 });
    runner.reset();
  }, [runner.reset]);

  const handleFilesChange = useCallback((nextFiles: File[]) => {
    setFiles(nextFiles);
    fileReadSeqRef.current += 1;
    const readSeq = fileReadSeqRef.current;
    const file = nextFiles[0];

    if (!file) {
      setImageUrl("");
      runner.reset();
      return;
    }

    void fileToDataUrl(file)
      .then((url) => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl(url);
        runner.setOriginalVersion({
          url,
          title: file.name || "原始图片",
        });
      })
      .catch(() => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl("");
        runner.reset();
        toast.error("图片读取失败，请重新选择图片。");
      });
  }, [runner.reset, runner.setOriginalVersion]);

  useEffect(() => {
    if (!open || initialImage?.url) return;
    resetState();
  }, [initialImage?.url, open, resetState]);

  useEffect(() => {
    if (!open || !initialImage?.url) return;
    let disposed = false;
    setPrompt("");
    setExpand({ top: 20, right: 20, bottom: 20, left: 20 });
    runner.reset();
    setImageUrl(initialImage.url);
    runner.setOriginalVersion(initialImage);
    fileReadSeqRef.current += 1;
    void imageUrlToFile(initialImage, "outpaint-source")
      .then((file) => {
        if (!disposed) {
          setFiles([file]);
        }
      })
      .catch(() => {
        if (!disposed) {
          setFiles([]);
        }
      });
    return () => {
      disposed = true;
    };
  }, [initialImage, initialSeed, open, runner.reset, runner.setOriginalVersion]);

  const submit = async (mode: RunMode) => {
    if (!imageUrl) {
      toast.error("请先上传一张需要扩图的原图。");
      return;
    }
    await runner.run(mode, { image: imageUrl, prompt, expand });
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="智能扩图"
      width={1100}
      closeOnOverlayClick={false}
      footer={
        <DrawerFooter
          syncLabel="立即扩图"
          backgroundLabel="后台扩图"
          runningMode={runner.runningMode}
          backgroundRunning={runner.backgroundRunning}
          disabled={!imageUrl}
          onClose={() => {
            resetState();
            onOpenChange(false);
          }}
          onRun={submit}
        />
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto rounded-2xl border border-border bg-muted/20 p-4">
          {imageUrl ? (
            <OutpaintPreview imageUrl={imageUrl} expand={expand} onExpandChange={setExpand} />
          ) : (
            <ImageUploadDropzone
              id="toolbox-outpaint-base"
              files={files}
              onFilesChange={handleFilesChange}
              acceptPagePaste
              title="上传需要扩图的原图"
              description="支持点击选择、拖拽上传、复制图片文件后粘贴。"
              minHeightClassName="min-h-[520px]"
            />
          )}
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          {imageUrl ? (
            <ImageUploadDropzone
              id="toolbox-outpaint-replace"
              files={files}
              onFilesChange={handleFilesChange}
              acceptPagePaste
              title="更换原图"
              description="重新上传后会以新图为扩图基础。"
              minHeightClassName="min-h-[160px]"
            />
          ) : null}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">补充提示词（非必填）</Label>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：向右扩展出更多咖啡吧台空间，保持暖色灯光和真实质感。" className="min-h-[140px]" />
          </div>
          <VersionPanel versions={runner.versions} onActivate={runner.activateVersion} />
        </div>
      </div>
    </DrawerDialog>
  );
}

export function ImageToImageDrawer({
  open,
  onOpenChange,
  initialReferenceImages = [],
  initialSeed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialReferenceImages?: InitialToolboxImage[];
  initialSeed?: number;
}) {
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [latestImage, setLatestImage] = useState("");
  const referenceFileReadSeqRef = useRef(0);

  const updateCurrentReferenceImage = useCallback((url: string, title = "当前参考图") => {
    setLatestImage(url);
    referenceFileReadSeqRef.current += 1;
    const readSeq = referenceFileReadSeqRef.current;
    void imageUrlToFile({ url, title }, "image-to-image-current")
      .then((file) => {
        if (referenceFileReadSeqRef.current === readSeq) {
          setReferenceFiles([file]);
        }
      })
      .catch(() => {
        // 当前版本仍可直接作为图片 URL 提交，预览文件转换失败时保留当前 URL。
      });
  }, []);

  const runner = useToolboxRunner({
    endpoint: "/api/ai-toolbox/image-to-image",
    resultTitlePrefix: "以图生图",
    onResultImage: updateCurrentReferenceImage,
  });

  const resetState = useCallback(() => {
    referenceFileReadSeqRef.current += 1;
    setReferenceFiles([]);
    setPrompt("");
    setLatestImage("");
    runner.reset();
  }, [runner.reset]);

  const handleReferenceFilesChange = useCallback((nextFiles: File[]) => {
    setReferenceFiles(nextFiles);
    referenceFileReadSeqRef.current += 1;
    const readSeq = referenceFileReadSeqRef.current;

    if (nextFiles.length === 0) {
      setLatestImage("");
      runner.reset();
      return;
    }

    void filesToDataUrls(nextFiles)
      .then(([firstImageUrl]) => {
        if (referenceFileReadSeqRef.current !== readSeq || !firstImageUrl) return;
        setLatestImage("");
        runner.setOriginalVersion({
          url: firstImageUrl,
          title: nextFiles[0]?.name || "原始图片",
        });
      })
      .catch(() => {
        if (referenceFileReadSeqRef.current !== readSeq) return;
        setLatestImage("");
        runner.reset();
        toast.error("参考图读取失败，请重新选择图片。");
      });
  }, [runner.reset, runner.setOriginalVersion]);

  useEffect(() => {
    if (!open || initialReferenceImages.length > 0) return;
    resetState();
  }, [initialReferenceImages.length, open, resetState]);

  useEffect(() => {
    if (!open || initialReferenceImages.length === 0) return;
    let disposed = false;
    setPrompt("");
    setLatestImage("");
    runner.reset();
    referenceFileReadSeqRef.current += 1;
    runner.setOriginalVersion(initialReferenceImages[0]);
    void Promise.all(initialReferenceImages.map((image, index) => imageUrlToFile(image, `image-to-image-reference-${index + 1}`)))
      .then((files) => {
        if (!disposed) {
          setReferenceFiles(files);
        }
      })
      .catch(() => {
        toast.error("生成记录图片带入失败，请重新选择图片。");
      });
    return () => {
      disposed = true;
    };
  }, [initialReferenceImages, initialSeed, open, runner.reset, runner.setOriginalVersion]);

  const submit = async (mode: RunMode) => {
    const referenceImages = await filesToDataUrls(referenceFiles);
    if (referenceImages.length === 0 && !prompt.trim()) {
      toast.error("请上传参考图，或填写生成要求。");
      return;
    }
    await runner.run(mode, { prompt, referenceImages });
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="以图生图"
      width={1100}
      closeOnOverlayClick={false}
      footer={
        <DrawerFooter
          syncLabel="立即生成"
          backgroundLabel="后台生成"
          runningMode={runner.runningMode}
          backgroundRunning={runner.backgroundRunning}
          disabled={referenceFiles.length === 0 && !prompt.trim()}
          onClose={() => {
            resetState();
            onOpenChange(false);
          }}
          onRun={submit}
        />
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-muted/20 p-4">
          <ImageUploadDropzone
            id="toolbox-image-to-image-references"
            files={referenceFiles}
            onFilesChange={handleReferenceFilesChange}
            acceptPagePaste
            multiple
            title="上传参考图"
            description="支持多张参考图。也可以不上传，只通过文字要求生成。"
            emptyIcon="images"
            minHeightClassName="min-h-[360px]"
            previewColumnsClassName="grid-cols-2 md:grid-cols-3"
          />
          {latestImage ? (
            <div className="rounded-2xl border border-border bg-card p-3">
              <p className="mb-2 text-sm font-semibold">最新结果</p>
              <img src={latestImage} alt="以图生图结果" className="max-h-[420px] w-full rounded-xl object-contain" />
            </div>
          ) : null}
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">生成要求（非必填）</Label>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：参考商品图，生成一个侧面角度的咖啡馆场景图，保持产品材质和颜色。" className="min-h-[180px]" />
          </div>
          <VersionPanel versions={runner.versions} onActivate={runner.activateVersion} />
        </div>
      </div>
    </DrawerDialog>
  );
}

export function ProductSceneDrawer({
  open,
  onOpenChange,
  initialProductImage,
  initialSeed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProductImage?: InitialToolboxImage | null;
  initialSeed?: number;
}) {
  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [sceneFiles, setSceneFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [latestImage, setLatestImage] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const productFileReadSeqRef = useRef(0);

  const updateCurrentProductImage = useCallback((url: string, title = "当前产品图") => {
    setProductImageUrl(url);
    setLatestImage(url);
    productFileReadSeqRef.current += 1;
    const readSeq = productFileReadSeqRef.current;
    void imageUrlToFile({ url, title }, "product-scene-current")
      .then((file) => {
        if (productFileReadSeqRef.current === readSeq) {
          setProductFiles([file]);
        }
      })
      .catch(() => {
        // 版本图片已经可以直接用于生成，预览文件转换失败时保留当前 URL。
      });
  }, []);

  const runner = useToolboxRunner({
    endpoint: "/api/ai-toolbox/product-scene",
    resultTitlePrefix: "商品换场景",
    onResultImage: updateCurrentProductImage,
  });

  const resetState = useCallback(() => {
    productFileReadSeqRef.current += 1;
    setProductFiles([]);
    setSceneFiles([]);
    setPrompt("");
    setLatestImage("");
    setProductImageUrl("");
    runner.reset();
  }, [runner.reset]);

  const handleProductFilesChange = useCallback((nextFiles: File[]) => {
    setProductFiles(nextFiles);
    productFileReadSeqRef.current += 1;
    const readSeq = productFileReadSeqRef.current;
    const file = nextFiles[0];

    if (!file) {
      setProductImageUrl("");
      setLatestImage("");
      runner.reset();
      return;
    }

    void fileToDataUrl(file)
      .then((url) => {
        if (productFileReadSeqRef.current !== readSeq) return;
        setProductImageUrl(url);
        setLatestImage("");
        runner.setOriginalVersion({
          url,
          title: file.name || "原始图片",
        });
      })
      .catch(() => {
        if (productFileReadSeqRef.current !== readSeq) return;
        setProductImageUrl("");
        setLatestImage("");
        runner.reset();
        toast.error("图片读取失败，请重新选择图片。");
      });
  }, [runner.reset, runner.setOriginalVersion]);

  useEffect(() => {
    if (!open || initialProductImage?.url) return;
    resetState();
  }, [initialProductImage?.url, open, resetState]);

  useEffect(() => {
    if (!open || !initialProductImage?.url) return;
    let disposed = false;
    setSceneFiles([]);
    setPrompt("");
    setLatestImage("");
    runner.reset();
    void imageUrlToFile(initialProductImage, "product-scene-source")
      .then((file) => {
        if (!disposed) {
          setProductFiles([file]);
        }
      })
      .catch(() => {
        toast.error("生成记录图片带入失败，请重新选择图片。");
      });
    setProductImageUrl(initialProductImage.url);
    runner.setOriginalVersion(initialProductImage);
    return () => {
      disposed = true;
    };
  }, [initialProductImage, initialSeed, open, runner.reset, runner.setOriginalVersion]);

  const submit = async (mode: RunMode) => {
    if (!productImageUrl) {
      toast.error("请先上传一张产品图。");
      return;
    }
    const sceneImages = await filesToDataUrls(sceneFiles);
    await runner.run(mode, { productImage: productImageUrl, sceneImages, prompt });
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="商品换场景"
      width={1100}
      closeOnOverlayClick={false}
      footer={
        <DrawerFooter
          syncLabel="立即换场景"
          backgroundLabel="后台换场景"
          runningMode={runner.runningMode}
          backgroundRunning={runner.backgroundRunning}
          disabled={productFiles.length === 0}
          onClose={() => {
            resetState();
            onOpenChange(false);
          }}
          onRun={submit}
        />
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-muted/20 p-4">
          <ImageUploadDropzone
            id="toolbox-product-scene-product"
            files={productFiles}
            onFilesChange={handleProductFilesChange}
            acceptPagePaste
            title="上传产品图"
            description="AI 会识别产品主体，并尽量保持产品形态、材质、颜色和细节。"
            minHeightClassName="min-h-[260px]"
          />
          <ImageUploadDropzone
            id="toolbox-product-scene-scenes"
            files={sceneFiles}
            onFilesChange={setSceneFiles}
            acceptPagePaste
            multiple
            title="上传场景参考图（非必填）"
            description="可以上传场景氛围、背景、灯光、构图参考图。"
            emptyIcon="images"
            minHeightClassName="min-h-[220px]"
            previewColumnsClassName="grid-cols-2 md:grid-cols-3"
          />
          {latestImage ? (
            <div className="rounded-2xl border border-border bg-card p-3">
              <p className="mb-2 text-sm font-semibold">最新结果</p>
              <img src={latestImage} alt="商品换场景结果" className="max-h-[420px] w-full rounded-xl object-contain" />
            </div>
          ) : null}
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">场景描述（非必填）</Label>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：把产品放在现代咖啡馆木质台面上，背景有柔和灯光和浅景深。" className="min-h-[180px]" />
          </div>
          <VersionPanel versions={runner.versions} onActivate={runner.activateVersion} />
        </div>
      </div>
    </DrawerDialog>
  );
}

export function ImageEnhanceDrawer({
  open,
  onOpenChange,
  initialImage,
  initialSeed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImage?: InitialToolboxImage | null;
  initialSeed?: number;
}) {
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enhancementMode, setEnhancementMode] = useState<"auto" | "clarity" | "color" | "product" | "portrait">("auto");
  const [intensity, setIntensity] = useState<"natural" | "balanced" | "strong">("balanced");
  const fileReadSeqRef = useRef(0);
  const runner = useToolboxRunner({
    endpoint: "/api/ai-toolbox/enhance",
    resultTitlePrefix: "图片增强",
    onResultImage: setImageUrl,
  });

  const resetState = useCallback(() => {
    fileReadSeqRef.current += 1;
    setSourceFiles([]);
    setImageUrl("");
    setPrompt("");
    setEnhancementMode("auto");
    setIntensity("balanced");
    runner.reset();
  }, [runner.reset]);

  const handleSourceFilesChange = useCallback((nextFiles: File[]) => {
    setSourceFiles(nextFiles);
    fileReadSeqRef.current += 1;
    const readSeq = fileReadSeqRef.current;
    const file = nextFiles[0];

    if (!file) {
      setImageUrl("");
      runner.reset();
      return;
    }

    void fileToDataUrl(file)
      .then((url) => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl(url);
        runner.setOriginalVersion({
          url,
          title: file.name || "原始图片",
        });
      })
      .catch(() => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl("");
        runner.reset();
        toast.error("图片读取失败，请重新选择图片。");
      });
  }, [runner.reset, runner.setOriginalVersion]);

  useEffect(() => {
    if (!open || initialImage?.url) return;
    resetState();
  }, [initialImage?.url, open, resetState]);

  useEffect(() => {
    if (!open || !initialImage?.url) return;
    let disposed = false;
    setPrompt("");
    setEnhancementMode("auto");
    setIntensity("balanced");
    runner.reset();
    setImageUrl(initialImage.url);
    runner.setOriginalVersion(initialImage);
    fileReadSeqRef.current += 1;
    void imageUrlToFile(initialImage, "image-enhance-source")
      .then((file) => {
        if (!disposed) {
          setSourceFiles([file]);
        }
      })
      .catch(() => {
        if (!disposed) {
          setSourceFiles([]);
        }
      });
    return () => {
      disposed = true;
    };
  }, [initialImage, initialSeed, open, runner.reset, runner.setOriginalVersion]);

  const submit = async (mode: RunMode) => {
    if (!imageUrl) {
      toast.error("请先上传一张需要增强的图片。");
      return;
    }
    await runner.run(mode, { image: imageUrl, prompt, enhancementMode, intensity });
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="图片增强"
      width={1100}
      closeOnOverlayClick={false}
      footer={
        <DrawerFooter
          syncLabel="立即增强"
          backgroundLabel="后台增强"
          runningMode={runner.runningMode}
          backgroundRunning={runner.backgroundRunning}
          disabled={!imageUrl}
          onClose={() => {
            resetState();
            onOpenChange(false);
          }}
          onRun={submit}
        />
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto rounded-2xl border border-border bg-muted/20 p-4">
          {imageUrl ? (
            <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-border bg-background p-3">
              <img src={imageUrl} alt="图片增强预览" className="max-h-[560px] max-w-full rounded-xl object-contain shadow-sm" />
            </div>
          ) : (
            <ImageUploadDropzone
              id="toolbox-image-enhance-source"
              files={sourceFiles}
              onFilesChange={handleSourceFilesChange}
              acceptPagePaste
              title="上传需要增强的图片"
              description="适合发灰、噪点、轻微模糊、光影不足或质感不够的图片。"
              minHeightClassName="min-h-[520px]"
            />
          )}
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          {imageUrl ? (
            <ImageUploadDropzone
              id="toolbox-image-enhance-replace"
              files={sourceFiles}
              onFilesChange={handleSourceFilesChange}
              acceptPagePaste
              title="更换图片"
              description="重新上传后会以新图作为增强原图。"
              minHeightClassName="min-h-[160px]"
            />
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="toolbox-image-enhance-mode" className="text-xs text-muted-foreground">
              增强方向
            </Label>
            <select
              id="toolbox-image-enhance-mode"
              value={enhancementMode}
              onChange={(event) => setEnhancementMode(event.target.value as typeof enhancementMode)}
              className="flex h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/6 dark:text-slate-100"
            >
              <option value="auto">智能平衡</option>
              <option value="clarity">清晰锐化</option>
              <option value="color">色彩光影</option>
              <option value="product">商品质感</option>
              <option value="portrait">人像自然</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="toolbox-image-enhance-intensity" className="text-xs text-muted-foreground">
              增强强度
            </Label>
            <select
              id="toolbox-image-enhance-intensity"
              value={intensity}
              onChange={(event) => setIntensity(event.target.value as typeof intensity)}
              className="flex h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/6 dark:text-slate-100"
            >
              <option value="natural">自然</option>
              <option value="balanced">均衡</option>
              <option value="strong">强增强</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">补充要求（非必填）</Label>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：压低高光，保留产品原本颜色，让金属边缘更干净。" className="min-h-[120px]" />
          </div>
          <VersionPanel versions={runner.versions} onActivate={runner.activateVersion} />
        </div>
      </div>
    </DrawerDialog>
  );
}

export function UpscaleDrawer({
  open,
  onOpenChange,
  initialImage,
  initialSeed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImage?: InitialToolboxImage | null;
  initialSeed?: number;
}) {
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scale, setScale] = useState<2 | 4>(2);
  const [detailMode, setDetailMode] = useState<"standard" | "product" | "text">("standard");
  const fileReadSeqRef = useRef(0);
  const runner = useToolboxRunner({
    endpoint: "/api/ai-toolbox/upscale",
    resultTitlePrefix: "高清放大",
    onResultImage: setImageUrl,
  });

  const resetState = useCallback(() => {
    fileReadSeqRef.current += 1;
    setSourceFiles([]);
    setImageUrl("");
    setPrompt("");
    setScale(2);
    setDetailMode("standard");
    runner.reset();
  }, [runner.reset]);

  const handleSourceFilesChange = useCallback((nextFiles: File[]) => {
    setSourceFiles(nextFiles);
    fileReadSeqRef.current += 1;
    const readSeq = fileReadSeqRef.current;
    const file = nextFiles[0];

    if (!file) {
      setImageUrl("");
      runner.reset();
      return;
    }

    void fileToDataUrl(file)
      .then((url) => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl(url);
        runner.setOriginalVersion({
          url,
          title: file.name || "原始图片",
        });
      })
      .catch(() => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl("");
        runner.reset();
        toast.error("图片读取失败，请重新选择图片。");
      });
  }, [runner.reset, runner.setOriginalVersion]);

  useEffect(() => {
    if (!open || initialImage?.url) return;
    resetState();
  }, [initialImage?.url, open, resetState]);

  useEffect(() => {
    if (!open || !initialImage?.url) return;
    let disposed = false;
    setPrompt("");
    setScale(2);
    setDetailMode("standard");
    runner.reset();
    setImageUrl(initialImage.url);
    runner.setOriginalVersion(initialImage);
    fileReadSeqRef.current += 1;
    void imageUrlToFile(initialImage, "upscale-source")
      .then((file) => {
        if (!disposed) {
          setSourceFiles([file]);
        }
      })
      .catch(() => {
        if (!disposed) {
          setSourceFiles([]);
        }
      });
    return () => {
      disposed = true;
    };
  }, [initialImage, initialSeed, open, runner.reset, runner.setOriginalVersion]);

  const submit = async (mode: RunMode) => {
    if (!imageUrl) {
      toast.error("请先上传一张需要高清放大的图片。");
      return;
    }
    await runner.run(mode, { image: imageUrl, prompt, scale, detailMode });
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="高清放大"
      width={1100}
      closeOnOverlayClick={false}
      footer={
        <DrawerFooter
          syncLabel="立即放大"
          backgroundLabel="后台放大"
          runningMode={runner.runningMode}
          backgroundRunning={runner.backgroundRunning}
          disabled={!imageUrl}
          onClose={() => {
            resetState();
            onOpenChange(false);
          }}
          onRun={submit}
        />
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto rounded-2xl border border-border bg-muted/20 p-4">
          {imageUrl ? (
            <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-border bg-background p-3">
              <img src={imageUrl} alt="高清放大预览" className="max-h-[560px] max-w-full rounded-xl object-contain shadow-sm" />
            </div>
          ) : (
            <ImageUploadDropzone
              id="toolbox-upscale-source"
              files={sourceFiles}
              onFilesChange={handleSourceFilesChange}
              acceptPagePaste
              title="上传需要放大的图片"
              description="适合低分辨率商品图、头像、详情页素材或印刷前素材。"
              minHeightClassName="min-h-[520px]"
            />
          )}
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          {imageUrl ? (
            <ImageUploadDropzone
              id="toolbox-upscale-replace"
              files={sourceFiles}
              onFilesChange={handleSourceFilesChange}
              acceptPagePaste
              title="更换图片"
              description="重新上传后会以新图作为放大原图。"
              minHeightClassName="min-h-[160px]"
            />
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="toolbox-upscale-scale" className="text-xs text-muted-foreground">
              放大倍率
            </Label>
            <select
              id="toolbox-upscale-scale"
              value={scale}
              onChange={(event) => setScale(Number(event.target.value) === 4 ? 4 : 2)}
              className="flex h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/6 dark:text-slate-100"
            >
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="toolbox-upscale-detail-mode" className="text-xs text-muted-foreground">
              细节模式
            </Label>
            <select
              id="toolbox-upscale-detail-mode"
              value={detailMode}
              onChange={(event) => setDetailMode(event.target.value as typeof detailMode)}
              className="flex h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/6 dark:text-slate-100"
            >
              <option value="standard">通用细节</option>
              <option value="product">商品细节</option>
              <option value="text">文字图形</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">补充要求（非必填）</Label>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：保持包装文字不变，让纹理更清晰，减少压缩噪点。" className="min-h-[120px]" />
          </div>
          <VersionPanel versions={runner.versions} onActivate={runner.activateVersion} />
        </div>
      </div>
    </DrawerDialog>
  );
}

export function ImageTranslateDrawer({
  open,
  onOpenChange,
  initialImage,
  initialSeed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImage?: InitialToolboxImage | null;
  initialSeed?: number;
}) {
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [targetLanguage, setTargetLanguage] = useState<ContentLanguage>("en-US");
  const fileReadSeqRef = useRef(0);
  const runner = useToolboxRunner({
    endpoint: "/api/ai-toolbox/image-translate",
    resultTitlePrefix: "图片翻译",
    onResultImage: setImageUrl,
  });

  const resetState = useCallback(() => {
    fileReadSeqRef.current += 1;
    setSourceFiles([]);
    setImageUrl("");
    setTargetLanguage("en-US");
    runner.reset();
  }, [runner.reset]);

  const handleSourceFilesChange = useCallback((nextFiles: File[]) => {
    setSourceFiles(nextFiles);
    fileReadSeqRef.current += 1;
    const readSeq = fileReadSeqRef.current;
    const file = nextFiles[0];

    if (!file) {
      setImageUrl("");
      runner.reset();
      return;
    }

    void fileToDataUrl(file)
      .then((url) => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl(url);
        runner.setOriginalVersion({
          url,
          title: file.name || "原始图片",
        });
      })
      .catch(() => {
        if (fileReadSeqRef.current !== readSeq) return;
        setImageUrl("");
        runner.reset();
        toast.error("图片读取失败，请重新选择图片。");
      });
  }, [runner.reset, runner.setOriginalVersion]);

  useEffect(() => {
    if (!open || initialImage?.url) return;
    resetState();
  }, [initialImage?.url, open, resetState]);

  useEffect(() => {
    if (!open || !initialImage?.url) return;
    let disposed = false;
    setTargetLanguage("en-US");
    runner.reset();
    setImageUrl(initialImage.url);
    runner.setOriginalVersion(initialImage);
    fileReadSeqRef.current += 1;
    void imageUrlToFile(initialImage, "image-translate-source")
      .then((file) => {
        if (!disposed) {
          setSourceFiles([file]);
        }
      })
      .catch(() => {
        if (!disposed) {
          setSourceFiles([]);
        }
      });
    return () => {
      disposed = true;
    };
  }, [initialImage, initialSeed, open, runner.reset, runner.setOriginalVersion]);

  const submit = async (mode: RunMode) => {
    if (!imageUrl) {
      toast.error("请先上传一张需要翻译的图片。");
      return;
    }
    await runner.run(mode, { image: imageUrl, targetLanguage });
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
        }
        onOpenChange(nextOpen);
      }}
      title="图片翻译"
      width={1100}
      closeOnOverlayClick={false}
      footer={
        <DrawerFooter
          syncLabel="立即翻译"
          backgroundLabel="后台翻译"
          runningMode={runner.runningMode}
          backgroundRunning={runner.backgroundRunning}
          disabled={!imageUrl}
          onClose={() => {
            resetState();
            onOpenChange(false);
          }}
          onRun={submit}
        />
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-auto rounded-2xl border border-border bg-muted/20 p-4">
          {imageUrl ? (
            <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-border bg-background p-3">
              <img src={imageUrl} alt="图片翻译预览" className="max-h-[560px] max-w-full rounded-xl object-contain shadow-sm" />
            </div>
          ) : (
            <ImageUploadDropzone
              id="toolbox-image-translate-source"
              files={sourceFiles}
              onFilesChange={handleSourceFilesChange}
              acceptPagePaste
              title="上传需要翻译的图片"
              description="支持点击选择、拖拽上传、复制图片文件后粘贴。"
              minHeightClassName="min-h-[520px]"
            />
          )}
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          {imageUrl ? (
            <ImageUploadDropzone
              id="toolbox-image-translate-replace"
              files={sourceFiles}
              onFilesChange={handleSourceFilesChange}
              acceptPagePaste
              title="更换图片"
              description="重新上传后会以新图作为翻译原图。"
              minHeightClassName="min-h-[160px]"
            />
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="toolbox-image-translate-language" className="text-xs text-muted-foreground">
              目标语言
            </Label>
            <select
              id="toolbox-image-translate-language"
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(normalizeContentLanguage(event.target.value))}
              className="flex h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/6 dark:text-slate-100"
            >
              {contentLanguageOptions.map((language) => (
                <option key={language} value={language}>
                  {imageTranslateLanguageLabels[language]}
                </option>
              ))}
            </select>
          </div>
          <VersionPanel versions={runner.versions} onActivate={runner.activateVersion} />
        </div>
      </div>
    </DrawerDialog>
  );
}

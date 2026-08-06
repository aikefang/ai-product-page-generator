"use client";

import { type ReactNode, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Brush, WandSparkles } from "lucide-react";

import { ImageMaskCanvas, type ImageMaskCanvasHandle } from "@/components/editor/image-mask-canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type LocalRepaintPayload = {
  mask: string;
  editInstruction: string;
  referenceCropImages?: string[];
};

export type LocalRepaintMaskPayload = {
  mask: string;
  previewImage?: string | null;
};

export type LocalRepaintPanelHandle = {
  getPayload: () => LocalRepaintPayload | null;
  getMaskPayload: () => LocalRepaintMaskPayload | null;
  getMaskValidationMessage: () => string | null;
  getValidationMessage: () => string | null;
  setInstruction: (instruction: string) => void;
  reset: () => void;
};

export type LocalRepaintReference = {
  id: string;
  title: string;
  imageUrl: string;
};

interface LocalRepaintPanelProps {
  imageUrl: string;
  title?: string;
  references?: LocalRepaintReference[];
  referencePanel?: ReactNode;
  versionPanel?: ReactNode;
  autoInstructionLoading?: boolean;
  onAutoGenerateInstruction?: () => void;
  className?: string;
}

export const LocalRepaintPanel = forwardRef<LocalRepaintPanelHandle, LocalRepaintPanelProps>(
  (
    {
      imageUrl,
      title,
      references = [],
      referencePanel,
      versionPanel,
      autoInstructionLoading = false,
      onAutoGenerateInstruction,
      className,
    },
    ref,
  ) => {
    const maskCanvasRef = useRef<ImageMaskCanvasHandle | null>(null);
    const [brushSize, setBrushSize] = useState(42);
    const [instruction, setInstruction] = useState("");

    useEffect(() => {
      setInstruction("");
    }, [imageUrl]);

    const getMaskValidationMessage = () => {
      const canvasMessage = maskCanvasRef.current?.getValidationMessage();
      if (!maskCanvasRef.current || canvasMessage) {
        return canvasMessage ?? "当前图片还没有加载完成，请稍后再试。";
      }
      return null;
    };

    const getMaskPayload = () => {
      const message = getMaskValidationMessage();
      if (message) return null;

      const mask = maskCanvasRef.current?.getMask();
      if (!mask) return null;

      return {
        mask,
        previewImage: maskCanvasRef.current?.getPreviewImage() ?? null,
      };
    };

    useImperativeHandle(ref, () => ({
      getPayload: () => {
        const message = getValidationMessage();
        if (message) return null;

        const maskPayload = getMaskPayload();
        if (!maskPayload) return null;

        return {
          mask: maskPayload.mask,
          editInstruction: instruction.trim(),
        };
      },
      getMaskPayload,
      getMaskValidationMessage,
      getValidationMessage,
      setInstruction: (nextInstruction: string) => setInstruction(nextInstruction),
      reset: () => {
        setInstruction("");
        maskCanvasRef.current?.reset();
      },
    }));

    function getValidationMessage() {
      const maskMessage = getMaskValidationMessage();
      if (maskMessage) return maskMessage;
      if (instruction.trim().length < 2) return "请填写局部重绘的修改说明。";
      return null;
    }

    return (
      <div className={cn("grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]", className)}>
        <div className="min-h-0 overflow-auto rounded-2xl border border-border bg-slate-950/5 p-4 dark:bg-black/20">
          <div className="mx-auto max-w-[620px]">
            <ImageMaskCanvas
              ref={maskCanvasRef}
              imageUrl={imageUrl}
              title={title ?? "当前图片"}
              description="在需要修复的区域上涂抹，未涂抹区域会尽量保持不变。"
              brushSize={brushSize}
            />
          </div>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Brush className="h-4 w-4" />
              画笔设置
            </div>
            <Label className="text-xs text-muted-foreground">画笔大小：{brushSize}px</Label>
            <input
              type="range"
              min={12}
              max={120}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              className="w-full accent-slate-950 dark:accent-white"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">局部修改说明</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAutoGenerateInstruction}
                disabled={autoInstructionLoading}
                className="h-8 px-2 text-xs"
              >
                <WandSparkles className="mr-1.5 h-3.5 w-3.5" />
                {autoInstructionLoading ? "生成中..." : "自动生成修改说明"}
              </Button>
            </div>
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：根据参考图重新生成这个弯钩，让金属边缘更自然，其他区域保持不变。"
              className="min-h-[150px]"
            />
          </div>

          {referencePanel ?? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">已带入参考图</Label>
                <span className="text-xs text-muted-foreground">{references.length} 张</span>
              </div>
              {references.length > 0 ? (
                <div className="max-h-[180px] space-y-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2">
                  {references.map((reference) => (
                    <div key={reference.id} className="flex items-center gap-2 rounded-lg bg-background/70 p-1.5">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                        <img src={reference.imageUrl} alt={reference.title} className="h-full w-full object-cover" />
                      </div>
                      <p className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                        {reference.title}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                  当前没有勾选参考图。局部重绘会只基于当前底图和涂抹区域处理。
                </div>
              )}
            </div>
          )}

          {versionPanel}

          <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            提交后会把涂抹区域转换成局部重绘 mask，并保存为新的版本。原版本仍会保留，可以在版本历史里切换回来。
          </div>
        </div>
      </div>
    );
  },
);

LocalRepaintPanel.displayName = "LocalRepaintPanel";

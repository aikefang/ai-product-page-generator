"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Brush } from "lucide-react";

import { ImageMaskCanvas, type ImageMaskCanvasHandle } from "@/components/editor/image-mask-canvas";
import type { LocalRepaintReference } from "@/components/editor/local-repaint-panel";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ReferenceMaskPayload = {
  assetId: string;
  mask: string;
  previewImage?: string | null;
  cropImage?: string | null;
};

export type ReferenceMaskSelectionPanelHandle = {
  getPayload: () => ReferenceMaskPayload[];
  getValidationMessage: () => string | null;
  reset: () => void;
};

interface ReferenceMaskSelectionPanelProps {
  references: LocalRepaintReference[];
  className?: string;
}

export const ReferenceMaskSelectionPanel = forwardRef<ReferenceMaskSelectionPanelHandle, ReferenceMaskSelectionPanelProps>(
  ({ references, className }, ref) => {
    const canvasRefs = useRef<Record<string, ImageMaskCanvasHandle | null>>({});
    const [brushSize, setBrushSize] = useState(36);
    const [paintedMap, setPaintedMap] = useState<Record<string, boolean>>({});

    const getPaintedReferences = () =>
      references.filter((reference) => Boolean(paintedMap[reference.id]));

    useImperativeHandle(ref, () => ({
      getPayload: () =>
        getPaintedReferences()
          .flatMap((reference) => {
            const mask = canvasRefs.current[reference.id]?.getMask();
            return mask
              ? [
                  {
                    assetId: reference.id,
                    mask,
                    previewImage: canvasRefs.current[reference.id]?.getPreviewImage() ?? null,
                    cropImage: canvasRefs.current[reference.id]?.getCroppedSelectionImage() ?? null,
                  },
                ]
              : [];
          }),
      getValidationMessage: () => {
        if (references.length === 0) return "当前没有可用于生成说明的参考图。";
        const paintedReferences = getPaintedReferences();
        if (paintedReferences.length === 0) return "请至少在一张参考图上涂抹需要参考的区域。";

        const notReadyReference = paintedReferences.find((reference) =>
          Boolean(canvasRefs.current[reference.id]?.getValidationMessage()),
        );
        if (notReadyReference) {
          return `${notReadyReference.title} 还没有加载完成，请稍后再试。`;
        }

        return null;
      },
      reset: () => {
        references.forEach((reference) => canvasRefs.current[reference.id]?.reset());
        setPaintedMap({});
      },
    }));

    return (
      <div className={cn("space-y-4", className)}>
        <div className="rounded-2xl border border-border bg-muted/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Brush className="h-4 w-4" />
            参考图画笔设置
          </div>
          <Label className="mt-2 block text-xs text-muted-foreground">画笔大小：{brushSize}px</Label>
          <input
            type="range"
            min={12}
            max={100}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="mt-2 w-full accent-slate-950 dark:accent-white"
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            在参考图里涂抹“想借鉴的局部细节”。不需要每张都涂，至少涂一张即可。
          </p>
        </div>

        {references.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
            当前没有带入参考图，请先在编辑面板勾选参考图。
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {references.map((reference) => (
              <div key={reference.id} className="rounded-2xl border border-border bg-card p-4">
                <ImageMaskCanvas
                  ref={(node) => {
                    canvasRefs.current[reference.id] = node;
                  }}
                  imageUrl={reference.imageUrl}
                  title={reference.title}
                  description="涂抹这张参考图中要让 AI 借鉴的局部位置。"
                  brushSize={brushSize}
                  onPaintedChange={(painted) =>
                    setPaintedMap((current) => ({
                      ...current,
                      [reference.id]: painted,
                    }))
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);

ReferenceMaskSelectionPanel.displayName = "ReferenceMaskSelectionPanel";

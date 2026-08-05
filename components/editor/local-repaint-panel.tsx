"use client";

import { forwardRef, type PointerEvent, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Brush, Eraser } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type LocalRepaintPayload = {
  mask: string;
  editInstruction: string;
};

export type LocalRepaintPanelHandle = {
  getPayload: () => LocalRepaintPayload | null;
  getValidationMessage: () => string | null;
  reset: () => void;
};

type Point = {
  x: number;
  y: number;
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
  className?: string;
}

export const LocalRepaintPanel = forwardRef<LocalRepaintPanelHandle, LocalRepaintPanelProps>(
  ({ imageUrl, title, references = [], className }, ref) => {
    const imageRef = useRef<HTMLImageElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const lastPointRef = useRef<Point | null>(null);
    const drawingRef = useRef(false);
    const [brushSize, setBrushSize] = useState(42);
    const [instruction, setInstruction] = useState("");
    const [painted, setPainted] = useState(false);
    const [imageReady, setImageReady] = useState(false);

    const clearCanvas = () => {
      const overlay = overlayCanvasRef.current;
      const brush = brushCanvasRef.current;
      overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
      brush?.getContext("2d")?.clearRect(0, 0, brush.width, brush.height);
      lastPointRef.current = null;
      drawingRef.current = false;
      setPainted(false);
    };

    const syncCanvasSize = () => {
      const image = imageRef.current;
      const overlay = overlayCanvasRef.current;
      const brush = brushCanvasRef.current;
      if (!image || !overlay || !brush || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        return;
      }

      overlay.width = image.naturalWidth;
      overlay.height = image.naturalHeight;
      brush.width = image.naturalWidth;
      brush.height = image.naturalHeight;
      setImageReady(true);
      clearCanvas();
    };

    useEffect(() => {
      setImageReady(false);
      setInstruction("");
      clearCanvas();

      if (imageRef.current?.complete) {
        window.requestAnimationFrame(syncCanvasSize);
      }
    }, [imageUrl]);

    const getCanvasPoint = (event: PointerEvent<HTMLCanvasElement>): Point | null => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      };
    };

    const drawSegment = (point: Point) => {
      const overlay = overlayCanvasRef.current;
      const brush = brushCanvasRef.current;
      if (!overlay || !brush) return;

      const previous = lastPointRef.current ?? point;
      const contexts = [
        { context: overlay.getContext("2d"), strokeStyle: "rgba(255, 70, 85, 0.72)" },
        { context: brush.getContext("2d"), strokeStyle: "rgba(255, 255, 255, 1)" },
      ];

      contexts.forEach(({ context, strokeStyle }) => {
        if (!context) return;
        context.save();
        context.lineWidth = brushSize;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = strokeStyle;
        context.fillStyle = strokeStyle;
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.lineTo(point.x, point.y);
        context.stroke();
        context.beginPath();
        context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });

      lastPointRef.current = point;
      setPainted(true);
    };

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
      const point = getCanvasPoint(event);
      if (!point || !imageReady) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      lastPointRef.current = point;
      drawSegment(point);
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;

      const point = getCanvasPoint(event);
      if (!point) return;

      event.preventDefault();
      drawSegment(point);
    };

    const stopDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      drawingRef.current = false;
      lastPointRef.current = null;
    };

    const buildOpenAiMask = () => {
      const brush = brushCanvasRef.current;
      if (!brush) return null;

      const mask = document.createElement("canvas");
      mask.width = brush.width;
      mask.height = brush.height;
      const context = mask.getContext("2d");
      if (!context) return null;

      context.fillStyle = "rgba(255, 255, 255, 1)";
      context.fillRect(0, 0, mask.width, mask.height);
      context.globalCompositeOperation = "destination-out";
      context.drawImage(brush, 0, 0);
      context.globalCompositeOperation = "source-over";

      return mask.toDataURL("image/png");
    };

    useImperativeHandle(ref, () => ({
      getPayload: () => {
        const message = getValidationMessage();
        if (message) return null;

        const mask = buildOpenAiMask();
        if (!mask) return null;

        return {
          mask,
          editInstruction: instruction.trim(),
        };
      },
      getValidationMessage,
      reset: () => {
        setInstruction("");
        clearCanvas();
      },
    }));

    function getValidationMessage() {
      if (!imageReady) return "当前图片还没有加载完成，请稍后再试。";
      if (!painted) return "请先在图片上涂抹需要局部重绘的区域。";
      if (instruction.trim().length < 2) return "请填写局部重绘的修改说明。";
      return null;
    }

    return (
      <div className={cn("grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]", className)}>
        <div className="min-h-0 overflow-auto rounded-2xl border border-border bg-slate-950/5 p-4 dark:bg-black/20">
          <div className="mx-auto max-w-[620px]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title ?? "当前图片"}</p>
                <p className="text-xs text-muted-foreground">在需要修复的区域上涂抹，未涂抹区域会尽量保持不变。</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={clearCanvas} disabled={!imageReady || !painted}>
                <Eraser className="mr-1.5 h-3.5 w-3.5" />
                清空
              </Button>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-border bg-black shadow-sm">
              <img
                ref={imageRef}
                src={imageUrl}
                alt={title ?? "局部重绘底图"}
                className="block h-auto w-full select-none"
                draggable={false}
                onLoad={syncCanvasSize}
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onPointerLeave={(event) => {
                  if (drawingRef.current) stopDrawing(event);
                }}
              />
              <canvas ref={brushCanvasRef} className="hidden" />
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
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
            <Label className="text-xs text-muted-foreground">局部修改说明</Label>
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：根据参考图重新生成这个弯钩，让金属边缘更自然，其他区域保持不变。"
              className="min-h-[150px]"
            />
          </div>

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

          <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
            提交后会把涂抹区域转换成局部重绘 mask，并保存为新的版本。原版本仍会保留，可以在版本历史里切换回来。
          </div>
        </div>
      </div>
    );
  },
);

LocalRepaintPanel.displayName = "LocalRepaintPanel";

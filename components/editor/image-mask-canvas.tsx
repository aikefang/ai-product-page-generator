"use client";

import { forwardRef, type PointerEvent, type ReactNode, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ImageMaskCanvasHandle = {
  getMask: () => string | null;
  getPreviewImage: () => string | null;
  getCroppedSelectionImage: () => string | null;
  getValidationMessage: () => string | null;
  hasPainted: () => boolean;
  reset: () => void;
};

type Point = {
  x: number;
  y: number;
};

interface ImageMaskCanvasProps {
  imageUrl: string;
  title?: ReactNode;
  description?: ReactNode;
  brushSize: number;
  className?: string;
  imageContainerClassName?: string;
  onPaintedChange?: (painted: boolean) => void;
}

export const ImageMaskCanvas = forwardRef<ImageMaskCanvasHandle, ImageMaskCanvasProps>(
  (
    {
      imageUrl,
      title,
      description,
      brushSize,
      className,
      imageContainerClassName,
      onPaintedChange,
    },
    ref,
  ) => {
    const imageRef = useRef<HTMLImageElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const lastPointRef = useRef<Point | null>(null);
    const drawingRef = useRef(false);
    const [painted, setPainted] = useState(false);
    const [imageReady, setImageReady] = useState(false);
    const [cursorPoint, setCursorPoint] = useState<Point | null>(null);

    const updatePainted = (nextPainted: boolean) => {
      setPainted(nextPainted);
      onPaintedChange?.(nextPainted);
    };

    const clearCanvas = () => {
      const overlay = overlayCanvasRef.current;
      const brush = brushCanvasRef.current;
      overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
      brush?.getContext("2d")?.clearRect(0, 0, brush.width, brush.height);
      lastPointRef.current = null;
      drawingRef.current = false;
      setCursorPoint(null);
      updatePainted(false);
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

    const getDisplayPoint = (event: PointerEvent<HTMLCanvasElement>): Point | null => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const drawSegment = (point: Point) => {
      const overlay = overlayCanvasRef.current;
      const brush = brushCanvasRef.current;
      if (!overlay || !brush) return;

      const previous = lastPointRef.current ?? point;
      const rect = overlay.getBoundingClientRect();
      const scaleX = rect.width > 0 ? overlay.width / rect.width : 1;
      const scaleY = rect.height > 0 ? overlay.height / rect.height : scaleX;
      const naturalBrushSize = brushSize * ((scaleX + scaleY) / 2);
      const contexts = [
        { context: overlay.getContext("2d"), strokeStyle: "rgba(255, 70, 85, 0.72)" },
        { context: brush.getContext("2d"), strokeStyle: "rgba(255, 255, 255, 1)" },
      ];

      contexts.forEach(({ context, strokeStyle }) => {
        if (!context) return;
        context.save();
        context.lineWidth = naturalBrushSize;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = strokeStyle;
        context.fillStyle = strokeStyle;
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.lineTo(point.x, point.y);
        context.stroke();
        context.beginPath();
        context.arc(point.x, point.y, naturalBrushSize / 2, 0, Math.PI * 2);
        context.fill();
        context.restore();
      });

      lastPointRef.current = point;
      updatePainted(true);
    };

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
      const point = getCanvasPoint(event);
      if (!point || !imageReady) return;

      event.preventDefault();
      setCursorPoint(getDisplayPoint(event));
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      lastPointRef.current = point;
      drawSegment(point);
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
      setCursorPoint(getDisplayPoint(event));

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

    const buildSelectionPreview = () => {
      const image = imageRef.current;
      const overlay = overlayCanvasRef.current;
      if (!image || !overlay || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        return null;
      }

      try {
        const preview = document.createElement("canvas");
        preview.width = image.naturalWidth;
        preview.height = image.naturalHeight;
        const context = preview.getContext("2d");
        if (!context) return null;

        context.drawImage(image, 0, 0, preview.width, preview.height);
        context.drawImage(overlay, 0, 0);
        return preview.toDataURL("image/png");
      } catch {
        return null;
      }
    };

    const getSelectionBounds = () => {
      const brush = brushCanvasRef.current;
      if (!brush) return null;

      const context = brush.getContext("2d");
      if (!context) return null;

      const { width, height } = brush;
      const imageData = context.getImageData(0, 0, width, height).data;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = imageData[(y * width + x) * 4 + 3];
          if (alpha > 0) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }

      if (maxX < minX || maxY < minY) {
        return null;
      }

      return { minX, minY, maxX, maxY };
    };

    const buildCroppedSelectionImage = () => {
      const image = imageRef.current;
      const bounds = getSelectionBounds();
      if (!image || !bounds || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        return null;
      }

      try {
        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;
        const padding = Math.max(
          Math.max(width, height) * 0.65,
          Math.min(image.naturalWidth, image.naturalHeight) * 0.035,
        );
        const cropX = Math.max(0, Math.floor(bounds.minX - padding));
        const cropY = Math.max(0, Math.floor(bounds.minY - padding));
        const cropMaxX = Math.min(image.naturalWidth, Math.ceil(bounds.maxX + padding));
        const cropMaxY = Math.min(image.naturalHeight, Math.ceil(bounds.maxY + padding));
        const cropWidth = Math.max(1, cropMaxX - cropX);
        const cropHeight = Math.max(1, cropMaxY - cropY);

        const crop = document.createElement("canvas");
        crop.width = cropWidth;
        crop.height = cropHeight;
        const context = crop.getContext("2d");
        if (!context) return null;

        context.drawImage(
          image,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight,
        );

        return crop.toDataURL("image/png");
      } catch {
        return null;
      }
    };

    useImperativeHandle(ref, () => ({
      getMask: () => {
        const message = getValidationMessage();
        if (message) return null;

        return buildOpenAiMask();
      },
      getPreviewImage: () => {
        const message = getValidationMessage();
        if (message) return null;

        return buildSelectionPreview();
      },
      getCroppedSelectionImage: () => {
        const message = getValidationMessage();
        if (message) return null;

        return buildCroppedSelectionImage();
      },
      getValidationMessage,
      hasPainted: () => painted,
      reset: clearCanvas,
    }));

    function getValidationMessage() {
      if (!imageReady) return "图片还没有加载完成，请稍后再试。";
      if (!painted) return "请先在图片上涂抹需要参考或修改的区域。";
      return null;
    }

    return (
      <div className={cn("min-h-0", className)}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title ? <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</p> : null}
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clearCanvas} disabled={!imageReady || !painted}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" />
            清空
          </Button>
        </div>

        <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-black shadow-sm", imageContainerClassName)}>
          <img
            ref={imageRef}
            src={imageUrl}
            alt={typeof title === "string" ? title : "涂抹底图"}
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
            onPointerCancel={(event) => {
              setCursorPoint(null);
              stopDrawing(event);
            }}
            onPointerLeave={(event) => {
              setCursorPoint(null);
              if (drawingRef.current) stopDrawing(event);
            }}
            onPointerEnter={(event) => setCursorPoint(getDisplayPoint(event))}
          />
          {cursorPoint ? (
            <div
              className="pointer-events-none absolute rounded-full border border-dashed border-white/95 shadow-[0_0_0_1px_rgba(15,23,42,0.35),0_0_10px_rgba(0,0,0,0.22)]"
              style={{
                width: brushSize,
                height: brushSize,
                left: cursorPoint.x,
                top: cursorPoint.y,
                transform: "translate(-50%, -50%)",
              }}
            />
          ) : null}
          <canvas ref={brushCanvasRef} className="hidden" />
        </div>
      </div>
    );
  },
);

ImageMaskCanvas.displayName = "ImageMaskCanvas";

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/drawer-dialog";

export type ImageComparePayload = {
  url: string;
  title?: string;
};

export type ImageCompareRole = "before" | "after";

export type ImageCompareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  beforeImage?: ImageComparePayload | null;
  afterImage?: ImageComparePayload | null;
  beforeLabel?: string;
  afterLabel?: string;
  missingContent?: string;
  previewButtonLabel?: string;
  onPreviewImage?: (image: ImageComparePayload, role: ImageCompareRole) => void;
  width?: number | string;
};

export function ImageCompareDialog({
  open,
  onOpenChange,
  title = "图片对比",
  description,
  beforeImage,
  afterImage,
  beforeLabel = "原图",
  afterLabel = "结果图",
  missingContent = "缺少可对比的图片，暂时无法对比。",
  previewButtonLabel,
  onPreviewImage,
  width = 1180,
}: ImageCompareDialogProps) {
  const [slider, setSlider] = useState(50);
  const [dragging, setDragging] = useState(false);
  const compareRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setSlider(50);
      setDragging(false);
    }
  }, [open, beforeImage?.url, afterImage?.url]);

  const updateSliderFromClientX = useCallback((clientX: number) => {
    const rect = compareRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;

    const nextValue = ((clientX - rect.left) / rect.width) * 100;
    setSlider(Math.max(0, Math.min(100, Math.round(nextValue))));
  }, []);

  const adjustSlider = (delta: number) => {
    setSlider((current) => Math.max(0, Math.min(100, current + delta)));
  };

  const canCompare = Boolean(beforeImage?.url && afterImage?.url);
  const handlePreview = (image: ImageComparePayload | null | undefined, role: ImageCompareRole) => {
    if (!image?.url) return;
    onPreviewImage?.(image, role);
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      width={width}
      closeOnOverlayClick
      footer={
        <>
          <Button type="button" variant="outline" className="w-[100px]" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {onPreviewImage ? (
            <Button
              type="button"
              className="w-[110px]"
              onClick={() => handlePreview(afterImage, "after")}
              disabled={!afterImage?.url}
            >
              {previewButtonLabel ?? `查看${afterLabel}`}
            </Button>
          ) : null}
        </>
      }
    >
      {canCompare ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <div
              ref={compareRef}
              className="relative mx-auto flex min-h-[460px] max-w-[920px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-[linear-gradient(45deg,rgba(148,163,184,0.18)_25%,transparent_25%,transparent_50%,rgba(148,163,184,0.18)_50%,rgba(148,163,184,0.18)_75%,transparent_75%,transparent)] bg-[length:20px_20px]"
            >
              <img
                src={afterImage!.url}
                alt={afterImage!.title ?? afterLabel}
                className="max-h-[640px] max-w-full select-none object-contain"
                draggable={false}
              />
              <div
                className="absolute inset-0 flex items-center justify-center overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}
              >
                <img
                  src={beforeImage!.url}
                  alt={beforeImage!.title ?? beforeLabel}
                  className="max-h-[640px] max-w-full select-none object-contain"
                  draggable={false}
                />
              </div>
              <button
                type="button"
                className="absolute inset-y-0 z-10 w-10 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                style={{ left: `${slider}%` }}
                aria-label={`调整${beforeLabel}和${afterLabel}对比位置`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragging(true);
                  updateSliderFromClientX(event.clientX);
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  updateSliderFromClientX(event.clientX);
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  setDragging(false);
                }}
                onPointerCancel={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  setDragging(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    adjustSlider(event.shiftKey ? -10 : -2);
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    adjustSlider(event.shiftKey ? 10 : 2);
                  }
                  if (event.key === "Home") {
                    event.preventDefault();
                    setSlider(0);
                  }
                  if (event.key === "End") {
                    event.preventDefault();
                    setSlider(100);
                  }
                }}
              >
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.35)]" />
                <span
                  className={`absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-teal-600 shadow-lg transition-opacity duration-150 ${
                    dragging ? "opacity-0" : "opacity-100"
                  }`}
                >
                  <span className="h-4 w-px rounded-full bg-white/95" />
                  <span className="ml-1 h-4 w-px rounded-full bg-white/95" />
                </span>
              </button>
              <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/65 px-3 py-1 text-xs text-white">{beforeLabel}</div>
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/65 px-3 py-1 text-xs text-white">{afterLabel}</div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              className="rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:border-teal-300"
              onClick={() => handlePreview(beforeImage, "before")}
              disabled={!onPreviewImage}
            >
              <p className="mb-2 text-sm font-semibold">{beforeLabel}</p>
              <img src={beforeImage!.url} alt={beforeImage!.title ?? beforeLabel} className="max-h-[360px] w-full rounded-xl object-contain" />
            </button>
            <button
              type="button"
              className="rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:border-teal-300"
              onClick={() => handlePreview(afterImage, "after")}
              disabled={!onPreviewImage}
            >
              <p className="mb-2 text-sm font-semibold">{afterLabel}</p>
              <img src={afterImage!.url} alt={afterImage!.title ?? afterLabel} className="max-h-[360px] w-full rounded-xl object-contain" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          {missingContent}
        </div>
      )}
    </DrawerDialog>
  );
}

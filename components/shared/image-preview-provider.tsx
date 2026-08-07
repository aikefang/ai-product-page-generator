"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface ImagePreviewPayload {
  url: string;
  title?: string;
  meta?: string;
}

interface ImagePreviewContextValue {
  openImagePreview: (image: ImagePreviewPayload) => void;
  closeImagePreview: () => void;
}

const ImagePreviewContext = createContext<ImagePreviewContextValue | null>(null);

export function useImagePreview() {
  const context = useContext(ImagePreviewContext);
  if (!context) {
    throw new Error("useImagePreview must be used within ImagePreviewProvider");
  }

  return context;
}

export function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<ImagePreviewPayload | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!image) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.stopImmediatePropagation();
        setImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [image]);

  const value = useMemo<ImagePreviewContextValue>(
    () => ({
      openImagePreview: setImage,
      closeImagePreview: () => setImage(null),
    }),
    [],
  );

  return (
    <ImagePreviewContext.Provider value={value}>
      {children}
      {mounted && image ? createPortal(<ImagePreviewModal image={image} onClose={() => setImage(null)} />, document.body) : null}
    </ImagePreviewContext.Provider>
  );
}

function ImagePreviewModal({
  image,
  onClose,
}: {
  image: ImagePreviewPayload;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const shouldCloseFromTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false;
    }

    return !target.closest("[data-image-preview-image]");
  }, []);

  const closeFromPreviewEvent = useCallback((
    event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>,
  ) => {
    if (!shouldCloseFromTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onCloseRef.current();
  }, [shouldCloseFromTarget]);

  // Radix DismissableLayer adds a capture-phase pointerdown listener on
  // DOCUMENT. Our overlay is a portal on document.body, so Radix sees it as
  // "outside" and calls event.preventDefault(), which suppresses the
  // subsequent click event. To work around this, we intercept pointerdown at
  // the WINDOW level (fires before document capture), and if the target is
  // inside our overlay we stop propagation chain so Radix never sees it.
  useEffect(() => {
    const handleWindowPointerDown = (e: PointerEvent) => {
      const overlay = overlayRef.current;
      const target = e.target;
      if (!overlay || !(target instanceof Node) || !overlay.contains(target)) {
        return;
      }

      e.stopPropagation();
      e.stopImmediatePropagation();

      if (shouldCloseFromTarget(target)) {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    window.addEventListener("pointerdown", handleWindowPointerDown, true);

    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown, true);
    };
  }, []);

  const title = image.title ?? "图片预览";

  return (
    <div
      ref={overlayRef}
      className="pointer-events-auto fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-black/82 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`查看大图：${title}`}
      onMouseDownCapture={closeFromPreviewEvent}
      onPointerDownCapture={closeFromPreviewEvent}
      onTouchStartCapture={closeFromPreviewEvent}
    >
      <button
        type="button"
        data-image-preview-close
        className="fixed right-5 top-5 z-[10000] inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/14 text-white shadow-lg transition-colors hover:bg-white/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="关闭大图预览"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex h-full w-full max-w-7xl flex-col gap-3">
        <div className="pointer-events-none flex shrink-0 items-center justify-between gap-3 pr-14 text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            {image.meta ? <p className="text-xs text-white/65">{image.meta}</p> : null}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-white/5 p-2">
          <img
            src={image.url}
            alt={title}
            data-image-preview-image
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DrawerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  showFooter?: boolean;
  confirmContent?: ReactNode;
  cancelContent?: ReactNode;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  loading?: boolean;
  closeOnOverlayClick?: boolean;
  animationMs?: number;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  width?: number | string;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
}

export function DrawerDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  showFooter = true,
  confirmContent = "确认",
  cancelContent = "取消",
  confirmDisabled = false,
  cancelDisabled = false,
  loading = false,
  closeOnOverlayClick = true,
  animationMs = 320,
  onConfirm,
  onCancel,
  width = 1000,
  className,
  overlayClassName,
  contentClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
}: DrawerDialogProps) {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }

    const timer = window.setTimeout(() => setPresent(false), animationMs);
    return () => window.clearTimeout(timer);
  }, [animationMs, open]);

  const handleCancel = async () => {
    await onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    await onConfirm?.();
  };
  const drawerWidth = typeof width === "number" ? `${width}px` : width;

  if (!present) {
    return null;
  }

  return (
    <DialogPrimitive.Root
      open={present}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onOpenChange(false);
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[120] bg-slate-950/45 backdrop-blur-[2px] transition-[opacity,backdrop-filter] ease-out",
            open ? "opacity-100" : "opacity-0 backdrop-blur-none",
            overlayClassName,
          )}
          style={{ transitionDuration: `${animationMs}ms` }}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-[121] flex max-w-full flex-col border-l border-slate-200 bg-white text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.22)] outline-none",
            "transition-[transform,opacity] ease-[cubic-bezier(0.22,1,0.36,1)]",
            open ? "translate-x-0 opacity-100" : "translate-x-full opacity-95",
            "dark:border-white/10 dark:bg-[#0d0e10] dark:text-white",
            className,
          )}
          style={{ width: drawerWidth, transitionDuration: `${animationMs}ms` }}
          onPointerDownOutside={(event) => {
            if (!closeOnOverlayClick) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (!closeOnOverlayClick) {
              event.preventDefault();
            }
          }}
        >
          <div className={cn("flex min-h-16 shrink-0 flex-col justify-center border-b border-slate-200 px-6 py-4 dark:border-white/10", headerClassName)}>
            {title ? (
              <DialogPrimitive.Title className="text-xl font-semibold text-slate-950 dark:text-white">
                {title}
              </DialogPrimitive.Title>
            ) : (
              <DialogPrimitive.Title className="sr-only">抽屉弹窗</DialogPrimitive.Title>
            )}
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>

          <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", contentClassName, bodyClassName)}>
            {children}
          </div>

          {showFooter ? (
            <div className={cn("flex shrink-0 items-center justify-center gap-3 border-t border-slate-200 px-6 py-4 dark:border-white/10", footerClassName)}>
              {footer ?? (
                <>
                  <Button type="button" variant="outline" onClick={handleCancel} disabled={cancelDisabled || loading} className="w-[100px]">
                    {cancelContent}
                  </Button>
                  <Button type="button" onClick={handleConfirm} disabled={confirmDisabled || loading} className="w-[100px]">
                    {loading ? "处理中..." : confirmContent}
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

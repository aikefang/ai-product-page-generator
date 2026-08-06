"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  LocalRepaintPanel,
  type LocalRepaintMaskPayload,
  type LocalRepaintPanelHandle,
  type LocalRepaintPayload,
  type LocalRepaintReference,
} from "@/components/editor/local-repaint-panel";
import {
  ReferenceMaskSelectionPanel,
  type ReferenceMaskPayload,
  type ReferenceMaskSelectionPanelHandle,
} from "@/components/editor/reference-mask-selection-panel";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/drawer-dialog";

export type LocalRepaintRunMode = "sync" | "background";

export type LocalRepaintInstructionResult = {
  instruction: string;
  referenceCropImages?: string[];
};

export interface LocalRepaintDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl?: string | null;
  imageTitle?: string;
  title?: ReactNode;
  width?: number | string;
  references?: LocalRepaintReference[];
  referencePanel?: ReactNode;
  versionPanel?: ReactNode;
  emptyContent?: ReactNode;
  canRun?: boolean;
  runDisabledReason?: string;
  immediateRunning?: boolean;
  backgroundRunning?: boolean;
  closeOnOverlayClick?: boolean;
  onRun: (mode: LocalRepaintRunMode, payload: LocalRepaintPayload) => Promise<boolean | void> | boolean | void;
  onGenerateInstruction: (
    baseMaskPayload: LocalRepaintMaskPayload,
    references: ReferenceMaskPayload[],
  ) => Promise<LocalRepaintInstructionResult | void> | LocalRepaintInstructionResult | void;
}

export function LocalRepaintDrawer({
  open,
  onOpenChange,
  imageUrl,
  imageTitle,
  title = "局部重绘",
  width = 1000,
  references = [],
  referencePanel,
  versionPanel,
  emptyContent,
  canRun = true,
  runDisabledReason = "当前图片暂不可局部重绘，请稍后再试。",
  immediateRunning = false,
  backgroundRunning = false,
  closeOnOverlayClick = false,
  onRun,
  onGenerateInstruction,
}: LocalRepaintDrawerProps) {
  const localRepaintPanelRef = useRef<LocalRepaintPanelHandle | null>(null);
  const referenceMaskPanelRef = useRef<ReferenceMaskSelectionPanelHandle | null>(null);
  const [referenceMaskOpen, setReferenceMaskOpen] = useState(false);
  const [autoInstructionGenerating, setAutoInstructionGenerating] = useState(false);
  const [referenceCropImages, setReferenceCropImages] = useState<string[]>([]);

  const referenceSignature = useMemo(
    () => references.map((reference) => reference.id).join("|"),
    [references],
  );

  useEffect(() => {
    setReferenceCropImages([]);
    referenceMaskPanelRef.current?.reset();
  }, [imageUrl, referenceSignature]);

  const running = immediateRunning || backgroundRunning;
  const submitDisabled = !imageUrl || !canRun || running;

  const submitLocalRepaint = async (mode: LocalRepaintRunMode) => {
    if (!imageUrl) {
      toast.error("当前没有可局部重绘的图片。");
      return;
    }
    if (!canRun) {
      toast.error(runDisabledReason);
      return;
    }

    const validationMessage = localRepaintPanelRef.current?.getValidationMessage();
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    const payload = localRepaintPanelRef.current?.getPayload();
    if (!payload) {
      toast.error("局部重绘参数生成失败，请重新涂抹后再试。");
      return;
    }

    try {
      await onRun(mode, {
        ...payload,
        referenceCropImages,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "局部重绘提交失败");
    }
  };

  const requestLocalRepaintInstruction = async (
    referenceMasks: ReferenceMaskPayload[] = [],
    closeReferenceMaskDrawer = false,
  ) => {
    const baseMaskPayload = localRepaintPanelRef.current?.getMaskPayload();
    if (!baseMaskPayload) {
      toast.error("请先在当前图上涂抹需要局部重绘的区域。");
      return;
    }

    setAutoInstructionGenerating(true);
    try {
      const generatedCropImages = referenceMasks
        .map((reference) => reference.cropImage)
        .filter((image): image is string => Boolean(image));
      const result = await onGenerateInstruction(baseMaskPayload, referenceMasks);
      if (!result?.instruction) {
        throw new Error("自动生成修改说明失败");
      }

      setReferenceCropImages(result.referenceCropImages ?? generatedCropImages);
      localRepaintPanelRef.current?.setInstruction(result.instruction);
      if (closeReferenceMaskDrawer) {
        setReferenceMaskOpen(false);
      }
      toast.success(
        referenceMasks.length > 0
          ? "已结合参考图生成局部修改说明，可以继续微调后开始重绘。"
          : "已根据原图涂抹区域生成局部修改说明，可以继续微调后开始重绘。",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "自动生成修改说明失败");
    } finally {
      setAutoInstructionGenerating(false);
    }
  };

  const openAutoInstructionDrawer = () => {
    const maskValidationMessage = localRepaintPanelRef.current?.getMaskValidationMessage();
    if (maskValidationMessage) {
      toast.error(maskValidationMessage);
      return;
    }

    if (references.length === 0) {
      void requestLocalRepaintInstruction([]);
      return;
    }

    setReferenceMaskOpen(true);
  };

  const generateLocalRepaintInstruction = async () => {
    const referenceValidationMessage = referenceMaskPanelRef.current?.getValidationMessage();
    if (referenceValidationMessage) {
      toast.error(referenceValidationMessage);
      return;
    }

    const referenceMasks = referenceMaskPanelRef.current?.getPayload() ?? [];
    if (referenceMasks.length === 0) {
      toast.error("请至少在一张参考图上涂抹需要参考的区域。");
      return;
    }

    await requestLocalRepaintInstruction(referenceMasks, true);
  };

  return (
    <>
      <DrawerDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        width={width}
        closeOnOverlayClick={closeOnOverlayClick}
        showFooter
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-[100px]">
              关闭
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void submitLocalRepaint("background")}
              disabled={submitDisabled}
              className="w-[100px]"
            >
              {backgroundRunning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {backgroundRunning ? "重绘中..." : "后台重绘"}
            </Button>
            <Button
              type="button"
              onClick={() => void submitLocalRepaint("sync")}
              disabled={submitDisabled}
              className="w-[100px]"
            >
              {immediateRunning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {immediateRunning ? "处理中..." : "立即重绘"}
            </Button>
          </>
        }
      >
        {imageUrl ? (
          <LocalRepaintPanel
            ref={localRepaintPanelRef}
            imageUrl={imageUrl}
            title={imageTitle}
            references={references}
            referencePanel={referencePanel}
            versionPanel={versionPanel}
            autoInstructionLoading={autoInstructionGenerating}
            onAutoGenerateInstruction={openAutoInstructionDrawer}
          />
        ) : (
          emptyContent ?? <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-sm leading-6 text-muted-foreground">
            当前没有可局部重绘的图片，请先选择或生成一张图片。
          </div>
        )}
      </DrawerDialog>

      <DrawerDialog
        open={referenceMaskOpen}
        onOpenChange={setReferenceMaskOpen}
        title="参考图选位置"
        description="根据已带入的参考图，涂抹每张参考图中希望 AI 借鉴的局部细节。"
        width={1000}
        closeOnOverlayClick={false}
        confirmContent="生成说明"
        loading={autoInstructionGenerating}
        confirmDisabled={references.length === 0 || autoInstructionGenerating}
        cancelDisabled={autoInstructionGenerating}
        onCancel={() => setReferenceMaskOpen(false)}
        onConfirm={generateLocalRepaintInstruction}
      >
        <ReferenceMaskSelectionPanel ref={referenceMaskPanelRef} references={references} />
      </DrawerDialog>
    </>
  );
}

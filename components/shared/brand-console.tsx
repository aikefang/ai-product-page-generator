"use client";

import { useEffect } from "react";

const printedFlag = "__turingBrandConsolePrinted";

export function BrandConsole() {
  useEffect(() => {
    const scopedWindow = window as unknown as Window & Record<string, unknown>;
    if (scopedWindow[printedFlag]) return;
    scopedWindow[printedFlag] = true;

    console.log(
      "%cTuring · 图灵绘画",
      "font-size:22px;font-weight:800;color:#111827;line-height:1.8;",
    );
    console.log(
      "%c图灵绘画：面向 AI 绘画、商品视觉和可编辑商业内容的创作工作台。",
      "font-size:13px;color:#334155;line-height:1.8;",
    );
    console.log(
      "%c支持 OpenAI 兼容协议、GPT 系列模型、gpt-image-2、生图编辑、批量创建和本地化部署。",
      "font-size:12px;color:#64748b;line-height:1.8;",
    );
    console.log(
      "%cTuring customized workspace.",
      "font-size:12px;color:#e11d48;line-height:1.8;",
    );
  }, []);

  return null;
}

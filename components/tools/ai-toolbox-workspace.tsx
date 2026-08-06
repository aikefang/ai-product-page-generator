"use client";

import {
  Aperture,
  Brush,
  Eraser,
  Expand,
  Image,
  ImagePlus,
  Languages,
  Maximize2,
  Mountain,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const tools = [
  {
    title: "局部重绘",
    description: "涂抹局部区域，只重新生成需要修改的位置。",
    icon: Brush,
  },
  {
    title: "智能扩图",
    description: "在原图基础上向外延展画布，补全场景和背景。",
    icon: Expand,
  },
  {
    title: "以图生图",
    description: "参考商品图，生成新场景、新角度或新动作图片。",
    icon: ImagePlus,
  },
  {
    title: "文生图",
    description: "通过文字描述生成商品视觉、场景图或创意图。",
    icon: Sparkles,
  },
  {
    title: "图片增强",
    description: "提升清晰度、质感、光影和整体视觉表现。",
    icon: Aperture,
  },
  {
    title: "背景替换",
    description: "保留主体，替换成更适合转化的背景环境。",
    icon: Mountain,
  },
  {
    title: "商品换场景",
    description: "把商品自然放入家居、户外、办公等指定场景。",
    icon: Image,
  },
  {
    title: "高清放大",
    description: "对图片进行高清修复和等比例放大。",
    icon: Maximize2,
  },
  {
    title: "抠图去背景",
    description: "自动识别主体，生成透明底或纯色底商品图。",
    icon: Eraser,
  },
  {
    title: "图片翻译",
    description: "识别图中文字并转换成目标语言，尽量保持原排版。",
    icon: Languages,
  },
];

export function AiToolboxWorkspace() {
  const handleOpenSoon = (name: string) => {
    toast.message(`${name} 即将开放`);
  };

  return (
    <div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Card
              key={tool.title}
              role="button"
              tabIndex={0}
              onClick={() => handleOpenSoon(tool.title)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleOpenSoon(tool.title);
                }
              }}
              className="group cursor-pointer overflow-hidden rounded-3xl border-slate-200 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-teal-200 hover:shadow-xl hover:shadow-teal-950/5 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-teal-300/30"
            >
              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-600 group-hover:text-white dark:bg-teal-400/10 dark:text-teal-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge variant="outline">即将开放</Badge>
                </div>
                <div>
                  <CardTitle className="text-base">{tool.title}</CardTitle>
                  <CardDescription className="mt-2 min-h-10 text-sm leading-5">
                    {tool.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-2xl"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenSoon(tool.title);
                  }}
                >
                  查看能力
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}

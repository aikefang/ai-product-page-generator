"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  GalleryVerticalEnd,
  History,
  Images,
  KeyRound,
  LayoutDashboard,
  Menu,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";

import { ApiUsageIndicator } from "@/components/layout/api-usage-indicator";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const appName = "图灵绘画";
const SIDEBAR_STORAGE_KEY = "turing-sidebar-collapsed";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

const navItems: NavItem[] = [
  {
    href: "/",
    label: "快速开始",
    description: "创建新项目和继续最近工作流",
    icon: LayoutDashboard,
    match: (pathname) => pathname === "/",
  },
  {
    href: "/settings/providers",
    label: "API 密钥",
    description: "模型供应商与密钥配置",
    icon: KeyRound,
    match: (pathname) => pathname.startsWith("/settings/providers"),
  },
  {
    href: "/monitor/usage",
    label: "使用记录",
    description: "查看调用、额度和失败重试",
    icon: History,
    match: (pathname) => pathname.startsWith("/monitor/usage"),
  },
  {
    href: "/batch-create",
    label: "批量创建",
    description: "一次处理多个商品图",
    icon: Images,
    match: (pathname) => pathname.startsWith("/batch-create"),
  },
  {
    href: "/xiaohongshu/plan",
    label: "小红书图文",
    description: "生成小红书图文内容",
    icon: BookOpenText,
    match: (pathname) => pathname.startsWith("/xiaohongshu"),
  },
  {
    href: "/projects/new",
    label: "高级创建",
    description: "创建完整商品详情页项目",
    icon: GalleryVerticalEnd,
    match: (pathname) => pathname.startsWith("/projects/new") || pathname.startsWith("/projects/"),
  },
  {
    href: "/history",
    label: "历史项目",
    description: "回看和继续已有项目",
    icon: FolderKanban,
    match: (pathname) => pathname.startsWith("/history"),
  },
];

function resolveCurrentItem(pathname: string) {
  return navItems.find((item) => item.match?.(pathname)) ?? navItems[0];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const currentItem = useMemo(() => resolveCurrentItem(pathname), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#f6f9fa] text-slate-900 dark:bg-[#070809] dark:text-slate-100">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭菜单遮罩"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[255px] flex-col border-r border-slate-200/80 bg-white shadow-[12px_0_36px_-30px_rgba(15,23,42,0.42)] transition-[transform,width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-white/10 dark:bg-[#0d0e10]",
          collapsed ? "md:w-20" : "md:w-[255px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div
          className="flex h-20 items-center justify-between border-b border-slate-100 px-3 transition-all dark:border-white/10"
        >
          <Link href="/" className="flex min-w-0 flex-1 items-center">
            <span className="flex w-14 shrink-0 items-center justify-center">
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10">
                <img src="/brand-icon.ico" alt={appName} className="h-full w-full object-cover" suppressHydrationWarning />
              </span>
            </span>
            <div
              className={cn(
                "min-w-0 overflow-hidden transition-[width,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                collapsed ? "md:w-0 md:translate-x-0 md:opacity-0" : "md:w-[160px] md:translate-x-0 md:opacity-100",
              )}
            >
              <p className="truncate text-lg font-semibold text-slate-950 dark:text-white">{appName}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">AI 商品图文工作台</p>
            </div>
          </Link>
          <button
            type="button"
            aria-label="关闭菜单"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:hidden dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-6">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.match?.(pathname) ?? false;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center rounded-2xl py-3 text-sm font-medium transition-all duration-200",
                  active
                    ? "bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-200"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#1f2a3a] dark:hover:text-white",
                )}
              >
                <span className="flex w-14 shrink-0 items-center justify-center">
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-colors",
                      active
                        ? "text-teal-600 dark:text-teal-300"
                        : "text-slate-500 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-[width,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    collapsed ? "md:w-0 md:translate-x-0 md:opacity-0" : "md:w-[165px] md:translate-x-0 md:opacity-100",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-slate-100 p-3 dark:border-white/10">
          <ThemeToggle collapsed={collapsed} />
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "group hidden w-full items-center rounded-2xl py-3 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-950 md:flex dark:text-slate-300 dark:hover:bg-[#1f2a3a] dark:hover:text-white",
            )}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开" : "收起"}
          >
            <span className="flex w-14 shrink-0 items-center justify-center">
              {collapsed ? (
                <ChevronsRight className="h-5 w-5 text-slate-500 transition-colors group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white" />
              ) : (
                <ChevronsLeft className="h-5 w-5 text-slate-500 transition-colors group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white" />
              )}
            </span>
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap transition-[width,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                collapsed ? "md:w-0 md:translate-x-0 md:opacity-0" : "md:w-10 md:translate-x-0 md:opacity-100",
              )}
            >
              收起
            </span>
          </button>
        </div>
      </aside>

      <div className={cn("min-h-screen transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", collapsed ? "md:pl-20" : "md:pl-[255px]")}>
        <header
          className={cn(
            "fixed left-0 right-0 top-0 z-30 h-16 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl transition-[left] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-white/10 dark:bg-[#0d0e10]/88",
            collapsed ? "md:left-20" : "md:left-[255px]",
          )}
        >
          <div className="flex h-full items-center justify-between gap-4 px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="打开菜单"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm md:hidden dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-slate-950 dark:text-white">{currentItem.label}</h1>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">{currentItem.description}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 md:gap-3">
              <Link
                href="/settings/providers"
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "hidden h-10 gap-2 rounded-2xl px-3 text-slate-600 md:inline-flex dark:text-slate-300",
                )}
              >
                <Settings2 className="h-4 w-4" />
                API 配置
              </Link>
              <Link
                href="/monitor/usage"
                className="hidden h-10 items-center rounded-full bg-teal-50 px-3 text-sm font-semibold text-teal-700 shadow-sm sm:inline-flex dark:bg-teal-400/10 dark:text-teal-200"
              >
                <ApiUsageIndicator className="[&>span]:bg-transparent [&>span]:px-0 [&>span]:text-teal-700 dark:[&>span]:text-teal-200" />
              </Link>
            </div>
          </div>
        </header>

        <main className="min-h-screen px-4 pb-8 pt-20 md:px-8 md:pb-10">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

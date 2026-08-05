"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "mxpage-theme";
const LEGACY_STORAGE_KEY = "banana-mall-theme";

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
}

function resolveTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const nextTheme = resolveTheme();
    setTheme(nextTheme);
    applyTheme(nextTheme);
    setMounted(true);
  }, []);

  const toggle = () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
  };

  const currentTheme = mounted ? theme : "light";
  const isDark = currentTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "group flex w-full items-center rounded-2xl py-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-[#1f2a3a] dark:hover:text-white",
      )}
      aria-label={isDark ? "切换到白天风格" : "切换到黑夜风格"}
      title={isDark ? "切换到白天风格" : "切换到黑夜风格"}
    >
      <span className="flex w-14 shrink-0 items-center justify-center">
        {isDark ? (
          <SunMedium className="h-5 w-5 text-amber-500" />
        ) : (
          <MoonStar className="h-5 w-5 text-slate-500 transition-colors group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white" />
        )}
      </span>
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-left transition-[width,opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "md:w-0 md:translate-x-0 md:opacity-0" : "md:w-[165px] md:translate-x-0 md:opacity-100",
        )}
      >
        {isDark ? "浅色模式" : "深色模式"}
      </span>
    </button>
  );
}

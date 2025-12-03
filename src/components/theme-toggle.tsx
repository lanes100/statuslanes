"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type Props = {
  variant?: "menu" | "icon";
};

export default function ThemeToggle({ variant = "menu" }: Props) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const current = resolvedTheme === "light" ? "light" : "dark";
  const nextTheme = current === "dark" ? "light" : "dark";
  const nextLabel = nextTheme === "dark" ? "Dark mode" : "Light mode";

  const handleToggle = () => {
    setTheme(nextTheme);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        aria-label={`Switch to ${nextLabel}`}
        aria-pressed={current === "dark"}
        className="rounded-full border border-zinc-200 bg-white/80 p-2 text-zinc-700 shadow-sm transition hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
      >
        <span aria-hidden className="text-lg">
          {current === "dark" ? "🌙" : "☀️"}
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
      <div className="flex flex-col">
        <span className="font-semibold">Appearance</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{current === "dark" ? "Dark mode" : "Light mode"}</span>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        aria-pressed={current === "dark"}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        Switch to {nextLabel}
      </button>
    </div>
  );
}

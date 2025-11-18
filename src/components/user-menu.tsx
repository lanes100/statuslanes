"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = { email: string };

export default function UserMenu({ email }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!open) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const logout = async () => {
    setSigningOut(true);
    await fetch("/api/logout", { method: "POST" });
    window.location.assign("/login");
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Open menu"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-12 w-12 items-center justify-center rounded-full text-zinc-700 transition hover:bg-zinc-100/50 active:bg-zinc-200/60 dark:text-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-700/60"
      >
        <div className="flex flex-col gap-[6px]">
          <span className="block h-[3px] w-6 rounded-full bg-current" />
          <span className="block h-[3px] w-6 rounded-full bg-current" />
          <span className="block h-[3px] w-6 rounded-full bg-current" />
        </div>
      </button>

      <div
        ref={panelRef}
        className={`absolute right-0 mt-2 w-60 origin-top-right rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-800 shadow-lg transition-all duration-150 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 ${
          open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="flex flex-col items-stretch gap-4">
          <Link
            href="/about"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-center text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => setOpen(false)}
          >
            About & Privacy
          </Link>
          <Link
            href="/settings"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-center text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>

          <div className="h-8" aria-hidden="true" />

          <div className="flex w-full flex-col gap-2 items-center">
            <div className="w-full px-3 py-2 text-center text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {email}
            </div>
            <button
              onClick={logout}
              disabled={signingOut}
              className="w-full rounded-lg bg-zinc-100 px-4 py-3 text-center text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

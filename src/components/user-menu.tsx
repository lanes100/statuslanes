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
        className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <div className="flex flex-col gap-[5px]">
          <span className="block h-[2px] w-5 rounded-full bg-current" />
          <span className="block h-[2px] w-5 rounded-full bg-current" />
          <span className="block h-[2px] w-5 rounded-full bg-current" />
        </div>
      </button>

      <div
        ref={panelRef}
        className={`absolute right-0 mt-2 w-60 origin-top-right rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-800 shadow-lg transition-all duration-150 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 ${
          open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="flex flex-col gap-4">
          <Link
            href="/settings"
            className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>

          <div className="h-8" aria-hidden="true" />

          <div className="flex flex-col gap-2">
            <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {email}
            </div>
            <button
              onClick={logout}
              disabled={signingOut}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

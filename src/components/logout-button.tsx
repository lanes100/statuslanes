"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const logout = async () => {
    setLoading(true);
    await fetch("/api/logout", { method: "POST" });
    router.refresh();
    setLoading(false);
  };

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500"
    >
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}

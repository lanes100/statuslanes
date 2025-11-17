"use client";

import { useEffect, useState } from "react";

type Toast = {
  id: string;
  message: string;
  type?: "error" | "success" | "info";
  ttl?: number;
};

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const addToast = (toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    const ttl = toast.ttl ?? 4000;
    const nextToast: Toast = { id, ...toast, ttl };
    setToasts((prev) => [...prev, nextToast]);
    setTimeout(() => {
      removeToast(id);
    }, ttl);
  };

  return { toasts, addToast, removeToast };
}

export function ToastShelf({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && toasts.length) {
        onClose(toasts[0].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toasts, onClose]);

  if (!toasts.length) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6">
      <div className="flex w-full max-w-md flex-col gap-2">
        {toasts.map((toast) => {
          const color =
            toast.type === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-zinc-200 bg-white text-zinc-900";
          return (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg shadow-black/5 backdrop-blur ${color}`}
              role="status"
              aria-live="polite"
            >
              <div className="flex-1 text-sm">{toast.message}</div>
              <button
                onClick={() => onClose(toast.id)}
                className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-900"
                >
                Close
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

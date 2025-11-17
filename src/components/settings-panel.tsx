"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ToastShelf, useToast } from "@/components/toast";

type DeviceSettings = {
  deviceId: string;
  showLastUpdated?: boolean;
  showStatusSource?: boolean;
};

export default function SettingsPanel() {
  const [device, setDevice] = useState<DeviceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
      document.documentElement.classList.toggle("dark", stored === "dark");
    }
  }, []);

  useEffect(() => {
    const fetchDevice = async () => {
      try {
        setLoading(true);
        const res = await apiFetch<{ device: { deviceId: string; showLastUpdated?: boolean; showStatusSource?: boolean } }>(
          "/api/device",
        );
        setDevice({
          deviceId: res.device.deviceId,
          showLastUpdated: res.device.showLastUpdated ?? true,
          showStatusSource: res.device.showStatusSource ?? true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load settings";
        addToast({ message, type: "error" });
      } finally {
        setLoading(false);
      }
    };
    fetchDevice();
  }, [addToast]);

  const toggleTheme = (next: "light" | "dark") => {
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const saveSettings = async () => {
    if (!device) return;
    setSaving(true);
    try {
      await apiFetch("/api/device", {
        method: "PATCH",
        body: JSON.stringify({
          deviceId: device.deviceId,
          showLastUpdated: device.showLastUpdated,
          showStatusSource: device.showStatusSource,
        }),
      });
      addToast({ message: "Settings updated", type: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update settings";
      addToast({ message, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !device) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm text-sm text-zinc-600">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">Settings</h2>
        <span className="text-xs text-zinc-500">Device: {device.deviceId}</span>
      </div>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800">
          <span>Show last updated</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={device.showLastUpdated ?? true}
            onChange={(e) => setDevice({ ...device, showLastUpdated: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800">
          <span>Show status source</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={device.showStatusSource ?? true}
            onChange={(e) => setDevice({ ...device, showStatusSource: e.target.checked })}
          />
        </label>
        <div className="flex items-center justify-between gap-3 text-sm text-zinc-800">
          <span>Theme</span>
          <div className="flex gap-2">
            <button
              onClick={() => toggleTheme("light")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                theme === "light" ? "bg-black text-white" : "bg-zinc-100 text-zinc-800"
              }`}
            >
              Light
            </button>
            <button
              onClick={() => toggleTheme("dark")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                theme === "dark" ? "bg-black text-white" : "bg-zinc-100 text-zinc-800"
              }`}
            >
              Dark
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={saveSettings}
        disabled={saving}
        className="w-full rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>

      <ToastShelf toasts={toasts} onClose={removeToast} />
    </div>
  );
}

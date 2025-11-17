"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ToastShelf, useToast } from "@/components/toast";

type DeviceSettings = {
  deviceId: string;
  showLastUpdated?: boolean;
  showStatusSource?: boolean;
  timezone?: string;
  timeFormat?: string;
  dateFormat?: string;
};

export default function SettingsPanel() {
  const [device, setDevice] = useState<DeviceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toasts, addToast, removeToast } = useToast();
  const timezones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const timeFormats = [
    { value: "24h", label: "24-hour" },
    { value: "12h", label: "12-hour" },
  ];
  const dateFormats = [
    { value: "MDY", label: "MM/DD/YYYY" },
    { value: "DMY", label: "DD/MM/YYYY" },
    { value: "YMD", label: "YYYY-MM-DD" },
  ];

  useEffect(() => {
    const fetchDevice = async () => {
      try {
        setLoading(true);
        const res = await apiFetch<{
          device: {
            deviceId: string;
            showLastUpdated?: boolean;
            showStatusSource?: boolean;
            timezone?: string;
            timeFormat?: string;
            dateFormat?: string;
          };
        }>("/api/device");
        setDevice({
          deviceId: res.device.deviceId,
          showLastUpdated: res.device.showLastUpdated ?? true,
          showStatusSource: res.device.showStatusSource ?? false,
          timezone: res.device.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          timeFormat: res.device.timeFormat ?? "24h",
          dateFormat: res.device.dateFormat ?? "MDY",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load settings";
        // hide settings if device not registered yet
        if (message.toLowerCase().includes("not found")) {
          setDevice(null);
        } else {
          addToast({ message, type: "error" });
        }
      } finally {
        setLoading(false);
      }
    };
    fetchDevice();
  }, [addToast]);

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
          timezone: device.timezone,
          timeFormat: device.timeFormat,
          dateFormat: device.dateFormat,
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

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        Loading settings…
      </div>
    );
  }
  if (!device) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Settings</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Device: {device.deviceId}</span>
      </div>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800 dark:text-zinc-100">
          <span>Show last updated (default on)</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={device.showLastUpdated ?? true}
            onChange={(e) => setDevice({ ...device, showLastUpdated: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800 dark:text-zinc-100">
          <span>Show status source (default off)</span>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={device.showStatusSource ?? false}
            onChange={(e) => setDevice({ ...device, showStatusSource: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800 dark:text-zinc-100">
          <span>Timezone</span>
          <select
            value={device.timezone ?? ""}
            onChange={(e) => setDevice({ ...device, timezone: e.target.value })}
            className="w-48 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {(device.timezone ? [device.timezone] : []).concat(timezones).filter((v, i, arr) => arr.indexOf(v) === i).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800 dark:text-zinc-100">
          <span>Time format</span>
          <select
            value={device.timeFormat ?? "24h"}
            onChange={(e) => setDevice({ ...device, timeFormat: e.target.value })}
            className="w-32 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {timeFormats.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-800 dark:text-zinc-100">
          <span>Date format</span>
          <select
            value={device.dateFormat ?? "MDY"}
            onChange={(e) => setDevice({ ...device, dateFormat: e.target.value })}
            className="w-32 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {dateFormats.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        onClick={saveSettings}
        disabled={saving}
        className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>

      <ToastShelf toasts={toasts} onClose={removeToast} />
    </div>
  );
}

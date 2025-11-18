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
  calendarIcsUrl?: string | null;
  calendarMeetingStatusKey?: number | null;
  calendarOooStatusKey?: number | null;
  calendarIdleStatusKey?: number | null;
  statuses?: { key: number; label: string; enabled: boolean }[];
};

const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

const detectDeviceTimeFormat = (): "24h" | "12h" => {
  try {
    const formatter = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
    const parts = formatter.formatToParts(new Date());
    if (parts.some((p) => p.type === "dayPeriod")) return "12h";
    return "24h";
  } catch {
    return "24h";
  }
};

export default function SettingsPanel() {
  const [device, setDevice] = useState<DeviceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toasts, addToast, removeToast } = useToast();
  const timezones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const browserTimezone = getBrowserTimezone();
  const browserTimeFormat = detectDeviceTimeFormat();
  const timeFormats = [
    { value: "24h", label: "24-hour" },
    { value: "12h", label: "12-hour" },
  ];
  const dateFormats = [
    { value: "MDY", label: "MM/DD/YYYY" },
    { value: "DMY", label: "DD/MM/YYYY" },
    { value: "YMD", label: "YYYY-MM-DD" },
  ];
  const statusOptions =
    (device?.statuses ?? []).filter((s) => s.enabled && s.label.trim().length > 0 && Number.isInteger(s.key)) || [];

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
            calendarIcsUrl?: string | null;
            calendarMeetingStatusKey?: number | null;
            calendarOooStatusKey?: number | null;
            calendarIdleStatusKey?: number | null;
            statuses?: { key: number; label: string; enabled: boolean }[];
          };
        }>("/api/device");
        setDevice({
          deviceId: res.device.deviceId,
          showLastUpdated: res.device.showLastUpdated ?? true,
          showStatusSource: res.device.showStatusSource ?? false,
          timezone: res.device.timezone ?? browserTimezone ?? "",
          timeFormat: res.device.timeFormat ?? browserTimeFormat,
          dateFormat: res.device.dateFormat ?? "MDY",
          calendarIcsUrl: res.device.calendarIcsUrl ?? null,
          calendarMeetingStatusKey: res.device.calendarMeetingStatusKey ?? null,
          calendarOooStatusKey: res.device.calendarOooStatusKey ?? null,
          calendarIdleStatusKey: res.device.calendarIdleStatusKey ?? null,
          statuses: res.device.statuses ?? [],
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
          calendarIcsUrl: device.calendarIcsUrl,
          calendarMeetingStatusKey: device.calendarMeetingStatusKey,
          calendarOooStatusKey: device.calendarOooStatusKey,
          calendarIdleStatusKey: device.calendarIdleStatusKey,
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

  const removeDevice = async () => {
    if (!device) return;
    const confirmed = window.confirm("This will remove your TRMNL device from Statuslanes. You can re-register it afterwards.");
    if (!confirmed) return;
    setDeleting(true);
    try {
      await apiFetch("/api/device?id=" + encodeURIComponent(device.deviceId), { method: "DELETE" });
      addToast({ message: "Device removed. Register again to reconnect.", type: "success" });
      setDevice(null);
      // Hard refresh so the dashboard reruns its fetch and shows the registration form
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove device";
      addToast({ message, type: "error" });
    } finally {
      setDeleting(false);
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

      <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Calendar synchronization</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            Paste an ICS feed to map meetings or out-of-office events to statuses.
          </p>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">ICS URL</label>
          <input
            type="url"
            placeholder="https://example.com/calendar.ics"
            value={device.calendarIcsUrl ?? ""}
            onChange={(e) => setDevice({ ...device, calendarIcsUrl: e.target.value })}
            className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-white dark:focus:ring-white/10"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Meetings map to</label>
            <select
              value={device.calendarMeetingStatusKey ?? ""}
              onChange={(e) =>
                setDevice({ ...device, calendarMeetingStatusKey: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">Do nothing</option>
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Out of office map to</label>
            <select
              value={device.calendarOooStatusKey ?? ""}
              onChange={(e) => setDevice({ ...device, calendarOooStatusKey: e.target.value ? Number(e.target.value) : null })}
              className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">Do nothing</option>
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">No events map to</label>
            <select
              value={device.calendarIdleStatusKey ?? ""}
              onChange={(e) => setDevice({ ...device, calendarIdleStatusKey: e.target.value ? Number(e.target.value) : null })}
              className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">Do nothing</option>
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button
        onClick={saveSettings}
        disabled={saving}
        className="w-full rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>

      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Remove device</p>
            <p className="text-xs text-red-800 dark:text-red-200/80">
              This deletes the saved TRMNL plugin for this account so you can set it up again.
            </p>
          </div>
          <button
            onClick={removeDevice}
            disabled={deleting}
            className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {deleting ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>

      <ToastShelf toasts={toasts} onClose={removeToast} />
    </div>
  );
}

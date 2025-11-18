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
  calendarKeywords?: string[];
  calendarIds?: string[];
  calendarKeywordStatusKey?: number | null;
  calendarDetectVideoLinks?: boolean;
  calendarVideoStatusKey?: number | null;
  calendarIdleUsePreferred?: boolean;
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
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<{ id: string; summary: string; primary?: boolean }[]>([]);
  const [calendarSelection, setCalendarSelection] = useState<string[]>([]);
  const { toasts, addToast, removeToast } = useToast();
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [calendarLoadError, setCalendarLoadError] = useState<string | null>(null);
  const [googleLastSynced, setGoogleLastSynced] = useState<number | null>(null);
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
            calendarKeywords?: string[];
            calendarIds?: string[];
            calendarKeywordStatusKey?: number | null;
            calendarVideoStatusKey?: number | null;
            calendarDetectVideoLinks?: boolean;
            calendarIdleUsePreferred?: boolean;
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
          calendarOooStatusKey: res.device.calendarOooStatusKey ?? 5,
          calendarIdleStatusKey: res.device.calendarIdleUsePreferred ? null : res.device.calendarIdleStatusKey ?? null,
          statuses: res.device.statuses ?? [],
          calendarKeywords: res.device.calendarKeywords ?? [],
          calendarKeywordStatusKey: res.device.calendarKeywordStatusKey ?? null,
          calendarVideoStatusKey: res.device.calendarVideoStatusKey ?? 2,
          calendarDetectVideoLinks: res.device.calendarDetectVideoLinks ?? true,
          calendarIdleUsePreferred: res.device.calendarIdleUsePreferred ?? true,
          // store selection separately for UI
        });
        setCalendarSelection(res.device.calendarIds ?? []);
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
    const fetchGoogleStatus = async () => {
      try {
        const res = await apiFetch<{ connected: boolean; lastSyncedAt: number | null }>("/api/google-calendar/status", {
          retry: false,
        });
        setGoogleConnected(res.connected);
        setGoogleLastSynced(res.lastSyncedAt ?? null);
        if (res.connected) {
          await refreshGoogleCalendars();
        }
      } catch {
        setGoogleConnected(false);
        setCalendarLoadError("Not connected to Google Calendar");
      }
    };
    fetchGoogleStatus();
  }, [addToast]);

  // Auto-save settings on change (with debounce)
  useEffect(() => {
    if (!device || loading) return;
    const handle = setTimeout(() => {
      saveSettings(true);
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, calendarSelection]);

  const saveSettings = async (silent?: boolean) => {
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
          calendarKeywords: device.calendarKeywords ?? [],
          calendarKeywordStatusKey: device.calendarKeywordStatusKey ?? null,
          calendarIds: calendarSelection,
          calendarDetectVideoLinks: device.calendarDetectVideoLinks ?? false,
          calendarVideoStatusKey: device.calendarVideoStatusKey ?? null,
          calendarIdleUsePreferred: device.calendarIdleUsePreferred ?? false,
        }),
      });
      if (!silent) {
        addToast({ message: "Settings updated", type: "success" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update settings";
      addToast({ message, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const startGoogleConnect = async () => {
    try {
      const res = await apiFetch<{ url: string }>("/api/google-calendar/auth");
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start Google auth";
      addToast({ message, type: "error" });
    }
  };

  const syncGoogleCalendar = async () => {
    setSyncingGoogle(true);
    try {
      await apiFetch("/api/google-calendar/sync", { method: "POST" });
      addToast({ message: "Google Calendar synced", type: "success" });
      await refreshGoogleCalendars();
      setGoogleLastSynced(Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sync Google Calendar";
      addToast({ message, type: "error" });
    } finally {
      setSyncingGoogle(false);
    }
  };

  const refreshGoogleCalendars = async () => {
    setLoadingCalendars(true);
    setCalendarLoadError(null);
    try {
      const calRes = await apiFetch<{ calendars: { id: string; summary: string; primary?: boolean }[] }>(
        "/api/google-calendar/calendars",
        { retry: false }
      );
      setGoogleCalendars(calRes.calendars || []);
      if (!calRes.calendars || calRes.calendars.length === 0) {
        setCalendarLoadError("No calendars returned for this account.");
      }
    } catch (err) {
      console.error("calendar fetch failed", err);
      setGoogleCalendars([]);
      const message = err instanceof Error ? err.message : "Failed to load calendars";
      setCalendarLoadError(message);
      addToast({ message, type: "error" });
    } finally {
      setLoadingCalendars(false);
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
      // Send the user back to the main page so the dashboard shows the registration form
      window.location.assign("/");
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
            Connect Google Calendar or paste an ICS feed. Timed events use “Meetings map to”, all-day events use “Out of office map to”, and keyword matches use “Keyword matches map to”.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={googleConnected ? undefined : startGoogleConnect}
              className={`rounded-md px-3 py-2 text-xs font-semibold shadow-sm ring-1 transition ${
                googleConnected
                  ? "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-100 dark:ring-red-800"
                  : "bg-white text-zinc-800 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-700"
              }`}
              onClickCapture={
                googleConnected
                  ? async () => {
                      try {
                        await apiFetch("/api/google-calendar/disconnect", { method: "POST" });
                        setGoogleConnected(false);
                        setGoogleCalendars([]);
                        setCalendarSelection([]);
                        setGoogleLastSynced(null);
                        addToast({ message: "Google disconnected", type: "success" });
                      } catch (err) {
                        const message = err instanceof Error ? err.message : "Failed to disconnect";
                        addToast({ message, type: "error" });
                      }
                    }
                  : undefined
              }
            >
              {googleConnected ? "Disconnect Google" : "Connect Google Calendar"}
            </button>
            {googleConnected !== null && (
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {googleConnected ? "Connected" : "Not connected"}
              </span>
            )}
          </div>
          {googleConnected ? (
            <div className="flex flex-col items-start gap-3">
              <button
                type="button"
              onClick={refreshGoogleCalendars}
              disabled={loadingCalendars}
              className="rounded-md bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-700"
            >
              {loadingCalendars ? "Refreshing…" : "Refresh calendars"}
            </button>
              <button
                type="button"
                onClick={syncGoogleCalendar}
                disabled={syncingGoogle}
                className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {syncingGoogle ? "Syncing…" : "Sync Google now"}
              </button>
              <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                Last synced: {googleLastSynced ? new Date(googleLastSynced).toLocaleString() : "Not yet synced"}
              </div>
            </div>
          ) : null}
        </div>
        {googleConnected && googleCalendars.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Google calendars to sync</p>
            <div className="space-y-1">
              {googleCalendars.map((cal) => {
                const checked = calendarSelection.includes(cal.id);
                return (
                  <label
                    key={cal.id}
                    className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700"
                  >
                    <span className="flex-1 text-zinc-800 dark:text-zinc-100">
                      {cal.summary} {cal.primary ? "(Primary)" : ""}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(calendarSelection);
                        if (e.target.checked) {
                          next.add(cal.id);
                        } else {
                          next.delete(cal.id);
                        }
                        setCalendarSelection(Array.from(next));
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ) : googleConnected && calendarLoadError ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{calendarLoadError}</p>
        ) : null}
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
        <div className="space-y-2">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Keyword filters (comma separated)</label>
          <input
            type="text"
            placeholder="project x, client y, out of office"
            value={(device.calendarKeywords ?? []).join(", ")}
            onChange={(e) => setDevice({ ...device, calendarKeywords: e.target.value.split(",").map((s) => s.trim()) })}
            className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-white dark:focus:ring-white/10"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Checked against title and description; add as many keywords as you need.
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Keyword matches map to</label>
          <select
            value={device.calendarKeywordStatusKey ?? ""}
            onChange={(e) => setDevice({ ...device, calendarKeywordStatusKey: e.target.value ? Number(e.target.value) : null })}
            className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="">Do nothing</option>
            {statusOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            When any keyword is found in an event, use this status override.
          </p>
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            <span>Detect video conference links</span>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={device.calendarDetectVideoLinks ?? false}
              onChange={(e) => setDevice({ ...device, calendarDetectVideoLinks: e.target.checked })}
            />
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Looks for Zoom/Teams/Meet/Webex/etc links in event details and applies your video mapping below.
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Video links map to</label>
          <select
            value={device.calendarVideoStatusKey ?? ""}
            onChange={(e) => setDevice({ ...device, calendarVideoStatusKey: e.target.value ? Number(e.target.value) : null })}
            className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            disabled={!device.calendarDetectVideoLinks}
          >
            <option value="">Do nothing</option>
            {statusOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Only used when a video link is detected.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Busy events map to</label>
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
            <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">All day events map to</label>
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
            value={
              device.calendarIdleUsePreferred
                ? "previous"
                : device.calendarIdleStatusKey !== null && device.calendarIdleStatusKey !== undefined
                  ? device.calendarIdleStatusKey
                  : ""
            }
              onChange={(e) => {
                if (e.target.value === "previous") {
                  setDevice({ ...device, calendarIdleUsePreferred: true, calendarIdleStatusKey: null });
                } else {
                  setDevice({
                    ...device,
                    calendarIdleUsePreferred: false,
                    calendarIdleStatusKey: e.target.value ? Number(e.target.value) : null,
                  });
                }
              }}
              className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">Do nothing</option>
              <option value="previous">Previous manual selection</option>
              {statusOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              try {
                await apiFetch("/api/sync-trmnl", { method: "POST" });
                addToast({ message: "ICS sync queued", type: "success" });
              } catch (err) {
                const message = err instanceof Error ? err.message : "Failed to sync ICS calendar";
                addToast({ message, type: "error" });
              }
            }}
            className="rounded-md bg-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            Sync ICS calendar now
          </button>
        </div>
      </div>

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

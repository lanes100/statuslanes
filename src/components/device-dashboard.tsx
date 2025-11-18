"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ToastShelf, useToast } from "@/components/toast";

type Device = {
  deviceId: string;
  deviceName: string;
  statuses: { key: number; label: string; enabled: boolean }[];
  activeStatusKey: number | null;
  activeStatusLabel: string | null;
  updatedAt: number | null;
  showLastUpdated?: boolean;
  showStatusSource?: boolean;
  timezone?: string;
  timeFormat?: string;
  dateFormat?: string;
  calendarIcsUrl?: string | null;
  calendarMeetingStatusKey?: number | null;
  calendarOooStatusKey?: number | null;
  calendarIdleStatusKey?: number | null;
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

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; devices: Device[] };

export default function DeviceDashboard() {
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [pluginId, setPluginId] = useState("");
  const [deviceName, setDeviceName] = useState("My TRMNL");
  const [savingDevice, setSavingDevice] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editableStatuses, setEditableStatuses] = useState<Device["statuses"]>([]);
  const [savingStatuses, setSavingStatuses] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { toasts, addToast, removeToast } = useToast();
  const lastDevicesRef = useRef<Device[] | null>(null);

  const fetchDevices = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) {
        if (lastDevicesRef.current?.length) {
          setRefreshing(true);
        } else {
          setState({ status: "loading" });
        }
      }
      const json = await apiFetch<{ device: Device }>("/api/device");
      lastDevicesRef.current = [json.device];
      setState({ status: "ready", devices: [json.device] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load devices";
      if (!opts?.silent) {
        setState({ status: "error", message });
      }
      if (!/not found/i.test(message)) {
        addToast({ message, type: "error" });
      }
    } finally {
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const device = useMemo(() => {
    if (state.status !== "ready") return null;
    return state.devices[0];
  }, [state]);

  useEffect(() => {
    if (device && editMode) {
      setEditableStatuses(device.statuses);
    }
  }, [device, editMode]);

  const setStatus = async (statusKey: number, statusLabel: string) => {
    if (!device) return;
    setPendingStatus(`${device.deviceId}:${statusKey}`);
    try {
      await apiFetch("/api/set-status", {
        method: "POST",
        body: JSON.stringify({ deviceId: device.deviceId, statusKey, statusLabel, statusSource: "Web App" }),
      });
      addToast({ message: `Status set to ${statusLabel}`, type: "success" });
      await fetchDevices({ silent: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to set status";
      addToast({ message, type: "error" });
    } finally {
      setPendingStatus(null);
    }
  };

  const saveStatuses = async () => {
    if (!device) return;
    setSavingStatuses(true);
    try {
      await apiFetch("/api/device", {
        method: "PATCH",
        body: JSON.stringify({ deviceId: device.deviceId, statuses: editableStatuses }),
      });
      addToast({ message: "Statuses updated", type: "success" });
      setEditMode(false);
      await fetchDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update statuses";
      addToast({ message, type: "error" });
    } finally {
      setSavingStatuses(false);
    }
  };

  if (state.status === "loading" || state.status === "idle") {
    return (
      <>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          Loading your device…
        </div>
        <ToastShelf toasts={toasts} onClose={removeToast} />
      </>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/70 dark:bg-amber-100/10 dark:text-amber-100">
        <div className="font-semibold">Register your TRMNL plugin</div>
        <p className="">
          Paste the TRMNL Plugin UUID from your custom plugin settings.
        </p>
        <form
          className="space-y-3"
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            if (!pluginId.trim()) return;
            setSavingDevice(true);
            try {
              const body = {
                pluginId: pluginId.trim(),
                deviceName: deviceName.trim() || "My TRMNL",
                timezone: getBrowserTimezone(),
                timeFormat: detectDeviceTimeFormat(),
              };
              await apiFetch("/api/register-device", { method: "POST", body: JSON.stringify(body) });
              setPluginId("");
              addToast({ message: "Plugin saved", type: "success" });
              // Full reload so settings and dashboard re-fetch from a clean state after registration
              window.location.reload();
            } catch (err) {
              const message = err instanceof Error ? err.message : "Failed to register device";
              addToast({ message, type: "error" });
            }
            setSavingDevice(false);
          }}
        >
          <div className="space-y-1">
            <label className="text-xs font-semibold text-amber-900">Plugin UUID</label>
            <input
              value={pluginId}
              onChange={(e) => setPluginId(e.target.value)}
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-amber-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 dark:border-amber-400/60 dark:bg-amber-50/10 dark:text-amber-100"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-amber-900">Device name (optional)</label>
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-amber-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 dark:border-amber-400/60 dark:bg-amber-50/10 dark:text-amber-100"
              placeholder="My TRMNL"
            />
          </div>
          <button
            type="submit"
            disabled={savingDevice}
            className="w-full rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-black dark:hover:bg-white/90"
          >
            {savingDevice ? "Saving..." : "Save plugin"}
          </button>
        </form>
        <ToastShelf toasts={toasts} onClose={removeToast} />
      </div>
    );
  }

  if (!device) return null;

  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100">
      {refreshing ? (
        <div className="text-xs text-zinc-500 dark:text-zinc-400">Refreshing…</div>
      ) : null}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{device.deviceName}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            {device.activeStatusLabel ? `I am ${device.activeStatusLabel}` : "No status set yet"}
          </p>
        </div>
        {device.updatedAt ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Updated {new Date(device.updatedAt).toLocaleTimeString()}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            if (editMode) {
              await saveStatuses();
              setEditMode(false);
              if (device) setEditableStatuses(device.statuses);
            } else {
              setEditMode(true);
            }
          }}
          className="rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          {editMode ? "Save and close" : "Edit statuses"}
        </button>
        {editMode && (
          <button
            onClick={() => {
              setEditableStatuses((prev) => {
                if (prev.length >= 12) return prev;
                const nextKey = prev.length + 1;
                return [...prev, { key: nextKey, label: `Status ${nextKey}`, enabled: true }];
              });
            }}
            className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800"
            disabled={editableStatuses.length >= 12}
          >
            + Add status
          </button>
        )}
      </div>

      {editMode ? (
        <div className="space-y-3">
          {editableStatuses.map((status, idx) => (
            <div
              key={`${status.key}-${idx}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <input
                className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-white dark:focus:ring-white/10"
                value={status.label}
                onChange={(e) => {
                  const next = [...editableStatuses];
                  next[idx] = { ...status, label: e.target.value };
                  setEditableStatuses(next);
                }}
              />
              <button
                type="button"
                className="rounded-md bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                onClick={() => {
                  setEditableStatuses((prev) => prev.filter((_, i) => i !== idx));
                }}
              >
                Delete
              </button>
            </div>
          ))}
          {savingStatuses ? <p className="text-xs text-zinc-500">Saving…</p> : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {device.statuses
            .filter((s) => s.enabled && s.label.trim().length > 0)
            .map(({ key, label }) => {
              const isActive = key === device.activeStatusKey;
              const isPending = pendingStatus === `${device.deviceId}:${key}`;
              return (
                <button
                  key={key}
                  onClick={() => setStatus(key, label)}
                  disabled={isPending}
                  className={`rounded-xl px-3 py-3 text-sm font-semibold shadow-sm transition ${
                    isActive
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
                      : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  } ${isPending ? "opacity-70" : ""}`}
                  style={{ minHeight: 56 }}
                >
                  {label}
                </button>
              );
            })}
        </div>
      )}
      <ToastShelf toasts={toasts} onClose={removeToast} />
    </div>
  );
}

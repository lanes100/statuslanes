"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ToastShelf, useToast } from "@/components/toast";

type Device = {
  deviceId: string;
  deviceName: string;
  statuses: { key: number; label: string; enabled: boolean }[];
  activeStatusKey: number | null;
  activeStatusLabel: string | null;
  updatedAt: number | null;
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
  const [syncing, setSyncing] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const fetchDevices = useCallback(async () => {
    try {
      setState({ status: "loading" });
      // For now, assume a single device; if none, API returns 404.
      const json = await apiFetch<{ device: Device }>("/api/device");
      setState({ status: "ready", devices: [json.device] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load devices";
      setState({ status: "error", message });
      addToast({ message, type: "error" });
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
        body: JSON.stringify({ deviceId: device.deviceId, statusKey, statusLabel }),
      });
      addToast({ message: `Status set to ${statusLabel}`, type: "success" });
      await fetchDevices();
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

  const syncFromTrmnl = async () => {
    if (!device) return;
    setSyncing(true);
    try {
      await apiFetch("/api/sync-trmnl", { method: "POST", body: JSON.stringify({ deviceId: device.deviceId }) });
      addToast({ message: "Synced labels from TRMNL", type: "success" });
      await fetchDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to sync from TRMNL";
      addToast({ message, type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  if (state.status === "loading" || state.status === "idle") {
    return (
      <>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          Loading your device…
        </div>
        <ToastShelf toasts={toasts} onClose={removeToast} />
      </>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-semibold text-amber-900">Register your TRMNL plugin</div>
        <p className="text-amber-900">
          Paste the TRMNL Plugin UUID from your custom plugin settings.
        </p>
        <form
          className="space-y-3"
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            if (!pluginId.trim()) return;
            setSavingDevice(true);
            try {
              const body = { pluginId: pluginId.trim(), deviceName: deviceName.trim() || "My TRMNL" };
              await apiFetch("/api/register-device", { method: "POST", body: JSON.stringify(body) });
              setPluginId("");
              addToast({ message: "Plugin saved", type: "success" });
              fetchDevices();
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
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-amber-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-amber-900">Device name (optional)</label>
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-amber-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
              placeholder="My TRMNL"
            />
          </div>
          <button
            type="submit"
            disabled={savingDevice}
            className="w-full rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-70"
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{device.deviceName}</p>
          <p className="text-xs text-zinc-600">
            {device.activeStatusLabel ? `Active: ${device.activeStatusLabel}` : "No status set yet"}
          </p>
        </div>
        {device.updatedAt ? (
          <p className="text-xs text-zinc-500">
            Updated {new Date(device.updatedAt).toLocaleTimeString()}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setEditMode((v) => !v)}
          className="rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-200"
        >
          {editMode ? "Close editor" : "Edit statuses"}
        </button>
        <button
          onClick={syncFromTrmnl}
          disabled={syncing}
          className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {syncing ? "Syncing..." : "Sync from TRMNL"}
        </button>
      </div>

      {editMode ? (
        <div className="space-y-3">
          {editableStatuses.map((status, idx) => (
            <div key={status.key} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3">
              <input
                className="w-16 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-700"
                value={status.key}
                readOnly
              />
              <input
                className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
                value={status.label}
                onChange={(e) => {
                  const next = [...editableStatuses];
                  next[idx] = { ...status, label: e.target.value };
                  setEditableStatuses(next);
                }}
              />
              <label className="flex items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={status.enabled}
                  onChange={(e) => {
                    const next = [...editableStatuses];
                    next[idx] = { ...status, enabled: e.target.checked };
                    setEditableStatuses(next);
                  }}
                />
                Enabled
              </label>
            </div>
          ))}
          <div className="flex gap-2">
            <button
              onClick={saveStatuses}
              disabled={savingStatuses}
              className="flex-1 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {savingStatuses ? "Saving..." : "Save changes"}
            </button>
            <button
              onClick={() => {
                setEditMode(false);
                if (device) setEditableStatuses(device.statuses);
              }}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {device.statuses
            .filter((s) => s.enabled)
            .map(({ key, label }) => {
              const isActive = key === device.activeStatusKey;
              const isPending = pendingStatus === `${device.deviceId}:${key}`;
              return (
                <button
                  key={key}
                  onClick={() => setStatus(key, label)}
                  disabled={isPending}
                  className={`rounded-xl px-3 py-3 text-sm font-semibold shadow-sm transition ${
                    isActive ? "bg-black text-white" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
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

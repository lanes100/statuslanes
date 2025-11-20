import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebaseAdmin";
import { applyCachedEvents, type DeviceRecord } from "@/lib/calendarSync";

const DEFAULT_SOURCE = "Calendar";

function resolveSource(device: DeviceRecord): string | null {
  if ((device.calendarIds ?? []).length > 0) return "Google Calendar";
  if ((device.outlookCalendarIds ?? []).length > 0) return "Outlook Calendar";
  if (device.calendarIcsUrl) return DEFAULT_SOURCE;
  return device.activeStatusSource ?? DEFAULT_SOURCE;
}

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const header = request.headers.get("x-sync-secret");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    let deviceId: string | undefined;
    try {
      const payload = await request.json();
      if (payload && typeof payload.deviceId === "string") {
        deviceId = payload.deviceId;
      }
    } catch {
      // ignore body parse errors (likely empty body)
    }

    let docs: FirebaseFirestore.DocumentSnapshot[];
    if (deviceId) {
      const single = await adminDb.collection("devices").doc(deviceId).get();
      docs = single.exists ? [single] : [];
    } else {
      const snapshot = await adminDb.collection("devices").get();
      docs = snapshot.docs;
    }

    const now = Date.now();
    let processed = 0;
    let changed = 0;

    for (const doc of docs) {
      const device = doc.data() as DeviceRecord;
      const hasCache = Array.isArray(device.calendarCachedEvents) && device.calendarCachedEvents.length > 0;
      const ended =
        typeof device.activeEventEndsAt === "number" && Number.isFinite(device.activeEventEndsAt) && device.activeEventEndsAt <= now;

      if (!hasCache && !ended) {
        continue;
      }

      const source = resolveSource(device);
      if (!source) continue;

      processed += 1;
      const advanced = await applyCachedEvents(device, doc.ref, now, source);
      if (advanced) {
        changed += 1;
      }
    }

    return NextResponse.json({ processed, changed }, { status: 200 });
  } catch (error) {
    console.error("calendar-cache/apply error", error);
    return NextResponse.json({ error: "Failed to advance calendar cache" }, { status: 500 });
  }
}

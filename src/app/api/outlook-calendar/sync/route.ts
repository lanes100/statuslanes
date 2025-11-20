import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { ensureOutlookAccessToken } from "@/lib/outlookTokens";
import { graphRequest } from "@/lib/outlook";
import {
  applyCachedEvents,
  buildSameDayCache,
  mapEventsForCache,
  pushStatusToTrmnl,
  type CachedEvent,
  type DeviceRecord,
  type NormalizedCalendarEvent,
} from "@/lib/calendarSync";

const SESSION_COOKIE_NAME = "statuslanes_session";

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid };
}

export async function POST() {
  try {
    const user = await requireUser();
    const { token } = await ensureOutlookAccessToken(user.uid);

    const deviceSnap = await adminDb.collection("devices").where("userId", "==", user.uid).limit(1).get();
    if (deviceSnap.empty) {
      return NextResponse.json({ error: "No device" }, { status: 404 });
    }
    const deviceDoc = deviceSnap.docs[0];
    const device = deviceDoc.data() as DeviceRecord;
    const calendarIds = (device.outlookCalendarIds ?? []).filter((id) => typeof id === "string" && id.length > 0);

    if (device.calendarProvider && device.calendarProvider !== "outlook") {
      return NextResponse.json({ error: "Outlook provider not selected" }, { status: 400 });
    }

    if (calendarIds.length === 0) {
      return NextResponse.json({ error: "No Outlook calendars selected" }, { status: 400 });
    }

    const result = await runOutlookSyncForUser(device, deviceDoc.ref, token);
    await adminDb.collection("outlook_tokens").doc(user.uid).set({ lastSyncedAt: Date.now() }, { merge: true });
    return NextResponse.json({ synced: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "OUTLOOK_NOT_CONNECTED") {
      return NextResponse.json({ error: "Outlook not connected" }, { status: 400 });
    }
    console.error("outlook-calendar/sync error", error);
    return NextResponse.json({ error: "Failed to sync Outlook" }, { status: 500 });
  }
}

type OutlookEvent = {
  subject?: string | null;
  bodyPreview?: string | null;
  start?: { dateTime?: string | null; date?: string | null };
  end?: { dateTime?: string | null; date?: string | null };
  isAllDay?: boolean;
  location?: { displayName?: string | null };
  onlineMeetingUrl?: string | null;
  onlineMeeting?: { joinUrl?: string | null };
};

async function runOutlookSyncForUser(
  device: DeviceRecord,
  deviceRef: FirebaseFirestore.DocumentReference,
  accessToken: string,
) {
  const calendarIds = (device.outlookCalendarIds ?? []).filter((id) => typeof id === "string" && id.length > 0);
  if (calendarIds.length === 0) {
    return { changed: false, reason: "no_calendars" };
  }
  if (device.calendarProvider && device.calendarProvider !== "outlook") {
    return { changed: false, reason: "provider_disabled" };
  }

  const now = Date.now();
  let changed = false;

  await applyCachedEvents(device, deviceRef, now, "Outlook Calendar");

  const cacheableEvents: CachedEvent[] = [];

  const startWindow = new Date(now - 1000 * 60 * 60 * 24).toISOString();
  const endWindow = new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString();

  for (const calId of calendarIds) {
    try {
      const filter = encodeURIComponent(`start/dateTime ge '${startWindow}' and start/dateTime le '${endWindow}'`);
      const select =
        "$select=subject,bodyPreview,start,end,isAllDay,location,onlineMeetingUrl,onlineMeeting&$orderby=start/dateTime&$top=50";
      const eventsRes = await graphRequest<{ value: OutlookEvent[] }>(
        accessToken,
        `/me/calendars/${encodeURIComponent(calId)}/events?${select}&$filter=${filter}`,
      );
      const normalized = normalizeOutlookEvents(eventsRes.value ?? []);
      const mapped = mapEventsForCache(normalized, device);
      cacheableEvents.push(...mapped);
    } catch (err) {
      console.error("Failed to fetch Outlook calendar events", err);
    }
  }

  const current = cacheableEvents.find((ev) => now >= ev.start && now <= ev.end);
  let chosenKey = current?.statusKey ?? null;
  let chosenEndsAt = current?.end ?? null;

  if (!chosenKey) {
    if (device.calendarIdleUsePreferred && device.preferredStatusKey) {
      chosenKey = device.preferredStatusKey;
    } else if (device.calendarIdleStatusKey) {
      chosenKey = device.calendarIdleStatusKey;
    } else if (device.preferredStatusKey) {
      chosenKey = device.preferredStatusKey;
    }
  }

  if (chosenKey) {
    const chosenLabel =
      device.statuses?.find((s) => s.key === chosenKey)?.label ??
      (chosenKey === device.preferredStatusKey ? device.preferredStatusLabel ?? null : null);
    if (
      device.activeStatusKey !== chosenKey ||
      device.activeStatusLabel !== chosenLabel ||
      device.activeEventEndsAt !== chosenEndsAt
    ) {
      changed = true;
      await deviceRef.update({
        activeStatusKey: chosenKey,
        activeStatusLabel: chosenLabel ?? null,
        activeStatusSource: "Outlook Calendar",
        activeEventEndsAt: chosenEndsAt ?? null,
        updatedAt: now,
      });
      await pushStatusToTrmnl(device, chosenKey, chosenLabel ?? "");
    }
  }

  await deviceRef.update({ calendarCachedEvents: buildSameDayCache(cacheableEvents, now) });

  return { changed };
}

function normalizeOutlookEvents(events: OutlookEvent[]): NormalizedCalendarEvent[] {
  return events
    .map((ev) => {
      const startRaw = ev.start?.dateTime ?? ev.start?.date ?? null;
      const endRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
      if (!startRaw || !endRaw) return null;
      const start = new Date(startRaw).getTime();
      const end = new Date(endRaw).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return null;
      return {
        start,
        end,
        title: ev.subject ?? "",
        description: ev.bodyPreview ?? "",
        location: ev.location?.displayName ?? "",
        isAllDay: Boolean(ev.isAllDay),
        hasVideoLink: Boolean(ev.onlineMeetingUrl ?? ev.onlineMeeting?.joinUrl ?? ""),
      } as NormalizedCalendarEvent;
    })
    .filter((ev): ev is NormalizedCalendarEvent => Boolean(ev));
}

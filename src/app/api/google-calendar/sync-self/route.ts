import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getOAuthClient, getCalendarClient } from "@/lib/google";
import { decrypt } from "@/lib/crypto";

const SESSION_COOKIE_NAME = "statuslanes_session";

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid, email: decoded.email ?? null };
}

type DeviceRecord = {
  deviceId: string;
  userId: string;
  calendarIds?: string[];
  outlookCalendarIds?: string[];
  calendarProvider?: string | null;
  calendarKeywords?: string[];
  calendarKeywordStatusKey?: number | null;
  calendarMeetingStatusKey?: number | null;
  calendarOooStatusKey?: number | null;
  calendarIdleStatusKey?: number | null;
  statuses?: { key: number; label: string; enabled: boolean }[];
  activeStatusKey?: number | null;
  activeStatusLabel?: string | null;
  calendarDetectVideoLinks?: boolean;
  calendarVideoStatusKey?: number | null;
  preferredStatusKey?: number | null;
  preferredStatusLabel?: string | null;
  calendarIdleUsePreferred?: boolean;
  calendarCachedEvents?: CachedEvent[];
  activeEventEndsAt?: number | null;
  activeStatusSource?: string | null;
};

type CachedEvent = { start: number; end: number; statusKey: number | null };

export async function POST() {
  try {
    const user = await requireUser();
    const tokenSnap = await adminDb.collection("google_tokens").doc(user.uid).get();
    const tokenData = tokenSnap.data();
    if (!tokenData || (!tokenData.accessToken && !tokenData.refreshToken)) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }

    const deviceSnap = await adminDb.collection("devices").where("userId", "==", user.uid).limit(1).get();
    if (deviceSnap.empty) {
      return NextResponse.json({ error: "No device" }, { status: 404 });
    }
    const device = deviceSnap.docs[0].data() as DeviceRecord;
    const deviceRef = deviceSnap.docs[0].ref;

    const calendarIds = device.calendarIds ?? [];
    if (calendarIds.length === 0) {
      return NextResponse.json({ error: "No calendars selected" }, { status: 400 });
    }

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token: tokenData.accessToken ?? undefined,
      refresh_token: tokenData.refreshToken ?? undefined,
      expiry_date: tokenData.expiryDate ?? undefined,
      token_type: tokenData.tokenType ?? undefined,
      scope: tokenData.scope ?? undefined,
    });
    const calendar = getCalendarClient(oauth2Client);

    const now = Date.now();
    await applyCachedEvents(device, deviceRef, now);
    if (device.calendarCachedEvents && device.calendarCachedEvents.length > 0) {
      await deviceRef.update({ calendarCachedEvents: [] });
    }
    if (device.activeEventEndsAt && now >= device.activeEventEndsAt) {
      const fallbackKey =
        (device.calendarIdleUsePreferred && device.preferredStatusKey) ||
        (!device.calendarIdleUsePreferred && device.calendarIdleStatusKey)
          ? device.calendarIdleUsePreferred
            ? device.preferredStatusKey
            : device.calendarIdleStatusKey
          : device.preferredStatusKey || device.calendarIdleStatusKey || null;
      if (fallbackKey) {
        const fallbackLabel =
          device.statuses?.find((s) => s.key === fallbackKey)?.label ??
          (fallbackKey === device.preferredStatusKey ? device.preferredStatusLabel ?? null : null);
        if (device.activeStatusKey !== fallbackKey || device.activeStatusLabel !== fallbackLabel) {
          await deviceRef.update({
            activeStatusKey: fallbackKey,
            activeStatusLabel: fallbackLabel ?? null,
            activeEventEndsAt: null,
            updatedAt: now,
          });
          await pushStatusToTrmnl(device, fallbackKey, fallbackLabel ?? "");
        } else {
          await deviceRef.update({ activeEventEndsAt: null });
        }
      } else {
        await deviceRef.update({ activeEventEndsAt: null });
      }
    }

    const cacheableEvents: CachedEvent[] = [];

    for (const calId of calendarIds) {
      const listRes = await calendar.events.list({
        calendarId: calId,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
        timeMin: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
        timeMax: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
      });

      const events = listRes.data.items ?? [];
      cacheableEvents.push(...mapEventsForCache(events, device));
    const upcoming = events.filter((ev) => {
      const start = ev.start?.dateTime ?? ev.start?.date;
      const end = ev.end?.dateTime ?? ev.end?.date;
      if (!start || !end) return false;
      const startTs = new Date(start).getTime();
      const endTs = new Date(end).getTime();
      return endTs > now - 5 * 60 * 1000 && startTs < now + 5 * 60 * 1000;
    });

    const keywordList = (device.calendarKeywords ?? []).map((s) => s.toLowerCase());
    const matchKeyword = device.calendarKeywordStatusKey
      ? (title: string, desc: string) => {
          const hay = `${title} ${desc}`.toLowerCase();
          return keywordList.some((k) => hay.includes(k));
        }
      : () => false;
    let chosenKey: number | null = null;
    let chosenLabel: string | null = null;
    let chosenEndsAt: number | null = null;

    const eventsWithTimes = upcoming
      .map((ev) => {
        const startRaw = ev.start?.dateTime ?? ev.start?.date ?? null;
        const endRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
        const startTs = startRaw ? new Date(startRaw).getTime() : null;
        const endTs = endRaw ? new Date(endRaw).getTime() : null;
        return { ev, startTs, endTs };
      })
      .filter((e) => e.startTs !== null && e.endTs !== null);

    for (const { ev, endTs } of eventsWithTimes) {
      const title = ev.summary ?? "";
      const desc = ev.description ?? "";
      const isAllDay = Boolean(ev.start?.date);
      const videoMatch =
        device.calendarDetectVideoLinks &&
        ((ev.location ?? "").match(VIDEO_LINK_RE) || (ev.description ?? "").match(VIDEO_LINK_RE));
      if (matchKeyword(title, desc)) {
        chosenKey = device.calendarKeywordStatusKey ?? null;
        chosenEndsAt = endTs;
        break;
      }
      if (videoMatch && device.calendarVideoStatusKey) {
        chosenKey = device.calendarVideoStatusKey;
        chosenEndsAt = endTs;
        break;
      }
      if (isAllDay && device.calendarOooStatusKey) {
        chosenKey = device.calendarOooStatusKey;
        chosenEndsAt = endTs;
        break;
      }
      if (!isAllDay && device.calendarMeetingStatusKey) {
        chosenKey = device.calendarMeetingStatusKey;
        chosenEndsAt = endTs;
        break;
      }
    }

    if (chosenKey && chosenEndsAt) {
      let extendedEnd = chosenEndsAt;
      const grace = 5 * 60 * 1000;
      for (const { ev, startTs, endTs } of eventsWithTimes) {
        if (startTs === null || endTs === null) continue;
        if (startTs > extendedEnd + grace) continue;
        const title = ev.summary ?? "";
        const desc = ev.description ?? "";
        const isAllDay = Boolean(ev.start?.date);
        const videoMatch =
          device.calendarDetectVideoLinks &&
          ((ev.location ?? "").match(VIDEO_LINK_RE) || (ev.description ?? "").match(VIDEO_LINK_RE));
        let keyForEvent: number | null = null;
        if (matchKeyword(title, desc)) keyForEvent = device.calendarKeywordStatusKey ?? null;
        else if (videoMatch && device.calendarVideoStatusKey) keyForEvent = device.calendarVideoStatusKey;
        else if (isAllDay && device.calendarOooStatusKey) keyForEvent = device.calendarOooStatusKey;
        else if (!isAllDay && device.calendarMeetingStatusKey) keyForEvent = device.calendarMeetingStatusKey;
        if (keyForEvent === chosenKey && endTs > extendedEnd) {
          extendedEnd = endTs;
        }
      }
      chosenEndsAt = extendedEnd;
    }

    if (!chosenKey) {
      if (device.calendarIdleUsePreferred && device.preferredStatusKey) {
        chosenKey = device.preferredStatusKey;
      } else if (device.calendarIdleStatusKey) {
        chosenKey = device.calendarIdleStatusKey;
      } else if (device.preferredStatusKey) {
        chosenKey = device.preferredStatusKey;
      }
      chosenEndsAt = null;
    }

    if (chosenKey) {
      const label =
        device.statuses?.find((s) => s.key === chosenKey)?.label ??
        (chosenKey === device.preferredStatusKey ? device.preferredStatusLabel ?? null : null);
      chosenLabel = label;
      if (device.activeStatusKey !== chosenKey || device.activeStatusLabel !== chosenLabel) {
        const updatePayload: Record<string, unknown> = {
          activeStatusKey: chosenKey,
          activeStatusLabel: chosenLabel,
          activeStatusSource: "Google Calendar",
          activeEventEndsAt: chosenEndsAt ?? null,
          updatedAt: Date.now(),
        };
        if (!device.preferredStatusKey && device.activeStatusKey) {
          updatePayload.preferredStatusKey = device.activeStatusKey;
          updatePayload.preferredStatusLabel = device.activeStatusLabel ?? null;
          }
          await deviceRef.update(updatePayload);
          await pushStatusToTrmnl(device, chosenKey, chosenLabel ?? "");
        }
      }
    }

    await deviceRef.update({ calendarCachedEvents: buildSameDayCache(cacheableEvents, now) });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("google-calendar/sync-self error", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}

async function pushStatusToTrmnl(device: DeviceRecord, statusKey: number | null, statusLabel: string) {
  const webhookUrlEncrypted = (device as any).webhookUrlEncrypted as string | undefined;
  if (!webhookUrlEncrypted) return;
  const webhookUrl = decrypt(webhookUrlEncrypted);
  const timestamp = formatTimestamp(
    Date.now(),
    (device as any).timezone || "UTC",
    (device as any).dateFormat || "MDY",
    (device as any).timeFormat || "24h",
  );
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merge_variables: {
          status_text: statusLabel,
          status_source: "Google Calendar",
          show_last_updated: (device as any).showLastUpdated ?? true,
          show_status_source: (device as any).showStatusSource ?? false,
          updated_at: timestamp,
        },
        merge_strategy: "replace",
      }),
    });
  } catch (err) {
    console.error("pushStatusToTrmnl failed", err);
  }
}

function formatTimestamp(timestamp: number, timezone: string, dateFormat: string, timeFormat: string): string {
  const date = new Date(timestamp);
  const hour12 = timeFormat !== "24h";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") lookup[p.type] = p.value;
  }

  const yyyy = lookup.year;
  const mm = lookup.month;
  const dd = lookup.day;

  const dateStr =
    dateFormat === "DMY" ? `${dd}/${mm}/${yyyy}` : dateFormat === "YMD" ? `${yyyy}-${mm}-${dd}` : `${mm}/${dd}/${yyyy}`;

  const timeStr = `${lookup.hour ?? ""}:${lookup.minute ?? ""}${hour12 && lookup.dayPeriod ? " " + lookup.dayPeriod : ""}`;

  return `${dateStr} ${timeStr}`.trim();
}

const VIDEO_LINK_RE =
  /(zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com|gotomeeting\.com|bluejeans\.com|ringcentral\.com|whereby\.com|join\.skype\.com|chime\.aws|hopin\.com|join\.me)/i;

function buildSameDayCache(events: { start: number; end: number; statusKey: number | null }[], now: number): CachedEvent[] {
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  return events
    .filter((e) => e.start >= startOfDay && e.end >= now)
    .sort((a, b) => a.start - b.start)
    .slice(0, 10);
}

async function applyCachedEvents(device: DeviceRecord, deviceRef: FirebaseFirestore.DocumentReference, now: number) {
  const cached = (device.calendarCachedEvents ?? []).filter((e) => e.end > now);
  if (cached.length === 0) {
    if ((device.calendarCachedEvents?.length ?? 0) > 0) await deviceRef.update({ calendarCachedEvents: [] });
    return;
  }
  cached.sort((a, b) => a.start - b.start);
  for (const ev of cached) {
    if (now >= ev.start && now <= ev.end) {
      const label =
        device.statuses?.find((s) => s.key === ev.statusKey)?.label ??
        (ev.statusKey === device.preferredStatusKey ? device.preferredStatusLabel ?? null : null);
      if (device.activeStatusKey !== ev.statusKey || device.activeStatusLabel !== label) {
        await deviceRef.update({
          activeStatusKey: ev.statusKey,
          activeStatusLabel: label ?? null,
          activeStatusSource: "Google Calendar",
          activeEventEndsAt: ev.end,
          calendarCachedEvents: cached,
          updatedAt: now,
        });
        await pushStatusToTrmnl(device, ev.statusKey, label ?? "");
      } else {
        await deviceRef.update({ calendarCachedEvents: cached });
      }
      return;
    }
  }
  await deviceRef.update({ calendarCachedEvents: cached });
}

function mapEventsForCache(events: any[], device: DeviceRecord): CachedEvent[] {
  const keywordList = (device.calendarKeywords ?? []).map((s) => s.toLowerCase());
  const matchKeyword = device.calendarKeywordStatusKey
    ? (title: string, desc: string) => {
        const hay = `${title} ${desc}`.toLowerCase();
        return keywordList.some((k) => hay.includes(k));
      }
    : () => false;

  const mapped: CachedEvent[] = [];
  for (const ev of events) {
    const startRaw = ev.start?.dateTime ?? ev.start?.date;
    const endRaw = ev.end?.dateTime ?? ev.end?.date;
    if (!startRaw || !endRaw) continue;
    const startTs = new Date(startRaw).getTime();
    const endTs = new Date(endRaw).getTime();
    const title = ev.summary ?? "";
    const desc = ev.description ?? "";
    const isAllDay = Boolean(ev.start?.date);
    const videoMatch =
      device.calendarDetectVideoLinks &&
      ((ev.location ?? "").match(VIDEO_LINK_RE) || (ev.description ?? "").match(VIDEO_LINK_RE));
    let key: number | null = null;
    if (matchKeyword(title, desc)) key = device.calendarKeywordStatusKey ?? null;
    else if (videoMatch && device.calendarVideoStatusKey) key = device.calendarVideoStatusKey;
    else if (isAllDay && device.calendarOooStatusKey) key = device.calendarOooStatusKey;
    else if (!isAllDay && device.calendarMeetingStatusKey) key = device.calendarMeetingStatusKey;
    else if (device.calendarIdleUsePreferred && device.preferredStatusKey) key = device.preferredStatusKey;
    else if (device.calendarIdleStatusKey) key = device.calendarIdleStatusKey;
    mapped.push({ start: startTs, end: endTs, statusKey: key });
  }
  return mapped;
}

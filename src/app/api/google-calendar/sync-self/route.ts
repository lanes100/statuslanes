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
  calendarKeywords?: string[];
  calendarKeywordStatusKey?: number | null;
  calendarMeetingStatusKey?: number | null;
  calendarOooStatusKey?: number | null;
  calendarIdleStatusKey?: number | null;
  statuses?: { key: number; label: string; enabled: boolean }[];
  activeStatusKey?: number | null;
  activeStatusLabel?: string | null;
  calendarDetectVideoLinks?: boolean;
};

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
      const upcoming = events.filter((ev) => {
        const start = ev.start?.dateTime ?? ev.start?.date;
        const end = ev.end?.dateTime ?? ev.end?.date;
        if (!start || !end) return false;
        const startTs = new Date(start).getTime();
        const endTs = new Date(end).getTime();
        return endTs > now - 5 * 60 * 1000 && startTs < now + 60 * 60 * 1000;
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

    for (const ev of upcoming) {
      const title = ev.summary ?? "";
      const desc = ev.description ?? "";
      const isAllDay = Boolean(ev.start?.date);
      const videoMatch =
        device.calendarDetectVideoLinks &&
        ((ev.location ?? "").match(VIDEO_LINK_RE) || (ev.description ?? "").match(VIDEO_LINK_RE));
      if (matchKeyword(title, desc)) {
        chosenKey = device.calendarKeywordStatusKey ?? null;
        break;
      }
      if (videoMatch && device.calendarMeetingStatusKey) {
        chosenKey = device.calendarMeetingStatusKey;
        break;
      }
      if (isAllDay && device.calendarOooStatusKey) {
        chosenKey = device.calendarOooStatusKey;
        break;
      }
      if (!isAllDay && device.calendarMeetingStatusKey) {
          chosenKey = device.calendarMeetingStatusKey;
          break;
        }
      }

      if (!chosenKey && device.calendarIdleStatusKey) {
        chosenKey = device.calendarIdleStatusKey;
      }

      if (chosenKey) {
        const label = device.statuses?.find((s) => s.key === chosenKey)?.label ?? null;
        chosenLabel = label;
        if (device.activeStatusKey !== chosenKey || device.activeStatusLabel !== chosenLabel) {
          await deviceRef.update({
            activeStatusKey: chosenKey,
            activeStatusLabel: chosenLabel,
            updatedAt: Date.now(),
          });
          await pushStatusToTrmnl(device, chosenKey, chosenLabel ?? "");
        }
      }
    }

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
          timezone: (device as any).timezone,
          time_format: (device as any).timeFormat,
          date_format: (device as any).dateFormat,
          updated_at: timestamp,
        },
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

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getOAuthClient, getCalendarClient } from "@/lib/google";

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
        if (matchKeyword(title, desc)) {
          chosenKey = device.calendarKeywordStatusKey ?? null;
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

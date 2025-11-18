import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import ICAL from "ical.js";

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

type DeviceRecord = {
  deviceId: string;
  userId: string;
  calendarIcsUrl?: string | null;
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
    const deviceSnap = await adminDb.collection("devices").where("userId", "==", user.uid).limit(1).get();
    if (deviceSnap.empty) {
      return NextResponse.json({ error: "No device" }, { status: 404 });
    }
    const device = deviceSnap.docs[0].data() as DeviceRecord;
    const deviceRef = deviceSnap.docs[0].ref;

    // Skip if Google is connected (prefer Google)
    const tokenSnap = await adminDb.collection("google_tokens").doc(user.uid).get();
    if (tokenSnap.exists) {
      const tData = tokenSnap.data();
      if (tData?.refreshToken || tData?.accessToken) {
        return NextResponse.json({ skipped: true }, { status: 200 });
      }
    }

    if (!device.calendarIcsUrl) {
      return NextResponse.json({ error: "No ICS configured" }, { status: 400 });
    }

    const now = Date.now();
    let vevents: any[] = [];
    try {
      const icsRes = await fetch(device.calendarIcsUrl);
      if (!icsRes.ok) throw new Error(`HTTP ${icsRes.status}`);
      const icsText = await icsRes.text();
      const jcal = ICAL.parse(icsText);
      const comp = new ICAL.Component(jcal);
      vevents = comp.getAllSubcomponents("vevent").map((v: any) => new ICAL.Event(v));
    } catch (err) {
      console.error("ICS fetch/parse failed", device.deviceId, err);
      return NextResponse.json({ error: "Failed to fetch ICS" }, { status: 500 });
    }

    const upcoming = vevents.filter((ev) => {
      const start = ev.startDate.toJSDate().getTime();
      const end = ev.endDate.toJSDate().getTime();
      return end > now - 5 * 60 * 1000 && start < now + 60 * 60 * 1000;
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
      const isAllDay = ev.startDate.isDate;
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

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("ics-sync-self error", error);
    return NextResponse.json({ error: "Failed to sync ICS" }, { status: 500 });
  }
}

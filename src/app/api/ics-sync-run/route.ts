import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import ical from "node-ical";

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
  lastIcsSyncedAt?: number | null;
};

const BATCH_DEVICES = 5;

export async function POST() {
  try {
    const snap = await adminDb
      .collection("devices")
      .where("calendarIcsUrl", "!=", null)
      .limit(BATCH_DEVICES)
      .get();

    const now = Date.now();

    for (const doc of snap.docs) {
      const device = doc.data() as DeviceRecord;
      if (!device.calendarIcsUrl) continue;

      // If Google is connected on this user and we have calendarIds, prefer Google and skip ICS
      const tokenSnap = await adminDb.collection("google_tokens").doc(device.userId).get();
      if (tokenSnap.exists) {
        const tData = tokenSnap.data();
        if (tData?.refreshToken || tData?.accessToken) {
          continue;
        }
      }

      let events = [];
      try {
        const data = (await ical.async.fromURL(device.calendarIcsUrl)) as Record<string, ical.VEvent>;
        events = Object.values(data).filter((e) => e.type === "VEVENT");
      } catch (err) {
        console.error("ICS fetch/parse failed", device.deviceId, err);
        continue;
      }

      const upcoming = events.filter((ev: any) => {
        const start = ev.start ? new Date(ev.start).getTime() : null;
        const end = ev.end ? new Date(ev.end).getTime() : null;
        if (!start || !end) return false;
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
        const isAllDay = ev.datetype === "date" || (!ev.start?.getHours && !ev.end?.getHours);
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
          await doc.ref.update({
            activeStatusKey: chosenKey,
            activeStatusLabel: chosenLabel,
            updatedAt: Date.now(),
            lastIcsSyncedAt: Date.now(),
          });
        } else {
          await doc.ref.update({ lastIcsSyncedAt: Date.now() });
        }
      } else {
        await doc.ref.update({ lastIcsSyncedAt: Date.now() });
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("ics sync-run error", err);
    return NextResponse.json({ error: "Failed to sync ICS" }, { status: 500 });
  }
}

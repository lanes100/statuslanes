import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import ICAL from "ical.js";
import { decrypt } from "@/lib/crypto";

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
  activeStatusSource?: string | null;
  lastIcsSyncedAt?: number | null;
  calendarDetectVideoLinks?: boolean;
  calendarVideoStatusKey?: number | null;
  preferredStatusKey?: number | null;
  preferredStatusLabel?: string | null;
  calendarIdleUsePreferred?: boolean;
  calendarCachedEvents?: { start: number; end: number; statusKey: number | null }[];
  activeEventEndsAt?: number | null;
};

const BATCH_DEVICES = 5;
const VIDEO_LINK_RE =
  /(zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com|gotomeeting\.com|bluejeans\.com|ringcentral\.com|whereby\.com|join\.skype\.com|chime\.aws|hopin\.com|join\.me)/i;

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const header = request.headers.get("x-sync-secret");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
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

      // clear stale cache before rebuilding
      if (device.calendarCachedEvents && device.calendarCachedEvents.length > 0) {
        await doc.ref.update({ calendarCachedEvents: [] });
      }

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
        continue;
      }

      const upcoming = vevents.filter((ev) => {
        const start = ev.startDate.toJSDate().getTime();
        const end = ev.endDate.toJSDate().getTime();
        return end > now - 5 * 60 * 1000 && start < now + 60 * 60 * 1000;
      });
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
            await doc.ref.update({
              activeStatusKey: fallbackKey,
              activeStatusLabel: fallbackLabel ?? null,
              activeEventEndsAt: null,
              updatedAt: now,
              lastIcsSyncedAt: now,
            });
            await pushStatusToTrmnl(device, fallbackKey, fallbackLabel ?? "");
          } else {
            await doc.ref.update({ activeEventEndsAt: null, lastIcsSyncedAt: now });
          }
        } else {
          await doc.ref.update({ activeEventEndsAt: null, lastIcsSyncedAt: now });
        }
      }

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

      for (const ev of upcoming) {
        const title = ev.summary ?? "";
        const desc = ev.description ?? "";
        const isAllDay = ev.startDate.isDate;
        const endTs = ev.endDate.toJSDate().getTime();
        if (matchKeyword(title, desc)) {
          chosenKey = device.calendarKeywordStatusKey ?? null;
          chosenEndsAt = endTs;
          break;
        }
        const videoMatch =
          device.calendarDetectVideoLinks &&
          ((ev.location ?? "").match(VIDEO_LINK_RE) || (ev.description ?? "").match(VIDEO_LINK_RE));
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
        for (const ev of upcoming) {
          const startTs = ev.startDate.toJSDate().getTime();
          const endTs = ev.endDate.toJSDate().getTime();
          if (startTs > extendedEnd + grace) continue;
          const title = ev.summary ?? "";
          const desc = ev.description ?? "";
          const isAllDay = ev.startDate.isDate;
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
            updatedAt: Date.now(),
            lastIcsSyncedAt: Date.now(),
            activeStatusSource: "ICS",
            activeEventEndsAt: chosenEndsAt ?? null,
          };
          if (!device.preferredStatusKey && device.activeStatusKey) {
            updatePayload.preferredStatusKey = device.activeStatusKey;
            updatePayload.preferredStatusLabel = device.activeStatusLabel ?? null;
          }
          await doc.ref.update(updatePayload);
          await pushStatusToTrmnl(device, chosenKey, chosenLabel ?? "");
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
          status_source: "ICS",
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

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { decrypt } from "@/lib/crypto";
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
  calendarDetectVideoLinks?: boolean;
  calendarVideoStatusKey?: number | null;
  preferredStatusKey?: number | null;
  preferredStatusLabel?: string | null;
  calendarIdleUsePreferred?: boolean;
  activeEventEndsAt?: number | null;
};

const VIDEO_LINK_RE =
  /(zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com|gotomeeting\.com|bluejeans\.com|ringcentral\.com|whereby\.com|join\.skype\.com|chime\.aws|hopin\.com|join\.me)/i;

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
    // expire any tracked event end before processing current list
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
    let chosenEndsAt: number | null = null;

    for (const ev of upcoming) {
      const title = ev.summary ?? "";
      const desc = ev.description ?? "";
      const isAllDay = ev.startDate.isDate;
      const endTs = ev.endDate.toJSDate().getTime();
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
      if (
        device.activeStatusKey !== chosenKey ||
        device.activeStatusLabel !== chosenLabel ||
        device.activeEventEndsAt !== chosenEndsAt
      ) {
        const updatePayload: Record<string, unknown> = {
          activeStatusKey: chosenKey,
          activeStatusLabel: chosenLabel,
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

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("ics-sync-self error", error);
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

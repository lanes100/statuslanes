import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { decrypt } from "@/lib/crypto";
import { cookies } from "next/headers";
import { ensureCalendarWatchesForDevice } from "@/lib/googleCalendarWatch";
import { ensureOutlookSubscriptionsForDevice } from "@/lib/outlookCalendarWatch";

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

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("id");

    if (deviceId) {
      const snapshot = await adminDb.collection("devices").doc(deviceId).get();
      if (!snapshot.exists) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const data = snapshot.data();
      if (!data || data.userId !== user.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const enriched = await ensureAutomationKeys(data, snapshot.ref);
      return NextResponse.json({ device: enriched }, { status: 200 });
    }

    const querySnap = await adminDb
      .collection("devices")
      .where("userId", "==", user.uid)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const doc = querySnap.docs[0];
    const enriched = await ensureAutomationKeys(doc.data(), doc.ref);
    return NextResponse.json({ device: enriched }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("device get error", error);
    return NextResponse.json({ error: "Failed to fetch device" }, { status: 500 });
  }
}

async function ensureAutomationKeys(
  data: FirebaseFirestore.DocumentData | undefined,
  ref: FirebaseFirestore.DocumentReference,
) {
  if (!data) return data;
  let mutated = false;
  if (!data.automationId) {
    const { generateAutomationId } = await import("@/lib/automation");
    data.automationId = data.iftttId ?? generateAutomationId();
    mutated = true;
  }
  if (!data.automationSecret) {
    const { generateAutomationSecret } = await import("@/lib/automation");
    data.automationSecret = data.iftttSecret ?? generateAutomationSecret();
    mutated = true;
  }
  if (mutated) {
    await ref.update({ automationId: data.automationId, automationSecret: data.automationSecret });
  }
  return data;
}

type StatusInput = { key: number; label: string; enabled: boolean };

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const deviceId = (body?.deviceId as string | undefined) ?? "default";
    const statuses = body?.statuses as StatusInput[] | undefined;
    const showLastUpdated = body?.showLastUpdated as boolean | undefined;
    const showStatusSource = body?.showStatusSource as boolean | undefined;

    const ref = adminDb.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snap.data();
    if (!data || data.userId !== user.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sanitized =
      statuses && Array.isArray(statuses)
        ? statuses
            .map((s) => ({
              key: Number(s.key),
              label: typeof s.label === "string" ? s.label.slice(0, 60) : "",
              enabled: Boolean(s.enabled),
            }))
            .filter((s) => Number.isInteger(s.key) && s.key >= 1 && s.key <= 12 && s.label.trim().length > 0)
        : (data.statuses as StatusInput[] | undefined) ?? [];

    const update: Record<string, unknown> = { updatedAt: Date.now() };
    if (sanitized.length > 0) {
      update.statuses = sanitized;
    }
    if (typeof showLastUpdated === "boolean") {
      update.showLastUpdated = showLastUpdated;
    }
    if (typeof showStatusSource === "boolean") {
      update.showStatusSource = showStatusSource;
    }
    const timezone = body?.timezone as string | undefined;
    const timeFormat = body?.timeFormat as string | undefined;
    const dateFormat = body?.dateFormat as string | undefined;
    const calendarIcsUrlRaw = body?.calendarIcsUrl as string | undefined;
    const calendarMeetingStatusKeyRaw = body?.calendarMeetingStatusKey;
    const calendarOooStatusKeyRaw = body?.calendarOooStatusKey;
    const calendarIdleStatusKeyRaw = body?.calendarIdleStatusKey;
    const calendarKeywordStatusKeyRaw = body?.calendarKeywordStatusKey;
    const calendarVideoStatusKeyRaw = body?.calendarVideoStatusKey;
    const calendarIdleUsePreferredRaw = body?.calendarIdleUsePreferred;
    const calendarKeywordsRaw = body?.calendarKeywords;
    const calendarIdsRaw = body?.calendarIds;
    const outlookCalendarIdsRaw = body?.outlookCalendarIds;
    const calendarDetectVideoLinksRaw = body?.calendarDetectVideoLinks;
    if (typeof timezone === "string") {
      update.timezone = timezone;
    }
    if (typeof timeFormat === "string") {
      update.timeFormat = timeFormat;
    }
    if (typeof dateFormat === "string") {
      update.dateFormat = dateFormat;
    }

    let calendarIcsUrl: string | null | undefined;
    if (typeof calendarIcsUrlRaw === "string") {
      const trimmed = calendarIcsUrlRaw.trim();
      if (trimmed.length === 0) {
        calendarIcsUrl = null;
      } else {
        try {
          const parsed = new URL(trimmed);
          const protocolAllowed = ["https:", "http:"].includes(parsed.protocol);
          const looksIcs = parsed.pathname.toLowerCase().endsWith(".ics");
          if (!protocolAllowed || !looksIcs) {
            return NextResponse.json({ error: "Calendar URL must be an http(s) .ics link" }, { status: 400 });
          }
          calendarIcsUrl = trimmed;
        } catch {
          return NextResponse.json({ error: "Invalid calendar URL" }, { status: 400 });
        }
      }
      update.calendarIcsUrl = calendarIcsUrl;
    }

    const parseStatusKey = (value: unknown, label: string) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      const num = Number(value);
      if (!Number.isInteger(num) || num < 1 || num > 12) {
        throw new Error(`${label} status must be between 1 and 12`);
      }
      return num;
    };

    try {
      const meetingKey = parseStatusKey(calendarMeetingStatusKeyRaw, "Meeting");
      const oooKey = parseStatusKey(calendarOooStatusKeyRaw, "Out of office");
      const idleKey = parseStatusKey(calendarIdleStatusKeyRaw, "Default");
      const keywordKey = parseStatusKey(calendarKeywordStatusKeyRaw, "Keyword");
      const videoKey = parseStatusKey(calendarVideoStatusKeyRaw, "Video link");
      const idleUsePreferred = typeof calendarIdleUsePreferredRaw === "boolean" ? calendarIdleUsePreferredRaw : undefined;
      if (idleUsePreferred !== undefined) update.calendarIdleUsePreferred = idleUsePreferred;
      if (meetingKey !== undefined) update.calendarMeetingStatusKey = meetingKey;
      if (oooKey !== undefined) update.calendarOooStatusKey = oooKey;
      if (idleKey !== undefined) update.calendarIdleStatusKey = idleKey;
      if (keywordKey !== undefined) update.calendarKeywordStatusKey = keywordKey;
      if (videoKey !== undefined) update.calendarVideoStatusKey = videoKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid calendar status mapping";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (calendarKeywordsRaw !== undefined) {
      const keywords: string[] =
        typeof calendarKeywordsRaw === "string"
          ? calendarKeywordsRaw
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : Array.isArray(calendarKeywordsRaw)
            ? (calendarKeywordsRaw as unknown[])
                .map((s) => (typeof s === "string" ? s.trim() : ""))
                .filter((s) => s.length > 0)
            : [];
      update.calendarKeywords = keywords.slice(0, 20);
    }

    if (calendarIdsRaw !== undefined) {
      const ids: string[] = Array.isArray(calendarIdsRaw)
        ? (calendarIdsRaw as unknown[])
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length > 0)
        : typeof calendarIdsRaw === "string"
          ? calendarIdsRaw
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
      update.calendarIds = ids.slice(0, 10);
    }
    if (outlookCalendarIdsRaw !== undefined) {
      const ids: string[] = Array.isArray(outlookCalendarIdsRaw)
        ? (outlookCalendarIdsRaw as unknown[])
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length > 0)
        : typeof outlookCalendarIdsRaw === "string"
          ? outlookCalendarIdsRaw
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
      update.outlookCalendarIds = ids.slice(0, 10);
    }

    if (typeof calendarDetectVideoLinksRaw === "boolean") {
      update.calendarDetectVideoLinks = calendarDetectVideoLinksRaw;
    }

    if (
      !update.statuses &&
      !("showLastUpdated" in update) &&
      !("showStatusSource" in update) &&
      !("timezone" in update) &&
      !("timeFormat" in update) &&
      !("dateFormat" in update) &&
      !("calendarIcsUrl" in update) &&
      !("calendarMeetingStatusKey" in update) &&
      !("calendarOooStatusKey" in update) &&
      !("calendarIdleStatusKey" in update) &&
      !("calendarKeywordStatusKey" in update) &&
      !("calendarVideoStatusKey" in update) &&
      !("calendarIdleUsePreferred" in update) &&
      !("calendarKeywords" in update) &&
      !("calendarIds" in update) &&
      !("outlookCalendarIds" in update) &&
      !("calendarDetectVideoLinks" in update)
    ) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const now = Date.now();
    update.updatedAt = now;

    await ref.update(update);
    const refreshed = await ref.get();
    const refreshedData = refreshed.data();

    if (calendarIdsRaw !== undefined) {
      const nextIds = Array.isArray(refreshedData?.calendarIds) ? (refreshedData?.calendarIds as string[]) : [];
      try {
        await ensureCalendarWatchesForDevice(user.uid, deviceId, nextIds);
      } catch (err) {
        console.error("Failed to ensure Google Calendar watches", err);
      }
    }
    if (outlookCalendarIdsRaw !== undefined) {
      const nextOutlookIds = Array.isArray(refreshedData?.outlookCalendarIds)
        ? (refreshedData?.outlookCalendarIds as string[])
        : [];
      try {
        await ensureOutlookSubscriptionsForDevice(user.uid, deviceId, nextOutlookIds);
      } catch (err) {
        console.error("Failed to ensure Outlook subscriptions", err);
      }
    }

    // Push labels to TRMNL so webhook can render them
    const webhookUrlEncrypted = data.webhookUrlEncrypted as string | undefined;
    if (webhookUrlEncrypted) {
      const webhookUrl = decrypt(webhookUrlEncrypted);
      const latestStatusLabel =
        (refreshedData?.activeStatusLabel as string | null) ??
        (data.activeStatusLabel as string | null) ??
        null;
      const latestStatusSource =
        (refreshedData?.activeStatusSource as string | null) ??
        (data as any)?.activeStatusSource ??
        null;
      const latestUpdatedAt =
        (refreshedData?.updatedAt as number | null) ?? (data.updatedAt as number | null) ?? null;
      const formattedUpdatedAt =
        latestUpdatedAt !== null
          ? formatTimestamp(
              latestUpdatedAt,
              (refreshedData?.timezone as string) ?? (data.timezone as string) ?? "UTC",
              (refreshedData?.dateFormat as string) ?? (data.dateFormat as string) ?? "MDY",
              (refreshedData?.timeFormat as string) ?? (data.timeFormat as string) ?? "24h",
            )
          : undefined;
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merge_variables: {
              show_last_updated: typeof showLastUpdated === "boolean" ? showLastUpdated : data.showLastUpdated ?? true,
              show_status_source: typeof showStatusSource === "boolean" ? showStatusSource : data.showStatusSource ?? false,
              ...(latestStatusLabel ? { status_text: latestStatusLabel } : {}),
              ...(latestStatusSource ? { status_source: latestStatusSource } : {}),
              ...(formattedUpdatedAt ? { updated_at: formattedUpdatedAt } : {}),
            },
            merge_strategy: "replace",
          }),
        });
      } catch (err) {
        console.error("Failed to push flags to TRMNL", err);
      }
    }

    return NextResponse.json({ device: refreshedData }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("device patch error", error);
    return NextResponse.json({ error: "Failed to update statuses" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("id") ?? "default";

    const ref = adminDb.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = snap.data();
    if (!data || data.userId !== user.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ref.delete();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("device delete error", error);
    return NextResponse.json({ error: "Failed to remove device" }, { status: 500 });
  }
}

function formatTimestamp(timestamp: number, timezone: string, dateFormat: string, timeFormat: string) {
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

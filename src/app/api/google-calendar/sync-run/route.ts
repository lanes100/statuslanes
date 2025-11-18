import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { decrypt } from "@/lib/crypto";
import { getOAuthClient, getCalendarClient } from "@/lib/google";

type SyncState = {
  syncToken?: string | null;
  lastSyncedAt?: number | null;
};

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
  preferredStatusKey?: number | null;
  preferredStatusLabel?: string | null;
  calendarIdleUsePreferred?: boolean;
  activeEventEndsAt?: number | null;
  lastIcsSyncedAt?: number | null;
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  showLastUpdated?: boolean;
  showStatusSource?: boolean;
  webhookUrlEncrypted?: string;
  calendarDetectVideoLinks?: boolean;
  calendarVideoStatusKey?: number | null;
};

type GoogleTokenRecord = {
  uid: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scope?: string | null;
  tokenType?: string | null;
  syncToken?: string | null;
  lastSyncedAt?: number | null;
  manualSyncRequestedAt?: number | null;
};

const BATCH_USERS = 5;

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const header = request.headers.get("x-sync-secret");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  try {
    const tokenSnap = await adminDb.collection("google_tokens").limit(BATCH_USERS).get();
    const now = Date.now();

    for (const tokenDoc of tokenSnap.docs) {
      const tokenData = tokenDoc.data() as GoogleTokenRecord;
      if (!tokenData.accessToken && !tokenData.refreshToken) continue;
      const userId = tokenData.uid;

      // Get device (first for user)
      const deviceSnap = await adminDb.collection("devices").where("userId", "==", userId).limit(1).get();
      if (deviceSnap.empty) continue;
      const device = deviceSnap.docs[0].data() as DeviceRecord;
      const deviceRef = deviceSnap.docs[0].ref;

      const calendarIds = device.calendarIds ?? [];
      if (calendarIds.length === 0) continue;

      // Prepare auth
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials({
        access_token: tokenData.accessToken ?? undefined,
        refresh_token: tokenData.refreshToken ?? undefined,
        expiry_date: tokenData.expiryDate ?? undefined,
        token_type: tokenData.tokenType ?? undefined,
        scope: tokenData.scope ?? undefined,
      });
      const calendar = getCalendarClient(oauth2Client);

      const syncState: SyncState = { syncToken: tokenData.syncToken ?? undefined, lastSyncedAt: tokenData.lastSyncedAt };
      // If a previously set calendar status has an end time and we've passed it, revert to idle/preferred before processing new events
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

      for (const calId of calendarIds) {
        try {
          const listRes = await calendar.events.list({
            calendarId: calId,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 50,
            timeMin: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
            timeMax: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
            syncToken: syncState.syncToken ?? undefined,
          });

          // Store new syncToken if returned
          if (listRes.data.nextSyncToken) {
            syncState.syncToken = listRes.data.nextSyncToken;
          }

          const events = listRes.data.items ?? [];
          const upcoming = events.filter((ev) => {
            const start = ev.start?.dateTime ?? ev.start?.date;
            const end = ev.end?.dateTime ?? ev.end?.date;
            if (!start || !end) return false;
            const startTs = new Date(start).getTime();
            const endTs = new Date(end).getTime();
            return endTs > now - 5 * 60 * 1000 && startTs < now + 60 * 60 * 1000; // window around now
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

      // Basic priority: keyword > video-link > OOO (all-day?) > timed/busy > idle
      for (const ev of upcoming) {
        const title = ev.summary ?? "";
        const desc = ev.description ?? "";
        const isAllDay = Boolean(ev.start?.date);
        const endRaw = ev.end?.dateTime ?? ev.end?.date ?? null;
        const endTs = endRaw ? new Date(endRaw).getTime() : null;
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
        // Update device with active status if changed and push to TRMNL
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
        } catch (err) {
          console.error("calendar sync error", calId, err);
          if (err && typeof err === "object" && "code" in err && (err as any).code === 410) {
            // syncToken expired
            syncState.syncToken = undefined;
          }
        }
      }

      await adminDb
        .collection("google_tokens")
        .doc(userId)
        .update({ syncToken: syncState.syncToken ?? null, lastSyncedAt: now, manualSyncRequestedAt: null });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("google sync-run error", error);
    return NextResponse.json({ error: "Failed to sync calendars" }, { status: 500 });
  }
}

async function pushStatusToTrmnl(device: DeviceRecord, statusKey: number | null, statusLabel: string) {
  const webhookUrlEncrypted = (device as any).webhookUrlEncrypted as string | undefined;
  if (!webhookUrlEncrypted) return;
  const webhookUrl = decrypt(webhookUrlEncrypted);
  const timestamp = formatTimestamp(
    Date.now(),
    device.timezone || "UTC",
    device.dateFormat || "MDY",
    device.timeFormat || "24h",
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

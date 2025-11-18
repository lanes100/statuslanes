import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
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

export async function POST() {
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

          // Basic priority: keyword > OOO (all-day?) > meeting > idle
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
            // Update device with active status if changed
            if (device.activeStatusKey !== chosenKey || device.activeStatusLabel !== chosenLabel) {
              await deviceRef.update({
                activeStatusKey: chosenKey,
                activeStatusLabel: chosenLabel,
                updatedAt: Date.now(),
              });
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

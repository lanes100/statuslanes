import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebaseAdmin";
import { ensureCalendarWatchesForDevice } from "@/lib/googleCalendarWatch";
import { getOAuthClient, getCalendarClient } from "@/lib/google";
import type { DeviceRecord } from "@/app/api/google-calendar/sync/route";

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const header = request.headers.get("x-sync-secret");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const tokenSnap = await adminDb.collection("google_tokens").get();
    let refreshed = 0;

    for (const tokenDoc of tokenSnap.docs) {
      const tokenData = tokenDoc.data();
      if (!tokenData.accessToken && !tokenData.refreshToken) {
        continue;
      }
      const userId = tokenData.uid as string;
      const deviceSnap = await adminDb.collection("devices").where("userId", "==", userId).limit(1).get();
      if (deviceSnap.empty) continue;
      const deviceDoc = deviceSnap.docs[0];
      const device = deviceDoc.data() as DeviceRecord;
      const calendarIds = device.calendarIds ?? [];
      if (calendarIds.length === 0) continue;

      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials({
        access_token: tokenData.accessToken ?? undefined,
        refresh_token: tokenData.refreshToken ?? undefined,
        expiry_date: tokenData.expiryDate ?? undefined,
        token_type: tokenData.tokenType ?? undefined,
        scope: tokenData.scope ?? undefined,
      });
      const calendar = getCalendarClient(oauth2Client);

      await ensureCalendarWatchesForDevice(userId, deviceDoc.id, calendarIds, { calendarClient: calendar });
      refreshed += 1;
    }

    return NextResponse.json({ refreshed }, { status: 200 });
  } catch (error) {
    console.error("google-calendar/watch-refresh error", error);
    return NextResponse.json({ error: "Failed to refresh watches" }, { status: 500 });
  }
}


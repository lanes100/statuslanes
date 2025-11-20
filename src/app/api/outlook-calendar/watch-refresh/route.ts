import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebaseAdmin";
import { ensureOutlookSubscriptionsForDevice } from "@/lib/outlookCalendarWatch";

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
    const tokenSnap = await adminDb.collection("outlook_tokens").limit(BATCH_USERS).get();
    let refreshed = 0;

    for (const tokenDoc of tokenSnap.docs) {
      const userId = tokenDoc.id;
      const devicesSnap = await adminDb.collection("devices").where("userId", "==", userId).limit(1).get();
      if (devicesSnap.empty) continue;
      const deviceDoc = devicesSnap.docs[0];
      const device = deviceDoc.data();
      const outlookIds = Array.isArray(device.outlookCalendarIds)
        ? (device.outlookCalendarIds as string[])
        : [];
      if (outlookIds.length === 0) continue;

      await ensureOutlookSubscriptionsForDevice(userId, deviceDoc.id, outlookIds);
      refreshed += 1;
    }

    return NextResponse.json({ refreshed }, { status: 200 });
  } catch (error) {
    console.error("outlook-calendar/watch-refresh error", error);
    return NextResponse.json({ error: "Failed to refresh Outlook watches" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { adminDb } from "@/lib/firebaseAdmin";
import { ensureOutlookAccessToken } from "@/lib/outlookTokens";
import { OUTLOOK_SUBS_COLLECTION } from "@/lib/outlookCalendarWatch";
import { runOutlookSyncForUser } from "@/app/api/outlook-calendar/sync/route";

type Notification = {
  subscriptionId: string;
  clientState?: string;
  lifecycleEvent?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const validationToken = searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const body = raw ? JSON.parse(raw) : {};
    const notifications: Notification[] = Array.isArray(body?.value) ? body.value : [];
    if (notifications.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const handledDevices = new Set<string>();

    for (const notification of notifications) {
      if (!notification.subscriptionId) continue;
      const subDoc = await adminDb.collection(OUTLOOK_SUBS_COLLECTION).doc(notification.subscriptionId).get();
      if (!subDoc.exists) continue;
      const data = subDoc.data() as {
        subscriptionId: string;
        clientState?: string;
        userId: string;
        deviceId: string;
      };
      if (notification.clientState && data.clientState && notification.clientState !== data.clientState) {
        continue;
      }
      if (notification.lifecycleEvent === "subscriptionRemoved") {
        await subDoc.ref.delete();
        continue;
      }

      const key = `${data.userId}:${data.deviceId}`;
      if (handledDevices.has(key)) continue;

      const deviceRef = adminDb.collection("devices").doc(data.deviceId);
      const deviceSnap = await deviceRef.get();
      if (!deviceSnap.exists) {
        await subDoc.ref.delete();
        continue;
      }
      try {
        const { token } = await ensureOutlookAccessToken(data.userId);
        const device = deviceSnap.data() as any;
        await runOutlookSyncForUser(device, deviceRef, token);
        handledDevices.add(key);
      } catch (err) {
        console.error("Failed to process Outlook notification", err);
      }
    }
  } catch (err) {
    console.error("outlook-calendar/webhook error", err);
  }
  return NextResponse.json({ ok: true });
}

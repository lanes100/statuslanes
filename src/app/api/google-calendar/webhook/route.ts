import { NextResponse } from "next/server";

import { runGoogleSyncForUser, type DeviceRecord } from "@/app/api/google-calendar/sync/route";
import { adminDb } from "@/lib/firebaseAdmin";
import { CHANNEL_COLLECTION, type WatchChannelRecord } from "@/lib/googleCalendarWatch";

export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceId = request.headers.get("x-goog-resource-id");
  const token = request.headers.get("x-goog-channel-token");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId || !resourceId) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const channelSnap = await adminDb.collection(CHANNEL_COLLECTION).doc(channelId).get();
    if (!channelSnap.exists) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    const channel = channelSnap.data() as WatchChannelRecord;
    if (channel.token && token !== channel.token) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (channel.resourceId && channel.resourceId !== resourceId) {
      console.warn("Google channel resource mismatch", channel.channelId);
    }

    if (resourceState === "sync") {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (resourceState === "not_exists") {
      await channelSnap.ref.delete();
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const deviceRef = adminDb.collection("devices").doc(channel.deviceId);
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists) {
      await channelSnap.ref.delete();
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const tokenSnap = await adminDb.collection("google_tokens").doc(channel.userId).get();
    if (!tokenSnap.exists) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const device = deviceSnap.data() as DeviceRecord | undefined;
    const tokenData = tokenSnap.data();
    if (device && tokenData) {
      await runGoogleSyncForUser(device, deviceRef, tokenData);
    }
  } catch (err) {
    console.error("google-calendar/webhook error", err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

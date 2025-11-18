import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { cookies } from "next/headers";

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

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("id");

    let deviceRef = null;
    if (deviceId) {
      deviceRef = adminDb.collection("devices").doc(deviceId);
    } else {
      const snap = await adminDb.collection("devices").where("userId", "==", user.uid).limit(1).get();
      if (!snap.empty) {
        deviceRef = snap.docs[0].ref;
      }
    }

    if (!deviceRef) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const deviceSnap = await deviceRef.get();
    const data = deviceSnap.data();
    if (!data || data.userId !== user.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Mark a manual sync request timestamp for future processing.
    await deviceRef.update({ calendarManualSyncRequestedAt: Date.now() });

    return NextResponse.json({ queued: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("sync-trmnl error", error);
    return NextResponse.json({ error: "Failed to queue sync" }, { status: 500 });
  }
}

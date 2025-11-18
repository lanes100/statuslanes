import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

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

export async function POST() {
  try {
    const user = await requireUser();
    const ref = adminDb.collection("google_tokens").doc(user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Google not connected" }, { status: 400 });
    }
    await ref.update({ manualSyncRequestedAt: Date.now() });
    return NextResponse.json({ queued: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("google-calendar/sync error", error);
    return NextResponse.json({ error: "Failed to queue sync" }, { status: 500 });
  }
}

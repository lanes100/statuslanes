import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { removeAllCalendarWatchesForUser } from "@/lib/googleCalendarWatch";

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
    try {
      await removeAllCalendarWatchesForUser(user.uid);
    } catch (err) {
      console.error("Failed to remove Google Calendar channels on disconnect", err);
    }
    await adminDb.collection("google_tokens").doc(user.uid).delete();
    return NextResponse.json({ disconnected: true }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("google-calendar/disconnect error", error);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}

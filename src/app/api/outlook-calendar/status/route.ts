import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { adminAuth } from "@/lib/firebaseAdmin";
import { getOutlookTokenRecord } from "@/lib/outlookTokens";

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

export async function GET() {
  try {
    const user = await requireUser();
    const record = await getOutlookTokenRecord(user.uid);
    if (!record) {
      return NextResponse.json({ connected: false, lastSyncedAt: null });
    }
    return NextResponse.json({
      connected: Boolean(record.accessToken),
      lastSyncedAt: record.lastSyncedAt ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("outlook-calendar/status error", error);
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}

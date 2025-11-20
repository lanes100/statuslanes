import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { adminAuth } from "@/lib/firebaseAdmin";
import { ensureOutlookAccessToken } from "@/lib/outlookTokens";
import { graphRequest } from "@/lib/outlook";

const SESSION_COOKIE_NAME = "statuslanes_session";

type OutlookCalendar = { id: string; name: string };

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
    const { token } = await ensureOutlookAccessToken(user.uid);
    const res = await graphRequest<{ value: OutlookCalendar[] }>(token, "/me/calendars?$top=50&$select=id,name");
    return NextResponse.json({ calendars: res.value });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UNAUTHENTICATED") {
        return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
      }
      if (error.message === "OUTLOOK_NOT_CONNECTED") {
        return NextResponse.json({ error: "Outlook not connected" }, { status: 400 });
      }
    }
    console.error("outlook-calendar/calendars error", error);
    return NextResponse.json({ error: "Failed to load calendars" }, { status: 500 });
  }
}

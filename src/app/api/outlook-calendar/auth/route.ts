import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { adminAuth } from "@/lib/firebaseAdmin";
import { buildOutlookAuthUrl } from "@/lib/outlook";

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
    const url = buildOutlookAuthUrl(JSON.stringify({ uid: user.uid }));
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UNAUTHENTICATED") {
        return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
      }
      if (error.message.startsWith("Missing Outlook env vars")) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    console.error("outlook-calendar/auth error", error);
    return NextResponse.json({ error: "Failed to start Outlook auth" }, { status: 500 });
  }
}

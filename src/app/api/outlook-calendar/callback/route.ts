import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { adminAuth } from "@/lib/firebaseAdmin";
import { exchangeOutlookCodeForToken } from "@/lib/outlook";
import { saveOutlookTokens } from "@/lib/outlookTokens";

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

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    if (!code) {
      return NextResponse.redirect(new URL("/settings?outlook=missing_code", request.url));
    }

    const tokens = await exchangeOutlookCodeForToken(code);
    await saveOutlookTokens(user.uid, tokens);

    return NextResponse.redirect(new URL("/settings?outlook=connected", request.url));
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UNAUTHENTICATED") {
        return NextResponse.redirect(new URL("/login?error=unauthenticated", request.url));
      }
      if (error.message.startsWith("Missing Outlook env vars")) {
        return NextResponse.redirect(new URL("/settings?outlook=env", request.url));
      }
    }
    console.error("outlook-calendar/callback error", error);
    return NextResponse.redirect(new URL("/settings?outlook=error", request.url));
  }
}

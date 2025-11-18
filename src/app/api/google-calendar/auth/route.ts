import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

const SESSION_COOKIE_NAME = "statuslanes_session";

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    const missing = [
      !clientId ? "GOOGLE_CLIENT_ID" : null,
      !clientSecret ? "GOOGLE_CLIENT_SECRET" : null,
      !redirectUri ? "GOOGLE_REDIRECT_URI" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Google OAuth env vars missing: ${missing}`);
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid, email: decoded.email ?? null };
}

export async function GET() {
  try {
    const user = await requireUser();
    const oauth2Client = getOAuthClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      state: JSON.stringify({ uid: user.uid }),
    });
    return NextResponse.json({ url });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("google-calendar/auth error", error);
    if (error instanceof Error && error.message.includes("Google OAuth env vars missing")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Failed to start Google auth" }, { status: 500 });
  }
}

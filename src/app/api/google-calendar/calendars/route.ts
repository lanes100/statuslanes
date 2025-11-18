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
    throw new Error("Google OAuth env vars missing");
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
  return { uid: decoded.uid };
}

export async function GET() {
  try {
    const user = await requireUser();
    const tokenDoc = await adminDb.collection("google_tokens").doc(user.uid).get();
    const tokenData = tokenDoc.data();
    if (!tokenData || (!tokenData.accessToken && !tokenData.refreshToken)) {
      return NextResponse.json({ error: "Not connected" }, { status: 400 });
    }

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token: tokenData.accessToken ?? undefined,
      refresh_token: tokenData.refreshToken ?? undefined,
      expiry_date: tokenData.expiryDate ?? undefined,
      token_type: tokenData.tokenType ?? undefined,
      scope: tokenData.scope ?? undefined,
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const { data } = await calendar.calendarList.list({ minAccessRole: "reader", maxResults: 50 });
    const calendars =
      data.items?.map((item) => ({
        id: item.id ?? "",
        summary: item.summary ?? "(untitled)",
        primary: item.primary ?? false,
      })) ?? [];

    return NextResponse.json({ calendars }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("google-calendar/calendars error", error);
    return NextResponse.json({ error: "Failed to fetch calendars" }, { status: 500 });
  }
}

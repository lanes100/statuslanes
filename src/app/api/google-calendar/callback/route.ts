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

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    if (!code) return NextResponse.redirect(new URL("/settings?error=missing_code", request.url));

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    // Persist tokens per user (and default device for now)
    await adminDb
      .collection("google_tokens")
      .doc(user.uid)
      .set({
        uid: user.uid,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiryDate: tokens.expiry_date ?? null,
        scope: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
        updatedAt: Date.now(),
      });

    return NextResponse.redirect(new URL("/settings?google=connected", request.url));
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.redirect(new URL("/login?error=unauthenticated", request.url));
    }
    console.error("google-calendar/callback error", error);
    return NextResponse.redirect(new URL("/settings?google=error", request.url));
  }
}

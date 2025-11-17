import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebaseAdmin";

const SESSION_COOKIE_NAME = "statuslanes_session";

export async function GET() {
  try {
    const cookieStore = cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return NextResponse.json(
      {
        authenticated: true,
        user: {
          uid: decoded.uid,
          email: decoded.email,
          email_verified: decoded.email_verified,
          sign_in_provider: decoded.firebase.sign_in_provider,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error verifying session cookie", error);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}

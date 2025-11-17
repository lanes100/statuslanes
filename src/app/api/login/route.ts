import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

const SESSION_COOKIE_NAME = "statuslanes_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
    }

    const expiresIn = SESSION_MAX_AGE_MS;
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    const response = NextResponse.json({ success: true }, { status: 200 });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionCookie,
      maxAge: Math.floor(expiresIn / 1000),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Error creating session cookie", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 401 });
  }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

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
    const tokenDoc = await adminDb.collection("google_tokens").doc(user.uid).get();
    const data = tokenDoc.data();
    const connected = Boolean(data?.refreshToken || data?.accessToken);
    return NextResponse.json({ connected }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("google-calendar/status error", error);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}

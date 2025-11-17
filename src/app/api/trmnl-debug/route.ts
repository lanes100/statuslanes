import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { decrypt } from "@/lib/crypto";

const SESSION_COOKIE_NAME = "statuslanes_session";

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) throw new Error("UNAUTHENTICATED");
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid };
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const deviceId = (body?.deviceId as string | undefined) ?? "default";

    const ref = adminDb.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = snap.data();
    if (!data || data.userId !== user.uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const encrypted = data.webhookUrlEncrypted as string | undefined;
    if (!encrypted) return NextResponse.json({ error: "No webhook stored" }, { status: 500 });
    const webhookUrl = decrypt(encrypted);

    const res = await fetch(webhookUrl, { method: "GET" });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    return NextResponse.json(
      {
        status: res.status,
        body: parsed,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch TRMNL debug info";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

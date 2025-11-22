import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { cookies } from "next/headers";

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
    const body = await request.json().catch(() => ({}));
    const pluginSettingIdRaw = body?.plugin_setting_id ?? body?.pluginSettingId;
    if (!pluginSettingIdRaw) {
      return NextResponse.json({ error: "Missing plugin_setting_id" }, { status: 400 });
    }
    const pluginSettingId = String(pluginSettingIdRaw).trim();
    if (!pluginSettingId) {
      return NextResponse.json({ error: "Invalid plugin_setting_id" }, { status: 400 });
    }

    const ref = adminDb.collection("trmnl").doc(pluginSettingId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Installation not found" }, { status: 404 });
    }
    const data = snap.data() ?? {};
    const linkedUserId = data.linkedUserId as string | undefined;
    if (linkedUserId && linkedUserId !== user.uid) {
      return NextResponse.json({ error: "Plugin already linked to another user" }, { status: 409 });
    }

    await ref.set(
      {
        pluginSettingId,
        linkedUserId: user.uid,
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    return NextResponse.json({ linked: true, plugin_setting_id: pluginSettingId }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("manage/link error", error);
    const message = error instanceof Error ? error.message : "Failed to link plugin";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

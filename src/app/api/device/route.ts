import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "statuslanes_session";

async function requireUser() {
  const sessionCookie = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid, email: decoded.email ?? null };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get("id");

    if (deviceId) {
      const snapshot = await adminDb.collection("devices").doc(deviceId).get();
      if (!snapshot.exists) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const data = snapshot.data();
      if (!data || data.userId !== user.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      return NextResponse.json({ device: data }, { status: 200 });
    }

    const querySnap = await adminDb
      .collection("devices")
      .where("userId", "==", user.uid)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const doc = querySnap.docs[0];
    return NextResponse.json({ device: doc.data() }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("device get error", error);
    return NextResponse.json({ error: "Failed to fetch device" }, { status: 500 });
  }
}

type StatusInput = { key: number; label: string; enabled: boolean };

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const deviceId = (body?.deviceId as string | undefined) ?? "default";
    const statuses = body?.statuses as StatusInput[] | undefined;

    if (!statuses || !Array.isArray(statuses)) {
      return NextResponse.json({ error: "Missing statuses" }, { status: 400 });
    }

    const sanitized = statuses
      .map((s) => ({
        key: Number(s.key),
        label: typeof s.label === "string" ? s.label.slice(0, 60) : "",
        enabled: Boolean(s.enabled),
      }))
      .filter((s) => Number.isInteger(s.key) && s.key >= 1 && s.key <= 10 && s.label.trim().length > 0);

    if (sanitized.length === 0) {
      return NextResponse.json({ error: "No valid statuses provided" }, { status: 400 });
    }

    const ref = adminDb.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snap.data();
    if (!data || data.userId !== user.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ref.update({ statuses: sanitized, updatedAt: Date.now() });
    const refreshed = await ref.get();

    return NextResponse.json({ device: refreshed.data() }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("device patch error", error);
    return NextResponse.json({ error: "Failed to update statuses" }, { status: 500 });
  }
}

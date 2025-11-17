import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { decrypt } from "@/lib/crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "statuslanes_session";

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
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
    const showLastUpdated = body?.showLastUpdated as boolean | undefined;
    const showStatusSource = body?.showStatusSource as boolean | undefined;

    const ref = adminDb.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snap.data();
    if (!data || data.userId !== user.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sanitized =
      statuses && Array.isArray(statuses)
        ? statuses
            .map((s) => ({
              key: Number(s.key),
              label: typeof s.label === "string" ? s.label.slice(0, 60) : "",
              enabled: Boolean(s.enabled),
            }))
            .filter((s) => Number.isInteger(s.key) && s.key >= 1 && s.key <= 12 && s.label.trim().length > 0)
        : (data.statuses as StatusInput[] | undefined) ?? [];

    const update: Record<string, unknown> = { updatedAt: Date.now() };
    if (sanitized.length > 0) {
      update.statuses = sanitized;
    }
    if (typeof showLastUpdated === "boolean") {
      update.showLastUpdated = showLastUpdated;
    }
    if (typeof showStatusSource === "boolean") {
      update.showStatusSource = showStatusSource;
    }

    if (!update.statuses && !("showLastUpdated" in update) && !("showStatusSource" in update)) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const now = Date.now();
    update.updatedAt = now;

    await ref.update(update);
    const refreshed = await ref.get();
    const refreshedData = refreshed.data();

    // Push labels to TRMNL so webhook can render them
    const webhookUrlEncrypted = data.webhookUrlEncrypted as string | undefined;
    if (webhookUrlEncrypted) {
      const webhookUrl = decrypt(webhookUrlEncrypted);
      const labelPayload: Record<string, string> = {};
      const statusesForPush = sanitized.length > 0 ? sanitized : (refreshedData?.statuses as StatusInput[] | undefined) ?? [];
      statusesForPush
        .filter((s) => s.key >= 1 && s.key <= 10)
        .forEach((s) => {
          labelPayload[`status_${s.key}_label`] = s.label;
        });
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merge_variables: {
              ...labelPayload,
              show_last_updated: typeof showLastUpdated === "boolean" ? showLastUpdated : data.showLastUpdated ?? true,
              show_status_source: typeof showStatusSource === "boolean" ? showStatusSource : data.showStatusSource ?? true,
            },
            merge_strategy: "deep_merge",
          }),
        });
      } catch (err) {
        console.error("Failed to push labels to TRMNL", err);
      }
    }

    return NextResponse.json({ device: refreshedData }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("device patch error", error);
    return NextResponse.json({ error: "Failed to update statuses" }, { status: 500 });
  }
}

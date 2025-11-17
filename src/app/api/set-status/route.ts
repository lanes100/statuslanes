import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { cookies } from "next/headers";
import { decrypt } from "@/lib/crypto";

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

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const deviceId = body?.deviceId as string | undefined;
    const statusKey = body?.statusKey as number | undefined;
    const statusLabel = (body?.statusLabel as string | undefined)?.trim();
    const statusSource = (body?.statusSource as string | undefined) ?? "Web App";

    if (!deviceId || !statusLabel) {
      return NextResponse.json({ error: "Missing deviceId or statusLabel" }, { status: 400 });
    }
    if (statusKey !== undefined && (!Number.isInteger(statusKey) || statusKey < 1 || statusKey > 12)) {
      return NextResponse.json({ error: "Invalid statusKey" }, { status: 400 });
    }

    const ref = adminDb.collection("devices").doc(deviceId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = snapshot.data();
    if (!data || data.userId !== user.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatedAt = Date.now();
    await ref.update({
      activeStatusKey: statusKey ?? null,
      activeStatusLabel: statusLabel,
      updatedAt,
    });

    const webhookUrlEncrypted = data.webhookUrlEncrypted as string | undefined;
    if (!webhookUrlEncrypted) {
      return NextResponse.json({ error: "No webhook URL stored" }, { status: 500 });
    }

    const webhookUrl = decrypt(webhookUrlEncrypted);
    const payload = {
      merge_variables: {
        status_text: statusLabel,
        status_source: statusSource,
        show_last_updated: data.showLastUpdated ?? true,
        show_status_source: data.showStatusSource ?? true,
        updated_at: new Date(updatedAt).toISOString(),
      },
    };

    const webhookRes = await sendWebhookWithRetry(webhookUrl, payload);
    if (!webhookRes.ok) {
      const bodyText = await webhookRes.text();
      return NextResponse.json(
        {
          error: `TRMNL responded ${webhookRes.status}: ${bodyText || "No body"}`,
          status: webhookRes.status,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { success: true, activeStatusKey: statusKey, activeStatusLabel: statusLabel, updatedAt },
      { status: 200 },
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("set-status error", error);
    return NextResponse.json({ error: "Failed to set status" }, { status: 500 });
  }
}

async function sendWebhookWithRetry(url: string, body: Record<string, unknown>) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return res;
      if (res.status >= 500 || res.status === 429) {
        // retryable
        const backoff = Math.min(1000 * 2 ** attempt, 4000);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        attempt += 1;
        lastError = res;
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      const backoff = Math.min(1000 * 2 ** attempt, 4000);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      attempt += 1;
    }
  }

  throw lastError ?? new Error("Webhook failed");
}

import { NextResponse } from "next/server";

import { decrypt } from "@/lib/crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { formatTimestamp } from "@/lib/calendarSync";
import { generateIftttId, generateIftttSecret } from "@/lib/ifttt";

const DEFAULT_SOURCE = "IFTTT Geofence";

function extractSecret(request: Request): string | null {
  const headerSecret =
    request.headers.get("x-ifttt-secret") ??
    request.headers.get("x-ifttt-key") ??
    request.headers.get("x-sync-secret");
  const bearer = request.headers.get("authorization");
  const bearerToken = bearer?.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : null;
  const provided = headerSecret?.trim() || bearerToken || "";
  return provided.length > 0 ? provided : null;
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const iftttId = (body?.iftttId as string | undefined)?.trim();
  const deviceId = (body?.deviceId as string | undefined)?.trim(); // legacy fallback
  const statusLabel = (body?.statusLabel as string | undefined)?.trim();
  const statusKey =
    body?.statusKey === undefined || body?.statusKey === null ? undefined : Number(body.statusKey);
  const statusSource = (body?.statusSource as string | undefined)?.trim() || DEFAULT_SOURCE;

  if (!iftttId && !deviceId) {
    return NextResponse.json({ error: "Missing iftttId" }, { status: 400 });
  }
  if (statusKey === undefined) {
    return NextResponse.json({ error: "Missing statusKey" }, { status: 400 });
  }
  if (
    statusKey !== undefined &&
    (!Number.isInteger(statusKey) || statusKey < 1 || statusKey > 12)
  ) {
    return NextResponse.json({ error: "Invalid statusKey" }, { status: 400 });
  }

  const { ref, data } = await resolveDevice(iftttId, deviceId);
  if (!ref || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const providedSecret = extractSecret(request);
  if (!providedSecret || providedSecret !== data.iftttSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const webhookUrlEncrypted = data?.webhookUrlEncrypted as string | undefined;
  if (!webhookUrlEncrypted) {
    return NextResponse.json({ error: "No webhook URL stored" }, { status: 500 });
  }

  const updatedAt = Date.now();
  const formattedTimestamp = formatTimestamp(
    updatedAt,
    (data?.timezone as string) || "UTC",
    (data?.dateFormat as string) || "MDY",
    (data?.timeFormat as string) || "24h",
  );

  const labelFromDevice =
    data?.statuses?.find((s: { key: number; label: string }) => s.key === statusKey)?.label || null;
  const resolvedLabel = statusLabel || labelFromDevice;
  if (!resolvedLabel) {
    return NextResponse.json({ error: "statusLabel missing and not found on device" }, { status: 400 });
  }

  await ref.update({
    activeStatusKey: statusKey ?? null,
    activeStatusLabel: resolvedLabel,
    activeStatusSource: statusSource,
    preferredStatusKey: statusKey ?? null,
    preferredStatusLabel: resolvedLabel,
    activeEventEndsAt: null,
    updatedAt,
  });

  const webhookUrl = decrypt(webhookUrlEncrypted);
  const payload = {
    merge_variables: {
      status_text: resolvedLabel,
      status_source: statusSource,
      show_last_updated: data?.showLastUpdated ?? true,
      show_status_source: data?.showStatusSource ?? false,
      updated_at: formattedTimestamp,
    },
    merge_strategy: "replace",
  };

  try {
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
  } catch (error) {
    console.error("ifttt/geofence webhook error", error);
    return NextResponse.json({ error: "Failed to push status to TRMNL" }, { status: 500 });
  }

  return NextResponse.json(
    {
      success: true,
      activeStatusKey: statusKey ?? null,
      activeStatusLabel: resolvedLabel,
      statusSource,
      updatedAt,
      iftttId: data.iftttId,
    },
    { status: 200 },
  );
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

async function resolveDevice(iftttId?: string | null, deviceId?: string | null) {
  if (iftttId) {
    const snapshot = await adminDb.collection("devices").where("iftttId", "==", iftttId).limit(1).get();
    const doc = snapshot.docs[0];
    if (doc) {
      const data = doc.data();
      if (!data.iftttSecret) {
        const secret = generateIftttSecret();
        await doc.ref.update({ iftttSecret: secret });
        data.iftttSecret = secret;
      }
      return { ref: doc.ref, data };
    }
  }

  if (deviceId) {
    const ref = adminDb.collection("devices").doc(deviceId);
    const snap = await ref.get();
    if (!snap.exists) return { ref: null, data: null };
    const data = snap.data() ?? null;
    if (data) {
      let didUpdate = false;
      if (!data.iftttId) {
        data.iftttId = generateIftttId();
        didUpdate = true;
      }
      if (!data.iftttSecret) {
        data.iftttSecret = generateIftttSecret();
        didUpdate = true;
      }
      if (didUpdate) {
        await ref.update({ iftttId: data.iftttId, iftttSecret: data.iftttSecret });
      }
    }
    return { ref, data };
  }

  return { ref: null, data: null };
}

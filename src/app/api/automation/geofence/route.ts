import { NextResponse } from "next/server";

import { decrypt } from "@/lib/crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { formatTimestamp } from "@/lib/calendarSync";
import { generateAutomationId, generateAutomationSecret } from "@/lib/automation";

const DEFAULT_SOURCE = "Automation";

function extractSecret(request: Request): string | null {
  const headerSecret =
    request.headers.get("x-automation-secret") ??
    request.headers.get("x-automation-key") ??
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

  const automationId = (body?.automationId as string | undefined)?.trim();
  const deviceId = (body?.deviceId as string | undefined)?.trim(); // legacy fallback
  const statusLabel = (body?.statusLabel as string | undefined)?.trim();
  const statusKey =
    body?.statusKey === undefined || body?.statusKey === null ? undefined : Number(body.statusKey);
  const statusSource = (body?.statusSource as string | undefined)?.trim() || DEFAULT_SOURCE;

  if (!automationId && !deviceId) {
    return NextResponse.json({ error: "Missing automationId" }, { status: 400 });
  }
  if (statusKey === undefined) {
    return NextResponse.json({ error: "Missing statusKey" }, { status: 400 });
  }
  if (!Number.isInteger(statusKey) || statusKey < 1 || statusKey > 12) {
    return NextResponse.json({ error: "Invalid statusKey" }, { status: 400 });
  }

  const { ref, data } = await resolveDevice(automationId, deviceId);
  if (!ref || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const providedSecret = extractSecret(request);
  if (!providedSecret || providedSecret !== data.automationSecret) {
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
    console.error("automation/geofence webhook error", error);
    return NextResponse.json({ error: "Failed to push status to TRMNL" }, { status: 500 });
  }

  return NextResponse.json(
    {
      success: true,
      activeStatusKey: statusKey ?? null,
      activeStatusLabel: resolvedLabel,
      statusSource,
      updatedAt,
      automationId: data.automationId,
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

async function resolveDevice(automationId?: string | null, deviceId?: string | null) {
  if (automationId) {
    const snapshot = await adminDb.collection("devices").where("automationId", "==", automationId).limit(1).get();
    const doc = snapshot.docs[0];
    if (doc) {
      const data = doc.data();
      if (!data.automationSecret) {
        const secret = generateAutomationSecret();
        await doc.ref.update({ automationSecret: secret });
        data.automationSecret = secret;
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
      if (!data.automationId) {
        data.automationId = generateAutomationId();
        didUpdate = true;
      }
      if (!data.automationSecret) {
        data.automationSecret = generateAutomationSecret();
        didUpdate = true;
      }
      if (didUpdate) {
        await ref.update({
          automationId: data.automationId,
          automationSecret: data.automationSecret,
        });
      }
    }
    return { ref, data };
  }

  return { ref: null, data: null };
}

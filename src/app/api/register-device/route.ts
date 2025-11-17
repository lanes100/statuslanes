import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";

const SESSION_COOKIE_NAME = "statuslanes_session";

const defaultStatuses = Array.from({ length: 10 }).map((_, idx) => ({
  key: idx + 1,
  label: `Status ${idx + 1}`,
  enabled: true,
}));

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid, email: decoded.email ?? null };
}

function isValidTrmnlWebhook(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostValid = parsed.hostname.endsWith("usetrmnl.com");
    const pathValid = /^\/api\/custom_plugins\/[a-zA-Z0-9_-]+$/.test(parsed.pathname);
    return hostValid && pathValid && ["https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isValidPluginId(id: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
}

function extractPluginId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/api\/custom_plugins\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const webhookUrl = (body?.webhookUrl as string | undefined)?.trim();
    const pluginId = (body?.pluginId as string | undefined)?.trim();
    const deviceName = (body?.deviceName as string | undefined) ?? "My TRMNL";
    const incomingDeviceId = body?.deviceId as string | undefined;

    let resolvedWebhookUrl = webhookUrl;

    if (!resolvedWebhookUrl && pluginId) {
      if (!isValidPluginId(pluginId)) {
        return NextResponse.json({ error: "Invalid TRMNL plugin ID" }, { status: 400 });
      }
      resolvedWebhookUrl = `https://usetrmnl.com/api/custom_plugins/${pluginId}`;
    }

    if (!resolvedWebhookUrl) {
      return NextResponse.json({ error: "Missing webhook url or pluginId" }, { status: 400 });
    }

    if (!isValidTrmnlWebhook(resolvedWebhookUrl)) {
      return NextResponse.json({ error: "Invalid TRMNL webhook URL" }, { status: 400 });
    }

    const deviceId = incomingDeviceId || "default";
    const now = Date.now();
    const existing = await adminDb.collection("devices").doc(deviceId).get();
    if (existing.exists && existing.data()?.userId !== user.uid) {
      return NextResponse.json({ error: "Device ID already used" }, { status: 409 });
    }

    let encryptedWebhook: string;
    try {
      encryptedWebhook = encrypt(resolvedWebhookUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Encryption failed";
      return NextResponse.json({ error: `Server config error: ${msg}` }, { status: 500 });
    }

    const fetched = await fetchTrmnlStatuses(resolvedWebhookUrl);

    await adminDb
      .collection("devices")
      .doc(deviceId)
      .set({
        deviceId,
        userId: user.uid,
        deviceName,
        pluginId: pluginId ?? extractPluginId(resolvedWebhookUrl),
        webhookUrlEncrypted: encryptedWebhook,
        statuses: fetched?.statuses ?? defaultStatuses,
        activeStatusKey: null,
        activeStatusLabel: null,
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ deviceId }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("register-device error", error);
    const message = error instanceof Error ? error.message : "Failed to register device";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type TrmnlStatusResult = { statuses: typeof defaultStatuses; resolvedCount: number };

async function fetchTrmnlStatuses(webhookUrl: string): Promise<TrmnlStatusResult | null> {
  try {
    const res = await fetch(webhookUrl, { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const mv =
      typeof json === "object" && json && "merge_variables" in json ? (json as Record<string, unknown>).merge_variables : undefined;
    if (!mv || typeof mv !== "object") return null;

    let resolvedCount = 0;
    const statuses = defaultStatuses.map((s) => {
      const label = (mv as Record<string, unknown>)[`status_${s.key}_label`];
      const nextLabel =
        typeof label === "string" && label.trim().length > 0 ? label.trim().slice(0, 60) : s.label;
      if (nextLabel !== s.label) resolvedCount += 1;
      return {
        ...s,
        label: nextLabel,
      };
    });
    return { statuses, resolvedCount };
  } catch {
    return null;
  }
}

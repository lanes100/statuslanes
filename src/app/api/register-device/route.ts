import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";

const SESSION_COOKIE_NAME = "statuslanes_session";

const defaultLabels = [
  "in the office 🏢",
  "in a meeting 👥",
  "working remotely 🏠",
  "busy, do not disturb 🔕",
  "out of the office 🌴",
  "at lunch 🍽️",
];

const defaultStatuses = defaultLabels.map((label, idx) => ({
  key: idx + 1,
  label,
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

async function resolveDeviceId(userId: string, incomingId?: string | null): Promise<string> {
  const trimmed = incomingId?.trim();
  if (trimmed) return trimmed;

  // Reuse any existing device doc that already belongs to this user so reruns of registration keep their data.
  const existingForUser = await adminDb.collection("devices").where("userId", "==", userId).limit(1).get();
  if (!existingForUser.empty) {
    return existingForUser.docs[0].id;
  }

  return `user-${userId}`;
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
    const requestedTimezone = (body?.timezone as string | undefined)?.trim();
    const requestedTimeFormat = (body?.timeFormat as string | undefined)?.trim();

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

    const deviceId = await resolveDeviceId(user.uid, incomingDeviceId);
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

    await adminDb
      .collection("devices")
      .doc(deviceId)
      .set({
        deviceId,
        userId: user.uid,
        deviceName,
        pluginId: pluginId ?? extractPluginId(resolvedWebhookUrl),
        webhookUrlEncrypted: encryptedWebhook,
        statuses: defaultStatuses,
        showLastUpdated: true,
        showStatusSource: false,
        timezone: requestedTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeFormat: requestedTimeFormat === "12h" ? "12h" : "24h",
        dateFormat: "MDY",
        calendarIcsUrl: null,
        activeEventEndsAt: null,
        calendarKeywords: [],
        calendarKeywordStatusKey: null,
        calendarIds: [],
        calendarDetectVideoLinks: true,
        calendarVideoStatusKey: 2, // default to "in a meeting"
        calendarMeetingStatusKey: null, // busy events do nothing by default
        calendarOooStatusKey: 5, // out of office
        calendarIdleUsePreferred: true,
        calendarIdleStatusKey: null,
        activeStatusKey: null,
        activeStatusLabel: null,
        activeStatusSource: null,
        createdAt: now,
        updatedAt: now,
      });

    // Push initial flags to TRMNL
    try {
      await fetch(resolvedWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merge_variables: {
            show_last_updated: true,
            show_status_source: false,
          },
          merge_strategy: "replace",
        }),
      });
    } catch (err) {
      console.error("Failed to push initial labels to TRMNL", err);
    }

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


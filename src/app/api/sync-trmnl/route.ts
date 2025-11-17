import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { decrypt } from "@/lib/crypto";

const SESSION_COOKIE_NAME = "statuslanes_session";

const defaultStatuses = Array.from({ length: 10 }).map((_, idx) => ({
  key: idx + 1,
  label: `Status ${idx + 1}`,
  enabled: true,
}));

async function requireUser() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) throw new Error("UNAUTHENTICATED");
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid };
}

type TrmnlStatusResult = { statuses: typeof defaultStatuses; resolvedCount: number };

async function fetchTrmnlStatuses(webhookUrl: string): Promise<TrmnlStatusResult> {
  const res = await fetch(webhookUrl, { method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TRMNL responded ${res.status}: ${body || "no body"}`);
  }
  const json = (await res.json()) as unknown;
  const mv =
    typeof json === "object" && json && "merge_variables" in json ? (json as Record<string, unknown>).merge_variables : undefined;
  if (!mv || typeof mv !== "object") {
    throw new Error("No merge_variables found");
  }

  const activeKeyRaw = (mv as Record<string, unknown>)["status_key"];
  const activeLabelRaw = (mv as Record<string, unknown>)["status_label"];
  const activeKey = typeof activeKeyRaw === "number" ? activeKeyRaw : Number(activeKeyRaw);
  const activeLabel =
    typeof activeLabelRaw === "string" && activeLabelRaw.trim().length > 0 ? activeLabelRaw.trim().slice(0, 60) : null;

  let resolvedCount = 0;
  const statuses = defaultStatuses.map((s) => {
    const label = (mv as Record<string, unknown>)[`status_${s.key}_label`];
    const nextFromField =
      typeof label === "string" && label.trim().length > 0 ? label.trim().length > 60 ? label.trim().slice(0, 60) : label.trim() : null;
    const fallbackFromActive = activeKey === s.key && activeLabel ? activeLabel : null;
    const nextLabel = nextFromField || fallbackFromActive || s.label;
    if (nextLabel !== s.label) resolvedCount += 1;
    return {
      ...s,
      label: nextLabel,
    };
  });
  return { statuses, resolvedCount };
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

    const { statuses, resolvedCount } = await fetchTrmnlStatuses(webhookUrl);

    await ref.update({ statuses, updatedAt: Date.now() });
    const refreshed = await ref.get();
    return NextResponse.json({ device: refreshed.data(), labelsResolved: resolvedCount }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to sync TRMNL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

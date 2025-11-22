import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { fetchPluginSettings, renderStatusMarkup } from "@/lib/trmnl";
import { loadUserStatusRecord } from "@/lib/userStatus";

const MANAGEMENT_URL = resolveManagementUrl();

function resolveManagementUrl(): string | null {
  const candidate = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (!candidate) return null;
  return `${candidate.replace(/\/$/, "")}/settings`;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }
  const token = authHeader.split(" ")[1]?.trim();
  if (!token) {
    return NextResponse.json({ error: "Invalid Authorization header" }, { status: 401 });
  }

  try {
    let pluginSettingId: string;
    try {
      const pluginInfo = await fetchPluginSettings(token);
      pluginSettingId = pluginInfo.pluginSettingId;
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      throw error;
    }

    const installationSnap = await adminDb.collection("trmnl").doc(pluginSettingId).get();
    if (!installationSnap.exists) {
      const markup = renderStatusMarkup({ variant: "unlinked", managementUrl: MANAGEMENT_URL });
      return NextResponse.json(markup, { status: 200 });
    }
    const installation = installationSnap.data() ?? {};
    const linkedUserId = installation.linkedUserId as string | undefined;
    if (!linkedUserId) {
      const markup = renderStatusMarkup({ variant: "unlinked", managementUrl: MANAGEMENT_URL });
      return NextResponse.json(markup, { status: 200 });
    }

    const userStatus = await loadUserStatusRecord(linkedUserId);
    if (!userStatus) {
      const markup = renderStatusMarkup({
        variant: "no-status",
        personName: (installation.deviceName as string | undefined) ?? "Statuslanes",
        managementUrl: MANAGEMENT_URL,
      });
      return NextResponse.json(markup, { status: 200 });
    }

    const markup = renderStatusMarkup({
      variant: "ready",
      personName: userStatus.personName,
      statusText: userStatus.text,
      statusSource: userStatus.source,
      updatedAt: userStatus.updatedAt,
      timezone: userStatus.timezone ?? (installation.timezone as string | undefined) ?? "UTC",
      managementUrl: MANAGEMENT_URL,
    });
    return NextResponse.json(markup, { status: 200 });
  } catch (error) {
    console.error("trmnl markup error", error);
    const markup = renderStatusMarkup({
      variant: "error",
      message: "Please try again shortly.",
      managementUrl: MANAGEMENT_URL,
    });
    return NextResponse.json(markup, { status: 200 });
  }
}

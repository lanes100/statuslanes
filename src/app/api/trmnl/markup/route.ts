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
    let customFields: Record<string, string> = {};
    try {
      const pluginInfo = await fetchPluginSettings(token);
      pluginSettingId = pluginInfo.pluginSettingId;
      const cf = (pluginInfo.raw?.custom_fields_values ?? {}) as Record<string, unknown>;
      customFields = Object.fromEntries(
        Object.entries(cf)
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, (value as string).trim()]),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      throw error;
    }
    const cfPersonName = customFields.person_name && customFields.person_name.length > 0 ? customFields.person_name : undefined;
    const cfDefaultStatus =
      customFields.default_status && customFields.default_status.length > 0 ? customFields.default_status : undefined;

    const installationSnap = await adminDb.collection("trmnl").doc(pluginSettingId).get();
    if (!installationSnap.exists) {
      const markup = renderStatusMarkup({
        variant: "unlinked",
        personName: cfPersonName,
        managementUrl: MANAGEMENT_URL,
      });
      return NextResponse.json(markup, { status: 200 });
    }
    const installation = installationSnap.data() ?? {};
    const linkedUserId = installation.linkedUserId as string | undefined;
    if (!linkedUserId) {
      const markup = renderStatusMarkup({
        variant: "unlinked",
        personName: cfPersonName,
        managementUrl: MANAGEMENT_URL,
      });
      return NextResponse.json(markup, { status: 200 });
    }

    const userStatus = await loadUserStatusRecord(linkedUserId);
    if (!userStatus) {
      const markup = renderStatusMarkup({
        variant: "no-status",
        personName: cfPersonName ?? (installation.deviceName as string | undefined) ?? "Statuslanes",
        message: cfDefaultStatus ?? "Working hard",
        managementUrl: MANAGEMENT_URL,
      });
      return NextResponse.json(markup, { status: 200 });
    }
    const timezone = userStatus.timezone ?? (installation.timezone as string | undefined) ?? "UTC";
    const updatedAtText = userStatus.updatedAtText ?? formatUpdatedAtText(userStatus.updatedAt, timezone);

    const markup = renderStatusMarkup({
      variant: "ready",
      personName: userStatus.personName || cfPersonName || "Statuslanes",
      statusText: userStatus.text || cfDefaultStatus || "Working hard",
      statusSource: userStatus.source,
      updatedAtText,
      showLastUpdated: userStatus.showLastUpdated,
      showStatusSource: userStatus.showStatusSource,
    });
    return NextResponse.json(markup, { status: 200 });
  } catch (error) {
    console.error("trmnl markup error", error);
    const markup = renderStatusMarkup({
      variant: "error",
      message: "Please try again shortly.",
    });
    return NextResponse.json(markup, { status: 200 });
  }
}

function formatUpdatedAtText(timestamp?: number | null, timezone?: string | null): string | null {
  if (!timestamp) return null;
  const safeTimezone = timezone && timezone.trim().length > 0 ? timezone : "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { exchangeInstallationToken } from "@/lib/trmnl";

type InstallPayload = {
  installation_token?: string;
  installationToken?: string;
  plugin_setting_id?: string;
  pluginSettingId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as InstallPayload;
    const installationToken = (body.installation_token ?? body.installationToken)?.trim();
    const pluginSettingIdRaw = body.plugin_setting_id ?? body.pluginSettingId;
    const pluginSettingId = pluginSettingIdRaw ? String(pluginSettingIdRaw).trim() : "";

    if (!installationToken || !pluginSettingId) {
      return NextResponse.json({ error: "Missing installation_token or plugin_setting_id" }, { status: 400 });
    }

    const tokenResponse = await exchangeInstallationToken(installationToken);
    const now = Date.now();
    const expiresAt = tokenResponse.expiresIn ? now + tokenResponse.expiresIn * 1000 : null;

    const ref = adminDb.collection("trmnl").doc(pluginSettingId);
    const existing = await ref.get();
    const linkedUserId = existing.exists ? ((existing.data()?.linkedUserId as string | undefined) ?? null) : null;
    const config = existing.exists ? existing.data()?.config ?? {} : {};
    const createdAt = existing.exists ? (existing.data()?.createdAt as number | undefined) ?? now : now;

    await ref.set(
      {
        pluginSettingId,
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken ?? null,
        tokenType: tokenResponse.tokenType ?? "Bearer",
        expiresAt,
        linkedUserId,
        updatedAt: now,
        createdAt,
        config,
      },
      { merge: true },
    );

    return NextResponse.json(
      {
        plugin_setting_id: pluginSettingId,
        linked_user_id: linkedUserId,
        expires_at: expiresAt,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("trmnl install error", error);
    const message = error instanceof Error ? error.message : "Failed to process installation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

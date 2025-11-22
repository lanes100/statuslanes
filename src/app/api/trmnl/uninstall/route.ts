import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { fetchPluginSettings } from "@/lib/trmnl";

type UninstallBody = {
  plugin_setting_id?: string;
  pluginSettingId?: string;
};

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const pluginSettingId = body.plugin_setting_id ?? body.pluginSettingId;
    const authHeader = request.headers.get("authorization");
    let verifiedId: string | null = null;
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.split(" ")[1]?.trim();
      if (token) {
        try {
          const info = await fetchPluginSettings(token);
          verifiedId = info.pluginSettingId;
        } catch (error) {
          console.warn("Failed to verify TRMNL uninstall token", error);
        }
      }
    }

    if (verifiedId && pluginSettingId && String(pluginSettingId) !== verifiedId) {
      return NextResponse.json({ error: "Plugin ID mismatch" }, { status: 403 });
    }

    const resolvedId = String(pluginSettingId ?? verifiedId ?? "").trim();
    if (!resolvedId) {
      return NextResponse.json({ error: "Missing plugin_setting_id" }, { status: 400 });
    }

    const ref = adminDb.collection("trmnl").doc(resolvedId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
    }

    return NextResponse.json({ deleted: snap.exists, plugin_setting_id: resolvedId }, { status: 200 });
  } catch (error) {
    console.error("trmnl uninstall error", error);
    const message = error instanceof Error ? error.message : "Failed to uninstall";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readBody(request: Request): Promise<UninstallBody> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return ((await request.json().catch(() => ({}))) as UninstallBody) ?? {};
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const result: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") result[key] = value;
    }
    return result as UninstallBody;
  }
  return {};
}

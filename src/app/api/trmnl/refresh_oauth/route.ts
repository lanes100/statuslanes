import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { refreshTrmnlAccessToken } from "@/lib/trmnl";

const EXPIRY_LOOKAHEAD_MS = 5 * 60 * 1000;
const MAX_BATCH = 25;

type RefreshBody = {
  plugin_setting_id?: string;
  pluginSettingId?: string;
};

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const header = request.headers.get("x-sync-secret");
    if (header !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const body = (await request.json().catch(() => ({}))) as RefreshBody;
    const targetId = body.plugin_setting_id ?? body.pluginSettingId;
    const targets = await loadTargets(targetId ? String(targetId) : null);

    const refreshed: string[] = [];
    const skipped: string[] = [];
    const now = Date.now();

    for (const doc of targets) {
      const data = doc.data() ?? {};
      const refreshToken = data.refreshToken as string | undefined;
      if (!refreshToken) {
        skipped.push(doc.id);
        continue;
      }
      try {
        const tokens = await refreshTrmnlAccessToken(refreshToken);
        const expiresAt = tokens.expiresIn ? now + tokens.expiresIn * 1000 : null;
        await doc.ref.update({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? refreshToken,
          tokenType: tokens.tokenType ?? data.tokenType ?? "Bearer",
          expiresAt,
          updatedAt: Date.now(),
        });
        refreshed.push(doc.id);
      } catch (error) {
        console.error(`Failed to refresh TRMNL token for ${doc.id}`, error);
        skipped.push(doc.id);
      }
    }

    return NextResponse.json({ refreshed, skipped }, { status: 200 });
  } catch (error: unknown) {
    console.error("trmnl refresh_oauth error", error);
    const message = error instanceof Error ? error.message : "Failed to refresh tokens";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function loadTargets(pluginSettingId: string | null) {
  if (pluginSettingId) {
    const doc = await adminDb.collection("trmnl").doc(pluginSettingId).get();
    return doc.exists ? [doc] : [];
  }
  const threshold = Date.now() + EXPIRY_LOOKAHEAD_MS;
  const query = await adminDb.collection("trmnl").where("expiresAt", "<=", threshold).limit(MAX_BATCH).get();
  return query.docs;
}

import { adminDb } from "@/lib/firebaseAdmin";
import { refreshOutlookToken, type OutlookTokenResponse } from "@/lib/outlook";

export type OutlookTokenRecord = {
  uid: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scope?: string | null;
  tokenType?: string | null;
  updatedAt?: number | null;
  lastSyncedAt?: number | null;
};

export async function getOutlookTokenRecord(uid: string) {
  const snap = await adminDb.collection("outlook_tokens").doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as OutlookTokenRecord;
}

export async function saveOutlookTokens(uid: string, tokens: OutlookTokenResponse) {
  const expiryDate = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;
  await adminDb
    .collection("outlook_tokens")
    .doc(uid)
    .set(
      {
        uid,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiryDate,
        scope: tokens.scope ?? null,
        tokenType: tokens.token_type ?? null,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  return {
    uid,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiryDate,
    scope: tokens.scope ?? null,
    tokenType: tokens.token_type ?? null,
    updatedAt: Date.now(),
  } as OutlookTokenRecord;
}

export async function ensureOutlookAccessToken(uid: string) {
  const record = await getOutlookTokenRecord(uid);
  if (!record || (!record.accessToken && !record.refreshToken)) {
    throw new Error("OUTLOOK_NOT_CONNECTED");
  }
  const now = Date.now();
  if (record.accessToken && record.expiryDate && record.expiryDate - now > 60_000) {
    return { token: record.accessToken, record };
  }
  if (!record.refreshToken) {
    throw new Error("OUTLOOK_REFRESH_MISSING");
  }
  const refreshed = await refreshOutlookToken(record.refreshToken);
  const merged = await saveOutlookTokens(uid, refreshed);
  return { token: refreshed.access_token, record: merged };
}

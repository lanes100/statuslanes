import { randomUUID } from "node:crypto";

import { adminDb } from "@/lib/firebaseAdmin";
import { ensureOutlookAccessToken } from "@/lib/outlookTokens";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const OUTLOOK_SUBS_COLLECTION = "outlook_subscriptions";
const OUTLOOK_RENEW_LEAD_MS = 1000 * 60 * 60 * 12; // 12 hours
const OUTLOOK_SUB_DURATION_MS = 1000 * 60 * 60 * 60; // 60 hours (~2.5 days)

type OutlookSubscriptionRecord = {
  subscriptionId: string;
  calendarId: string;
  userId: string;
  deviceId: string;
  clientState: string;
  expiration: number;
  createdAt: number;
  updatedAt: number;
};

function getWebhookUrl() {
  const url = process.env.OUTLOOK_CALENDAR_WEBHOOK_URL;
  if (!url) {
    console.warn("OUTLOOK_CALENDAR_WEBHOOK_URL is not configured. Skipping Outlook watch setup.");
    return null;
  }
  return url;
}

export async function ensureOutlookSubscriptionsForDevice(userId: string, deviceId: string, calendarIds: string[]) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return;

  const normalizedIds = calendarIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  const tokenResult = normalizedIds.length > 0 ? await ensureOutlookAccessToken(userId) : null;
  const accessToken = tokenResult?.token ?? null;

  const existingSnap = await adminDb.collection(OUTLOOK_SUBS_COLLECTION).where("userId", "==", userId).get();
  const existingDocs = existingSnap.docs.filter((doc) => doc.data()?.deviceId === deviceId);
  const now = Date.now();

  if (normalizedIds.length === 0) {
    await removeOutlookSubscriptions(existingDocs, accessToken);
    return;
  }

  const existingByCalendar = new Map<string, { doc: FirebaseFirestore.QueryDocumentSnapshot; data: OutlookSubscriptionRecord }>();
  for (const doc of existingDocs) {
    const data = doc.data() as OutlookSubscriptionRecord;
    existingByCalendar.set(data.calendarId, { doc, data });
  }

  const desiredSet = new Set(normalizedIds);
  const toRemove = existingDocs.filter((doc) => {
    const data = doc.data() as OutlookSubscriptionRecord;
    return !desiredSet.has(data.calendarId);
  });
  await removeOutlookSubscriptions(toRemove, accessToken);

  for (const calId of normalizedIds) {
    const existing = existingByCalendar.get(calId);
    const needsRenew =
      !existing ||
      !existing.data.expiration ||
      existing.data.expiration - now < OUTLOOK_RENEW_LEAD_MS;
    if (!needsRenew) continue;

    if (!accessToken) continue;

    if (existing) {
      await deleteSubscription(accessToken, existing.data.subscriptionId);
      await existing.doc.ref.delete();
    }

    await createSubscription(accessToken, userId, deviceId, calId, webhookUrl);
  }
}

export async function removeAllOutlookSubscriptionsForUser(userId: string) {
  const snap = await adminDb.collection(OUTLOOK_SUBS_COLLECTION).where("userId", "==", userId).get();
  if (snap.empty) return;
  let token: string | null = null;
  try {
    const tokenResult = await ensureOutlookAccessToken(userId);
    token = tokenResult.token;
  } catch {
    token = null;
  }
  await removeOutlookSubscriptions(snap.docs, token);
}

async function removeOutlookSubscriptions(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  token: string | null,
) {
  for (const doc of docs) {
    const data = doc.data() as OutlookSubscriptionRecord;
    if (token) {
      await deleteSubscription(token, data.subscriptionId);
    }
    await doc.ref.delete();
  }
}

async function deleteSubscription(token: string, subscriptionId: string) {
  try {
    await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    console.warn("Failed to delete Outlook subscription", subscriptionId, err);
  }
}

async function createSubscription(
  token: string,
  userId: string,
  deviceId: string,
  calendarId: string,
  webhookUrl: string,
) {
  const clientState = randomUUID();
  const expirationDate = new Date(Date.now() + OUTLOOK_SUB_DURATION_MS).toISOString();
  try {
    const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl: webhookUrl,
        resource: `/me/calendars('${calendarId.replace(/'/g, "''")}')/events`,
        expirationDateTime: expirationDate,
        clientState,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create Outlook subscription: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { id: string; expirationDateTime?: string };
    const expiration = data.expirationDateTime ? new Date(data.expirationDateTime).getTime() : Date.now() + OUTLOOK_SUB_DURATION_MS;
    await adminDb.collection(OUTLOOK_SUBS_COLLECTION).doc(data.id).set({
      subscriptionId: data.id,
      calendarId,
      userId,
      deviceId,
      clientState,
      expiration,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error(`Failed to set Outlook watch for calendar ${calendarId}`, err);
  }
}

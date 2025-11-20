import { randomUUID } from "node:crypto";

import { adminDb } from "@/lib/firebaseAdmin";
import { getOAuthClient, getCalendarClient } from "@/lib/google";

export const CHANNEL_COLLECTION = "google_calendar_channels";
export const WATCH_RENEW_LEAD_MS = 1000 * 60 * 60 * 12; // 12 hours

type GoogleTokenRecord = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
  scope?: string | null;
  tokenType?: string | null;
};

export type WatchChannelRecord = {
  channelId: string;
  calendarId: string;
  resourceId?: string | null;
  expiration?: number | null;
  userId: string;
  deviceId: string;
  token?: string | null;
  createdAt: number;
  updatedAt: number;
};

function getWebhookUrl() {
  const url = process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
  if (!url) {
    console.warn("GOOGLE_CALENDAR_WEBHOOK_URL is not configured. Skipping watch setup.");
    return null;
  }
  return url;
}

async function buildCalendarClient(userId: string) {
  const tokenSnap = await adminDb.collection("google_tokens").doc(userId).get();
  if (!tokenSnap.exists) return null;
  const tokenData = tokenSnap.data() as GoogleTokenRecord | undefined;
  if (!tokenData || (!tokenData.accessToken && !tokenData.refreshToken)) {
    return null;
  }
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenData.accessToken ?? undefined,
    refresh_token: tokenData.refreshToken ?? undefined,
    expiry_date: tokenData.expiryDate ?? undefined,
    token_type: tokenData.tokenType ?? undefined,
    scope: tokenData.scope ?? undefined,
  });
  const calendar = getCalendarClient(oauth2Client);
  return { calendar };
}

async function stopChannel(calendar: ReturnType<typeof getCalendarClient> | null, channel: WatchChannelRecord) {
  if (!calendar) {
    return;
  }
  try {
    await calendar.channels.stop({
      requestBody: {
        id: channel.channelId,
        resourceId: channel.resourceId ?? undefined,
      },
    });
  } catch (err) {
    console.warn(`Failed to stop Google channel ${channel.channelId}`, err);
  }
}

type EnsureOptions = {
  calendarClient?: ReturnType<typeof getCalendarClient>;
};

export async function ensureCalendarWatchesForDevice(
  userId: string,
  deviceId: string,
  calendarIds: string[],
  options?: EnsureOptions,
) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return;
  }
  let calendar: ReturnType<typeof getCalendarClient> | null = options?.calendarClient ?? null;
  if (!calendar) {
    const clientInfo = await buildCalendarClient(userId);
    calendar = clientInfo?.calendar ?? null;
  }
  if (!calendar) {
    await removeWatchRecordsForDevice(userId, deviceId, null);
    return;
  }
  const existingSnap = await adminDb.collection(CHANNEL_COLLECTION).where("userId", "==", userId).get();
  const existingDocs = existingSnap.docs.filter((doc) => doc.data()?.deviceId === deviceId);
  const now = Date.now();

  if (calendarIds.length === 0) {
    await removeWatchRecords(existingDocs, calendar);
    return;
  }

  const existingByCalendar = new Map<string, { doc: FirebaseFirestore.QueryDocumentSnapshot; data: WatchChannelRecord }>();
  for (const doc of existingDocs) {
    const data = doc.data() as WatchChannelRecord;
    if (!existingByCalendar.has(data.calendarId)) {
      existingByCalendar.set(data.calendarId, { doc, data });
    }
  }

  const desiredSet = new Set(calendarIds);
  const toRemove = existingDocs.filter((doc) => {
    const data = doc.data() as WatchChannelRecord;
    return !desiredSet.has(data.calendarId);
  });
  if (toRemove.length > 0) {
    await removeWatchRecords(toRemove, calendar);
  }

  for (const calendarId of calendarIds) {
    const existing = existingByCalendar.get(calendarId);
    const needsRenew =
      !existing || !existing.data.expiration || existing.data.expiration - now < WATCH_RENEW_LEAD_MS;
    if (!needsRenew) {
      continue;
    }
    if (existing) {
      await stopChannel(calendar, existing.data);
      await existing.doc.ref.delete();
    }
    await createWatch(calendar, userId, deviceId, calendarId, webhookUrl);
  }
}

export async function removeAllCalendarWatchesForUser(userId: string) {
  const channelsSnap = await adminDb.collection(CHANNEL_COLLECTION).where("userId", "==", userId).get();
  if (channelsSnap.empty) return;
  const clientInfo = await buildCalendarClient(userId);
  const calendar = clientInfo?.calendar ?? null;
  await removeWatchRecords(channelsSnap.docs, calendar);
}

async function removeWatchRecords(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  calendar: ReturnType<typeof getCalendarClient> | null,
) {
  for (const doc of docs) {
    const data = doc.data() as WatchChannelRecord;
    await stopChannel(calendar, data);
    await doc.ref.delete();
  }
}

async function removeWatchRecordsForDevice(
  userId: string,
  deviceId: string,
  calendar: ReturnType<typeof getCalendarClient> | null,
) {
  const snap = await adminDb.collection(CHANNEL_COLLECTION).where("userId", "==", userId).get();
  const docs = snap.docs.filter((doc) => doc.data()?.deviceId === deviceId);
  if (docs.length === 0) return;
  await removeWatchRecords(docs, calendar);
}

async function createWatch(
  calendar: ReturnType<typeof getCalendarClient>,
  userId: string,
  deviceId: string,
  calendarId: string,
  webhookUrl: string,
) {
  const channelId = randomUUID();
  const token = randomUUID();
  try {
    const res = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token,
      },
    });
    const expiration = res.data.expiration ? Number(res.data.expiration) : Date.now() + 1000 * 60 * 60;
    await adminDb.collection(CHANNEL_COLLECTION).doc(channelId).set({
      channelId,
      calendarId,
      resourceId: res.data.resourceId ?? null,
      userId,
      deviceId,
      token,
      expiration,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error(`Failed to create Google Calendar watch for ${calendarId}`, err);
  }
}

import { CloudTasksClient } from "@google-cloud/tasks";

const projectId = process.env.GCP_PROJECT_ID;
const location = process.env.GCP_LOCATION ?? process.env.GCP_REGION;
const queueId = process.env.GCP_TASK_QUEUE ?? "calendar-cache-queue";
const baseUrl = process.env.SYNC_BASE_URL?.replace(/\/$/, "");
const syncSecret = process.env.SYNC_SECRET;
const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

const ENABLED = Boolean(projectId && location && queueId && baseUrl && syncSecret);

let client: CloudTasksClient | null = null;
let queuePath: string | null = null;

function getClient() {
  if (!client) {
    if (credentialsJson) {
      client = new CloudTasksClient({ credentials: JSON.parse(credentialsJson) });
    } else {
      client = new CloudTasksClient();
    }
  }
  if (!queuePath) {
    queuePath = client.queuePath(projectId!, location!, queueId!);
  }
  return client;
}

export async function scheduleCalendarCacheApply(deviceId: string, runAtMs: number | null | undefined) {
  if (!ENABLED || !deviceId || !runAtMs) {
    return;
  }

  const clientInstance = getClient();
  const safeRunAt = Math.max(Date.now() + 10_000, runAtMs);
  const seconds = Math.floor(safeRunAt / 1000);
  const nanos = Math.floor((safeRunAt % 1000) * 1e6);
  const body = Buffer.from(JSON.stringify({ deviceId })).toString("base64");

  try {
    await clientInstance.createTask({
      parent: queuePath!,
      task: {
        scheduleTime: {
          seconds,
          nanos,
        },
        httpRequest: {
          httpMethod: "POST",
          url: `${baseUrl}/api/calendar-cache/apply`,
          headers: {
            "Content-Type": "application/json",
            "x-sync-secret": syncSecret!,
          },
          body,
        },
      },
    });
  } catch (err) {
    console.error("scheduleCalendarCacheApply failed", err);
  }
}
